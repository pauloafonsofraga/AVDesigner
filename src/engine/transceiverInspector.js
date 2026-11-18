import { transceiverModulePresentation, transceiverRateKey } from "./transceiverModules.js";
import { opticalTechnologiesFor, MPO_FIBER_COUNTS, MPO_POLARITIES } from "./customTransceiverOptics.js";
import { cageDefinitionValue, CAGE_DEFINITION_CHOICES, transceiverConfigurationChoices, transceiverLineRateChoices } from "./transceiverConfiguration.js";
import { transceiverDraft, draftFromPreset, editTransceiverDraft, transceiverDraftConfiguration, transceiverDraftPatch } from "./transceiverDraft.js";
import { mountMpoPhysicalFields } from "./mpoPhysicalInspector.js";

const names = { lc: "LC", sc: "SC", st: "ST", mpo: "MPO", rj45: "RJ45", bnc: "BNC", dac: "DAC", aoc: "AOC", empty: "Empty" };
const opticalInterface = value => ["lc", "sc", "st", "mpo"].includes(value);
export function mountTransceiverInspector(root, connector, { commit, disabled = false }) {
  const choices = transceiverConfigurationChoices(connector);
  const interfaces = ["empty", ...["lc", "sc", "st", "mpo"].filter(iface =>
    choices.fiberFamilies[iface].length || choices.opticalSdiFor[iface])];
  if (choices.copper) interfaces.push("rj45");
  if (choices.coax.length) interfaces.push("bnc");
  for (const kind of ["dac", "aoc"]) if (choices.assemblies.some(p => p.value.startsWith(kind + "-"))) interfaces.push(kind);
  let draft = transceiverDraft(connector), edited = false, apply, rateControl;
  const el = (tag, text = "") => { const n = document.createElement(tag); n.textContent = text; return n; };
  const fields = el("fieldset");
  fields.disabled = disabled;
  fields.style.cssText = "border:0;padding:0;margin:0;min-inline-size:0";
  const summary = el("div", [
    CAGE_DEFINITION_CHOICES.find(([key]) => key === cageDefinitionValue(connector))?.[1] || "QSFP (form unspecified)",
    "Installed: " + transceiverModulePresentation(connector), disabled ? "Cage occupied or locked" : ""
  ].filter(Boolean).join(" | "));
  summary.className = "field-hint"; summary.style.overflowWrap = "anywhere";
  const pending = el("p"); pending.className = "field-hint"; pending.dataset.transceiverDraftStatus = "";
  pending.setAttribute("role", "status"); pending.hidden = true;
  const error = el("p"); error.className = "field-hint"; error.setAttribute("role", "alert"); error.hidden = true;
  root.replaceChildren(el("h4", "Transceiver"), summary, pending, fields, error);
  function updatePending() {
    pending.hidden = !edited;
    const profile = choices.standard.find(p => p.value === draft.preset);
    pending.textContent = (profile?.label || (draft.interface === "empty" ? "Empty" : "Custom " + names[draft.interface])) + " - Not applied";
  }
  function mark(field, value) {
    draft = editTransceiverDraft(draft, field, value);
    edited = true; apply.disabled = false; error.hidden = true;
    const preset = fields.querySelector("#transceiver-preset"); if (preset) preset.value = "";
    updatePending();
    if (field !== "rateChoice" && rateControl?.isConnected && opticalInterface(draft.interface)) {
      rateControl.replaceChildren(...rateOptions().map(([value, title]) => {
        const option = el("option", title); option.value = value; return option;
      }));
      rateControl.value = draft.rateChoice;
    }
  }
  function append(control, label) {
    const wrap = el("div"); wrap.className = "field";
    const title = el("label", label); title.htmlFor = control.id;
    wrap.append(title, control); fields.append(wrap);
  }
  function select(key, label, options, callback) {
    const control = el("select"); control.id = "transceiver-" + key;
    for (const [value, title] of options) { const option = el("option", title); option.value = value; control.append(option); }
    control.value = draft[key] ?? "";
    if (control.selectedIndex < 0) {
      const retained = el("option", "Existing: " + String(draft[key])); retained.value = draft[key] ?? "";
      control.append(retained); control.value = retained.value;
    }
    control.addEventListener("change", () => {
      if (key === "preset") {
        draft = control.value ? draftFromPreset(connector, control.value) : editTransceiverDraft(draft, "preset", "");
        edited = true; error.hidden = true; render();
      } else { mark(key, control.value); callback?.(); }
    });
    append(control, label);
    return control;
  }
  function input(key, label) {
    const control = el("input"); control.id = "transceiver-" + key; control.value = draft[key] ?? ""; control.maxLength = 180;
    control.addEventListener("input", () => mark(key, control.value)); append(control, label);
  }
  function rateOptions() {
    const rates = transceiverLineRateChoices(connector, { signalFamily: draft.signalFamily, profile: draft.preset, moduleRates: draft.declaredRates });
    const current = draft.supportedRates || [];
    const canonical = current.length === 1 && rates.find(rate => transceiverRateKey(rate) === transceiverRateKey(current[0]));
    draft.rateChoice = !current.length ? "" : canonical || "__current__";
    return [["", "Unspecified"], ...(current.length && !canonical
      ? [["__current__", "Current: " + current.join(" / ")]] : []), ...rates.map(rate => [rate, rate])];
  }
  function render() {
    updatePending();
    fields.replaceChildren();
    rateControl = null;
    select("preset", "Preset (optional)", [["", "None"], ...choices.standard.map(p => [p.value,
      p.capabilities.signalFamily === "sdi" ? p.label.replace(/\s+(TX|RX)$/i, "") : p.label])]);
    select("interface", "Installed interface", interfaces.map(value => [value, names[value]]), () => {
      Object.assign(draft, { signalFamily: "ethernet", arrangement: draft.interface === "mpo" ? "parallel" : "duplex",
        technology: "", supportedRates: [], declaredRates: [], txNm: "", rxNm: "", fiberCount: "", mpoPolarity: "", laneMapping: "" });
      delete draft.mpoPhysical;
      const assembly = choices.assemblies.find(p => p.value.startsWith(draft.interface + "-"));
      if (assembly) draft.assemblyProfile = assembly.value;
      render();
    });
    if (opticalInterface(draft.interface)) {
      const families = choices.fiberFamilies[draft.interface];
      if (choices.opticalSdiFor[draft.interface]) {
        select("signalFamily", "Signal family", [...(families.length ? [["ethernet", "Ethernet"]] : []), ["sdi", "Optical SDI"]], () => {
          if (draft.signalFamily === "sdi") { draft.fiberFamily = "single-mode"; draft.arrangement = "simplex"; }
          draft.supportedRates = []; draft.declaredRates = []; render();
        });
      }
      if (draft.signalFamily !== "sdi") {
        select("fiberFamily", "Fibre category", families.map(f => [f, f === "single-mode" ? "Single-mode" : "Multimode"]), () => {
          draft.fiberGrade = ""; render();
        });
      }
      select("fiberGrade", "Fibre grade", [["", "Unspecified"], ...(draft.fiberFamily === "single-mode"
        ? [["os2", "OS2"]] : [["om3", "OM3"], ["om4", "OM4"], ["om5", "OM5"]])]);
      if (draft.interface !== "mpo" && draft.signalFamily !== "sdi") {
        select("arrangement", "Fibre arrangement", [["simplex", "Simplex"], ["duplex", "Duplex"]], () => { draft.technology = ""; render(); });
      } else fields.append(el("p", draft.interface === "mpo" ? "Parallel" : choices.role === "input" ? "Simplex / Receive" : "Simplex / Transmit"));
      select("technology", "Optical technology", opticalTechnologiesFor(draft.arrangement, draft.signalFamily));
      rateControl = select("rateChoice", "Line rate", rateOptions(), () => {
        if (draft.rateChoice !== "__current__") draft.supportedRates = draft.rateChoice ? [draft.rateChoice] : [];
        render();
      });
      const hostRates = connector.cageCapabilities?.supportedRates;
      const portRates = connector.supportedRates;
      const knownRates = [hostRates, portRates].filter(values => Array.isArray(values) && values.length);
      const rateSupport = el("p", knownRates.length ? "Declared host/port rates: " + knownRates.map(values => values.join(" / ")).join("; ")
        : "Host rate support: Unverified (not declared)");
      rateSupport.className = "field-hint"; rateSupport.dataset.transceiverRateSupport = ""; fields.append(rateSupport);
      if (draft.signalFamily !== "sdi" || choices.role === "output") input("txNm", "TX wavelengths (nm, comma-separated)");
      if (draft.signalFamily !== "sdi" || choices.role === "input") input("rxNm", "RX wavelengths (nm, comma-separated)");
      if (draft.interface === "mpo") {
        select("fiberCount", "MPO fibre count", [["", "Unspecified"], ...MPO_FIBER_COUNTS.map(n => [String(n), String(n)])]);
        select("mpoPolarity", "MPO polarity", [["", "Unspecified"], ...MPO_POLARITIES.map(type => [type, "Type " + type])]);
        input("laneMapping", "Lane fibre positions (comma-separated)");
        const mpo = mountMpoPhysicalFields(fields, draft.mpoPhysical, { expanded: true,
          onChange: () => mark("mpoPhysical", mpo.read()) });
      }
    } else if (["dac", "aoc", "bnc"].includes(draft.interface)) {
      const options = draft.interface === "bnc" ? choices.coax : choices.assemblies.filter(p => p.value.startsWith(draft.interface + "-"));
      if (!options.some(p => p.value === draft.assemblyProfile) && !edited) {
        fields.append(el("p", "Existing assembly: " + draft.assemblyProfile));
      }
      select("assemblyProfile", draft.interface === "bnc" ? "SDI rate" : "Cable assembly", options.map(p => [p.value, p.label]));
    }
    apply = el("button", "Apply Transceiver"); apply.type = "button"; apply.className = "tool-button"; apply.disabled = !edited;
    apply.addEventListener("click", () => {
      try {
        if (transceiverDraftPatch(connector, draft)) commit(transceiverDraftConfiguration(draft));
      } catch (failure) { error.textContent = failure.message; error.hidden = false; }
    });
    fields.append(apply);
  }
  render();
}
