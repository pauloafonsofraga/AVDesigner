import { transceiverModulePresentation, transceiverRateKey } from "./transceiverModules.js";
import { WAVELENGTH_MODES, MPO_FIBER_COUNTS, MPO_POLARITIES } from "./customTransceiverOptics.js";
import { cageDefinitionValue, CAGE_DEFINITION_CHOICES, transceiverConfigurationChoices, transceiverBandwidthChoices } from "./transceiverConfiguration.js";
import { transceiverDraft, draftFromPreset, editTransceiverDraft, transceiverDraftConfiguration, transceiverDraftPatch } from "./transceiverDraft.js";
import { mountMpoPhysicalFields } from "./mpoPhysicalInspector.js";

const names = { lc: "LC", sc: "SC", st: "ST", mpo: "MPO", rj45: "RJ45", bnc: "BNC", dac: "DAC", aoc: "AOC", empty: "Empty" };
const opticalInterface = value => ["lc", "sc", "st", "mpo"].includes(value);
export function mountTransceiverInspector(root, connector, { commit, disabled = false, prefix = "transceiver" }) {
  const choices = transceiverConfigurationChoices(connector);
  const profilesFor = iface => choices.standard.filter(p => p.activeType === "fiber-" + iface);
  const fiberFamiliesFor = iface => [...new Set([...choices.fiberFamilies[iface],
    ...profilesFor(iface).map(p => p.capabilities.optical.fiberFamily)])];
  const interfaces = ["empty", ...["lc", "sc", "st", "mpo"].filter(iface =>
    fiberFamiliesFor(iface).length || choices.opticalSdiFor[iface])];
  if (choices.copper) interfaces.push("rj45");
  if (choices.coax.length) interfaces.push("bnc");
  for (const kind of ["dac", "aoc"]) if (choices.assemblies.some(p => p.value.startsWith(kind + "-"))) interfaces.push(kind);
  let draft = transceiverDraft(connector), edited = false, rateControl, presetControl;
  const el = (tag, text = "") => { const n = document.createElement(tag); n.textContent = text; return n; };
  const fields = el("fieldset");
  fields.disabled = disabled;
  fields.style.cssText = "border:0;padding:0;margin:0;min-inline-size:0";
  const summary = el("div", [
    CAGE_DEFINITION_CHOICES.find(([key]) => key === cageDefinitionValue(connector))?.[1] || "QSFP (form unspecified)",
    "Installed: " + transceiverModulePresentation(connector), disabled ? "Cage occupied or locked" : ""
  ].filter(Boolean).join(" | "));
  summary.className = "field-hint"; summary.style.overflowWrap = "anywhere";
  const error = el("p"); error.className = "field-hint"; error.setAttribute("role", "alert"); error.hidden = true;
  root.replaceChildren(el("h4", "Transceiver"), summary, fields, error);
  function applySelection() {
    if (disabled) return;
    try {
      if (opticalInterface(draft.interface) && !draft.supportedRates.length) {
        const rate = transceiverBandwidthChoices(connector, draft.signalFamily)[0];
        if (!rate) throw new Error("No supported bandwidth is available for this cage.");
        draft.supportedRates = [rate];
      }
      if (transceiverDraftPatch(connector, draft)) commit(transceiverDraftConfiguration(draft));
    } catch (failure) {
      error.textContent = failure.message + " The installed transceiver was not changed.";
      error.hidden = false;
    }
  }
  function mark(field, value) {
    draft = editTransceiverDraft(draft, field, value);
    if (field !== "preset" && presetControl?.isConnected) presetControl.value = "";
    edited = true; error.hidden = true;
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
    const control = el("select"); control.id = prefix + "-" + key;
    for (const [value, title] of options) { const option = el("option", title); option.value = value; control.append(option); }
    control.value = draft[key] ?? "";
    if (control.selectedIndex < 0) {
      const retained = el("option", "Existing: " + String(draft[key])); retained.value = draft[key] ?? "";
      control.append(retained); control.value = retained.value;
    }
    control.addEventListener("change", () => {
      mark(key, control.value); callback?.(control.value);
      applySelection();
    });
    append(control, label);
    return control;
  }
  function input(key, label) {
    const control = el("input"); control.id = prefix + "-" + key; control.value = draft[key] ?? ""; control.maxLength = 180;
    control.addEventListener("change", () => { mark(key, control.value); applySelection(); });
    control.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); control.blur(); }
    });
    append(control, label);
  }
  function rateOptions() {
    let rates = transceiverBandwidthChoices(connector, draft.signalFamily);
    const profiles = draft.interface === "bnc" ? choices.coax
      : ["dac", "aoc"].includes(draft.interface) ? choices.assemblies.filter(p => p.value.startsWith(draft.interface + "-")) : null;
    if (profiles) rates = rates.filter(rate => profiles.some(p => p.capabilities.supportedRates
      ?.some(value => transceiverRateKey(value) === transceiverRateKey(rate))));
    const current = draft.supportedRates || [];
    const canonical = current.length === 1 && rates.find(rate => transceiverRateKey(rate) === transceiverRateKey(current[0]));
    draft.rateChoice = !current.length ? rates[0] || "__unavailable__" : canonical || "__current__";
    return [...(current.length && !canonical
      ? [["__current__", "Current: " + current.join(" / ")]] : []), ...rates.map(rate => [rate, rate])];
  }
  function render() {
    fields.replaceChildren();
    rateControl = presetControl = null;
    const bandwidths = rateOptions();
    rateControl = select("rateChoice", "Bandwidth", bandwidths.length ? bandwidths : [["__unavailable__", "No supported bandwidth"]], () => {
      if (draft.rateChoice !== "__current__") {
        draft.supportedRates = [draft.rateChoice];
        if (["dac", "aoc", "bnc"].includes(draft.interface)) {
          const profiles = draft.interface === "bnc" ? choices.coax : choices.assemblies.filter(p => p.value.startsWith(draft.interface + "-"));
          const profile = profiles.find(p => p.capabilities.supportedRates?.some(rate => transceiverRateKey(rate) === transceiverRateKey(draft.rateChoice)));
          if (profile) draft.assemblyProfile = profile.value;
        }
      }
      render();
    });
    if (!bandwidths.length) {
      rateControl.disabled = true;
      fields.append(el("p", "No supported bandwidth: check the declared host/port capabilities."));
    }
    select("interface", "Installed interface", interfaces.map(value => [value, names[value]]), () => {
      Object.assign(draft, { signalFamily: "ethernet", arrangement: draft.interface === "mpo" ? "parallel" : "duplex",
        signalDirection: "bidirectional", wavelengthMode: "", supportedRates: draft.rateChoice && !draft.rateChoice.startsWith("__") ? [draft.rateChoice] : [],
        declaredRates: [], txNm: "", rxNm: "", fiberCount: "", mpoPolarity: "", laneMapping: "", laneTxNm: "", laneRxNm: "" });
      delete draft.mpoPhysical;
      delete draft.rxRangeNm;
      if (opticalInterface(draft.interface) && !fiberFamiliesFor(draft.interface).includes(draft.fiberFamily)) {
        draft.fiberFamily = fiberFamiliesFor(draft.interface)[0] || "single-mode";
      }
      const assembly = choices.assemblies.find(p => p.value.startsWith(draft.interface + "-"));
      const profile = assembly || (draft.interface === "bnc" ? choices.coax[0] : null);
      if (profile) { draft.assemblyProfile = profile.value; draft.supportedRates = [...profile.capabilities.supportedRates]; draft.signalFamily = profile.capabilities.signalFamily; }
      // Hosts restricted to named modules still use the speed/interface workflow.
      // Populate only an actually allowed profile, never relax host restrictions.
      if (opticalInterface(draft.interface) && !choices.fiberFamilies[draft.interface].length) {
        const allowed = profilesFor(draft.interface).find(p => p.capabilities.supportedRates
          ?.some(rate => transceiverRateKey(rate) === transceiverRateKey(draft.rateChoice)));
        if (allowed) draft = draftFromPreset(connector, allowed.value);
      }
      render();
    });
    if (opticalInterface(draft.interface)) {
      const profiles = profilesFor(draft.interface).filter(profile => profile.value === draft.preset
        || profile.capabilities.supportedRates?.some(rate => transceiverRateKey(rate) === transceiverRateKey(draft.rateChoice)));
      if (profiles.length) presetControl = select("preset", "Optical profile", [["", "Custom"], ...profiles.map(p => [p.value, p.label])], value => {
        if (value) draft = draftFromPreset(connector, value);
        render();
      });
      const families = fiberFamiliesFor(draft.interface);
      if (choices.opticalSdiFor[draft.interface]) {
        select("signalFamily", "Signal family", [...(families.length ? [["ethernet", "Ethernet"]] : []), ["sdi", "Optical SDI"]], () => {
          if (draft.signalFamily === "sdi") {
            draft.fiberFamily = "single-mode"; draft.arrangement = "simplex"; draft.signalDirection = "inherited";
            draft.fiberGrade = ""; if (draft.wavelengthMode === "wdm") draft.wavelengthMode = "";
          }
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
        select("arrangement", "Fibre arrangement", [["simplex", "Simplex"], ["duplex", "Duplex"]], render);
      } else fields.append(el("p", draft.interface === "mpo" ? "Parallel" : choices.role === "input" ? "Simplex / Receive" : "Simplex / Transmit"));
      const directionalRole = ["input", "output"].includes(choices.role);
      const direction = draft.signalDirection === "bidirectional" ? "bidirectional" : choices.role || "bidirectional";
      if (draft.signalFamily !== "sdi") select("signalDirection", "Signal direction", [
        ["inherited", "Inherit device role"],
        ...(directionalRole ? [["unidirectional", choices.role === "input" ? "Unidirectional (receive)" : "Unidirectional (transmit)"]] : []),
        ["bidirectional", draft.arrangement === "simplex" ? "Bidirectional (BiDi, shared fibre)" : "Bidirectional"]
      ], render);
      select("wavelengthMode", "Wavelength configuration", draft.signalFamily === "sdi"
        ? WAVELENGTH_MODES.filter(([mode]) => mode !== "wdm") : WAVELENGTH_MODES);
      const hostRates = connector.cageCapabilities?.supportedRates;
      const portRates = connector.supportedRates;
      const knownRates = [hostRates, portRates].filter(values => Array.isArray(values) && values.length);
      const rateSupport = el("p", knownRates.length ? "Declared host/port rates: " + knownRates.map(values => values.join(" / ")).join("; ")
        : "Host rate support: Unverified (not declared)");
      rateSupport.className = "field-hint"; rateSupport.dataset.transceiverRateSupport = ""; fields.append(rateSupport);
      if (direction !== "input" || draft.txNm) input("txNm", "TX wavelengths (nm, comma-separated)");
      if (direction !== "output" || draft.rxNm) input("rxNm", "RX wavelengths (nm, comma-separated)");
      if (draft.interface === "mpo") {
        select("fiberCount", "MPO fibre count", [["", "Unspecified"], ...MPO_FIBER_COUNTS.map(n => [String(n), String(n)])]);
        select("mpoPolarity", "MPO polarity", [["", "Unspecified"], ...MPO_POLARITIES.map(type => [type, "Type " + type])]);
        input("laneMapping", "Lane fibre positions (comma-separated)");
        if (direction !== "input" || draft.laneTxNm) input("laneTxNm", "Lane TX wavelengths (nm; semicolon between lanes)");
        if (direction !== "output" || draft.laneRxNm) input("laneRxNm", "Lane RX wavelengths (nm; semicolon between lanes)");
        const mpo = mountMpoPhysicalFields(fields, draft.mpoPhysical, { expanded: true, prefix: prefix === "transceiver" ? "mpo" : prefix + "-mpo",
          onChange: () => { mark("mpoPhysical", mpo.read()); applySelection(); } });
      }
    } else if (["dac", "aoc", "bnc"].includes(draft.interface)) {
      const options = draft.interface === "bnc" ? choices.coax : choices.assemblies.filter(p => p.value.startsWith(draft.interface + "-"));
      if (!options.some(p => p.value === draft.assemblyProfile) && !edited) {
        fields.append(el("p", "Existing assembly: " + draft.assemblyProfile));
      }
      select("assemblyProfile", draft.interface === "bnc" ? "SDI rate" : "Cable assembly", options.map(p => [p.value, p.label]), () => {
        draft.supportedRates = [...(options.find(p => p.value === draft.assemblyProfile)?.capabilities.supportedRates || [])]; render();
      });
    }
  }
  render();
}
