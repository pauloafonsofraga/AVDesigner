import { transceiverModulePresentation, transceiverRateKey } from "./transceiverModules.js";
import { WAVELENGTH_MODES } from "./customTransceiverOptics.js";
import { cageDefinitionValue, CAGE_DEFINITION_CHOICES, transceiverConfigurationChoices, transceiverBandwidthChoices } from "./transceiverConfiguration.js";
import { transceiverDraft, draftFromPreset, editTransceiverDraft, transceiverDraftConfiguration, transceiverDraftPatch } from "./transceiverDraft.js";
import { mountMpoPhysicalFields } from "./mpoPhysicalInspector.js";

const names = { lc: "LC", sc: "SC", st: "ST", mpo: "MPO", rj45: "RJ45", bnc: "BNC", dac: "DAC", aoc: "AOC", empty: "Empty" };
const opticalInterface = value => ["lc", "sc", "st", "mpo"].includes(value);
export function mountTransceiverInspector(root, connector, { commit, disabled = false, prefix = "transceiver" }) {
  const choices = transceiverConfigurationChoices(connector);
  const profilesFor = iface => choices.standard.filter(p => p.activeType === "fiber-" + iface);
  const fiberFamiliesFor = iface => [...new Set([...choices.fiberFamilies[iface],
    ...profilesFor(iface).filter(p => p.capabilities.signalFamily === "ethernet").map(p => p.capabilities.optical.fiberFamily)])];
  const assembliesFor = iface => iface === "bnc" ? choices.coax : choices.assemblies.filter(p => p.value.startsWith(iface + "-"));
  const assemblyInterface = iface => ["bnc", "dac", "aoc"].includes(iface);
  const profileAtRate = (profiles, rate) => profiles.find(profile => profile.capabilities.supportedRates
    ?.some(value => transceiverRateKey(value) === transceiverRateKey(rate)));
  const interfaces = ["empty", ...["lc", "sc", "st", "mpo"].filter(iface =>
    fiberFamiliesFor(iface).length || choices.opticalSdiFor[iface])];
  if (choices.copper) interfaces.push("rj45");
  if (choices.coax.length) interfaces.push("bnc");
  for (const kind of ["dac", "aoc"]) if (choices.assemblies.some(p => p.value.startsWith(kind + "-"))) interfaces.push(kind);
  let draft = transceiverDraft(connector), presetControl;
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
      if (assemblyInterface(draft.interface) && !draft.assemblyProfile) return;
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
    error.hidden = true;
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
  function rateOptions() {
    let rates = transceiverBandwidthChoices(connector, draft.signalFamily);
    const assembly = assemblyInterface(draft.interface);
    if (assembly) rates = rates.filter(rate => profileAtRate(assembliesFor(draft.interface), rate));
    const current = draft.supportedRates || [];
    const canonical = current.length === 1 && rates.find(rate => transceiverRateKey(rate) === transceiverRateKey(current[0]));
    draft.rateChoice = !current.length ? assembly ? "__choose__" : rates[0] || "__unavailable__" : canonical || "__current__";
    return [...(assembly && !current.length ? [["__choose__", draft.assemblyProfile ? "Rate unspecified" : "Choose bandwidth"]] : []),
      ...(current.length && !canonical
      ? [["__current__", "Current: " + current.join(" / ")]] : []), ...rates.map(rate => [rate, rate])];
  }
  function render() {
    fields.replaceChildren();
    presetControl = null;
    const bandwidths = rateOptions();
    const rateControl = select("rateChoice", "Bandwidth", bandwidths.length ? bandwidths : [["__unavailable__", "No supported bandwidth"]], () => {
      if (draft.rateChoice.startsWith("__")) return;
      draft.supportedRates = [draft.rateChoice];
      if (assemblyInterface(draft.interface)) {
        const profile = profileAtRate(assembliesFor(draft.interface), draft.rateChoice);
        draft.assemblyProfile = profile?.value || "";
      }
      render();
    });
    if (!bandwidths.length) {
      rateControl.disabled = true;
      fields.append(el("p", "No supported bandwidth: check the declared host/port capabilities."));
    }
    select("interface", "Installed interface", interfaces.map(value => [value, names[value]]), () => {
      const preferred = draft.rateChoice;
      const sdi = draft.interface === "bnc" || opticalInterface(draft.interface)
        && !fiberFamiliesFor(draft.interface).length && choices.opticalSdiFor[draft.interface];
      const signalFamily = sdi ? "sdi" : "ethernet";
      const rates = transceiverBandwidthChoices(connector, signalFamily);
      const selected = rates.find(rate => transceiverRateKey(rate) === transceiverRateKey(preferred));
      Object.assign(draft, { signalFamily, arrangement: sdi ? "simplex" : draft.interface === "mpo" ? "parallel" : "duplex",
        wavelengthMode: "", supportedRates: selected ? [selected] : [], assemblyProfile: "", fiberGrade: "" });
      delete draft.mpoPhysical;
      delete draft.legacyWavelengths;
      if (sdi) draft.fiberFamily = "single-mode";
      if (opticalInterface(draft.interface) && !fiberFamiliesFor(draft.interface).includes(draft.fiberFamily)) {
        draft.fiberFamily = fiberFamiliesFor(draft.interface)[0] || "single-mode";
      }
      if (assemblyInterface(draft.interface)) {
        const profile = profileAtRate(assembliesFor(draft.interface), selected);
        draft.assemblyProfile = profile?.value || "";
        draft.supportedRates = [...(profile?.capabilities.supportedRates || [])];
      }
      // Hosts restricted to named modules still use the speed/interface workflow.
      // Populate only an actually allowed profile, never relax host restrictions.
      if (opticalInterface(draft.interface) && !(sdi ? choices.opticalSdiFor[draft.interface] : choices.fiberFamilies[draft.interface].length)) {
        const allowed = profileAtRate(profilesFor(draft.interface), selected);
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
      if (choices.opticalSdiFor[draft.interface] && families.length) {
        select("signalFamily", "Signal family", [["ethernet", "Ethernet"], ["sdi", "Optical SDI"]], () => {
          if (draft.signalFamily === "sdi") {
            draft.fiberFamily = "single-mode"; draft.arrangement = "simplex"; draft.fiberGrade = "";
          } else if (!families.includes(draft.fiberFamily)) {
            draft.fiberFamily = families[0]; draft.fiberGrade = "";
          }
          delete draft.legacyWavelengths;
          draft.supportedRates = []; render();
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
      select("wavelengthMode", "Wavelength Mode", WAVELENGTH_MODES);
      const hostRates = connector.cageCapabilities?.supportedRates;
      const portRates = connector.supportedRates;
      const knownRates = [hostRates, portRates].filter(values => Array.isArray(values) && values.length);
      const rateSupport = el("p", knownRates.length ? "Declared host/port rates: " + knownRates.map(values => values.join(" / ")).join("; ")
        : "Host rate support: Unverified (not declared)");
      rateSupport.className = "field-hint"; rateSupport.dataset.transceiverRateSupport = ""; fields.append(rateSupport);
      if (draft.interface === "mpo") {
        const mpo = mountMpoPhysicalFields(fields, draft.mpoPhysical, { cableMapping: false, prefix: prefix === "transceiver" ? "mpo" : prefix + "-mpo",
          onChange: () => { mark("mpoPhysical", mpo.read()); applySelection(); } });
      }
    } else if (["dac", "aoc", "bnc"].includes(draft.interface)) {
      const options = assembliesFor(draft.interface);
      select("assemblyProfile", draft.interface === "bnc" ? "SDI module" : "Cable assembly",
        [["", "Choose a module"], ...options.map(p => [p.value, p.label])], () => {
        draft.supportedRates = [...(options.find(p => p.value === draft.assemblyProfile)?.capabilities.supportedRates || [])]; render();
      });
    }
  }
  render();
}
