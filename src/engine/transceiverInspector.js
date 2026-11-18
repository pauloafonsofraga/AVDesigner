import { resolveInstalledModule, transceiverModulePresentation } from "./transceiverModules.js";
import { CUSTOM_OPTICS, opticalTechnologiesFor, MPO_FIBER_COUNTS, MPO_POLARITIES } from "./customTransceiverOptics.js";
import { cageDefinitionValue, CAGE_DEFINITION_CHOICES, transceiverConfigurationChoices, transceiverConfigurationPatch } from "./transceiverConfiguration.js";
import { mountMpoPhysicalFields } from "./mpoPhysicalInspector.js";

const fiberLabels = { "single-mode": "Single-mode", multimode: "Multimode" };
const labelForInterface = { lc: "LC", mpo: "MPO", rj45: "RJ45", bnc: "BNC", dac: "DAC", aoc: "AOC", empty: "Empty" };
const opticalInterface = value => value === "lc" || value === "mpo";
const csvNumbers = value => value.trim() ? value.trim().split(/[\s,]+/).map(Number) : [];
const csvText = value => Array.isArray(value) ? value.join(", ") : "";

export function mountTransceiverInspector(root, connector, { commit, disabled = false }) {
  const installed = resolveInstalledModule(connector), optical = installed.capabilities.optical;
  const choices = transceiverConfigurationChoices(connector);
  const profile = installed.profile;
  const physical = cageDefinitionValue(connector);
  const profileLabel = profile => profile.capabilities.signalFamily === "sdi" ? profile.label.replace(/\s+(?:TX|RX|-[ ]*(?:Receiver|Transmitter))$/i, "") : profile.label;
  const interfaces = ["lc", "mpo"].filter(iface => choices.fiberFamilies[iface].length || (iface === "lc" && choices.opticalSdi));
  if (choices.copper) interfaces.push("rj45");
  if (choices.coax.length) interfaces.push("bnc");
  for (const kind of ["dac", "aoc"]) if (choices.assemblies.some(p => p.value.startsWith(`${kind}-`))) interfaces.push(kind);
  interfaces.push("empty");
  const currentInterface = installed.effectiveType === "fiber-lc" ? "lc" : installed.effectiveType === "fiber-mpo" ? "mpo"
    : installed.effectiveType === "cat6a" ? "rj45" : installed.effectiveType === "sdi" ? "bnc"
      : installed.effectiveType.startsWith("dac-") ? "dac" : installed.effectiveType.startsWith("aoc-") ? "aoc" : "empty";
  const standard = choices.standard.some(item => item.value === profile?.value) && optical?.configuration !== CUSTOM_OPTICS;
  const draft = {
    method: standard ? "standard" : "custom",
    profile: profile?.value || "",
    interface: interfaces.includes(currentInterface) ? currentInterface : "empty",
    signalFamily: optical?.configuration === CUSTOM_OPTICS ? installed.capabilities.signalFamily : "ethernet",
    fiberFamily: optical?.fiberFamily || (installed.fiberHint.match(/multimode|om[1-5]/i) ? "multimode" : "single-mode"),
    fiberGrade: optical?.configuration === CUSTOM_OPTICS ? optical.fiberGrade
      : /^om[345]$/i.test(installed.explicitFiberMode) ? installed.explicitFiberMode.toLowerCase() : "",
    arrangement: optical?.configuration === CUSTOM_OPTICS ? optical.arrangement : currentInterface === "mpo" ? "parallel" : "duplex",
    technology: optical?.configuration === CUSTOM_OPTICS ? optical.technology : "",
    lineRate: (installed.capabilities.supportedRates || [])[0] || "",
    txNm: csvText(optical?.txNm), rxNm: csvText(optical?.rxNm),
    fiberCount: optical?.fiberCount ? String(optical.fiberCount) : "",
    mpoPolarity: optical?.mpoPolarity || "", laneMapping: csvText(optical?.laneMapping)
  };
  let advancedOpen = false;
  let edited = false;
  let apply;
  let mpoForm;
  const el = (tag, text = "") => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };
  const fieldset = el("fieldset");
  fieldset.disabled = disabled;
  fieldset.style.cssText = "border:0;padding:0;margin:0;min-inline-size:0";
  const summary = el("div", [
    CAGE_DEFINITION_CHOICES.find(([value]) => value === physical)?.[1] || "QSFP (form unspecified)",
    transceiverModulePresentation(connector),
    disabled ? "Cage occupied or locked" : ""
  ].filter(Boolean).join(" | "));
  summary.className = "field-hint";
  summary.style.overflowWrap = "anywhere";
  root.replaceChildren(el("h4", "Transceiver"), summary, fieldset);
  const error = el("p");
  error.className = "field-hint";
  error.setAttribute("role", "alert");
  error.hidden = true;
  root.append(error);
  const setError = message => { error.textContent = message; error.hidden = !message; };
  const appendField = (parent, control, title) => {
    const field = el("div"); field.className = "field";
    const label = el("label", title); label.htmlFor = control.id;
    field.append(label, control); parent.append(field);
  };

  function select(parent, key, label, options, onChange) {
    const control = el("select");
    control.id = key === "profile" ? "connectorModule" : `transceiver-${key}`;
    for (const [value, title] of options) {
      const opt = el("option", title); opt.value = value; control.append(opt);
    }
    control.value = draft[key];
    if (control.selectedIndex < 0) control.selectedIndex = 0;
    draft[key] = control.value;
    control.addEventListener("change", () => {
      draft[key] = control.value;
      edited = true;
      apply.disabled = false;
      setError("");
      onChange?.();
    });
    appendField(parent, control, label);
  }
  function input(parent, key, label) {
    const control = el("input");
    control.id = `transceiver-${key}`;
    control.value = draft[key];
    control.maxLength = 180;
    control.addEventListener("input", () => {
      draft[key] = control.value; edited = true; apply.disabled = false; setError("");
    });
    appendField(parent, control, label);
  }
  function resetOptical() {
    delete draft.mpoPhysical;
    Object.assign(draft, { signalFamily: "ethernet", arrangement: draft.interface === "mpo" ? "parallel" : "duplex",
      profile: "", lineRate: "", technology: "", txNm: "", rxNm: "", fiberCount: "", mpoPolarity: "", laneMapping: "" });
    render();
  }
  function render() {
    mpoForm = null;
    fieldset.replaceChildren();
    select(fieldset, "method", "Configuration", [["standard", "Standard Profile"], ["custom", "Custom Transceiver"]], render);
    if (draft.method === "standard") {
      select(fieldset, "profile", "Profile", [["", choices.standard.length ? "Select a profile" : "No applicable standard profiles"],
        ...choices.standard.map(p => [p.value, profileLabel(p)])]);
    } else {
      select(fieldset, "interface", "External interface", interfaces.map(iface => [iface, labelForInterface[iface]]), resetOptical);
      if (opticalInterface(draft.interface)) {
        const families = choices.fiberFamilies[draft.interface];
        const sdi = draft.interface === "lc" && choices.opticalSdi;
        if (sdi) {
          select(fieldset, "signalFamily", "Signal family", [...(families.length ? [["ethernet", "Ethernet"]] : []), ["sdi", "Optical SDI"]], () => {
            Object.assign(draft, { arrangement: draft.signalFamily === "sdi" ? "simplex" : "duplex", lineRate: "", technology: "", txNm: "", rxNm: "" });
            render();
          });
        } else draft.signalFamily = "ethernet";
        if (draft.signalFamily === "sdi") {
          draft.fiberFamily = "single-mode"; draft.arrangement = "simplex";
          fieldset.append(el("p", `${choices.role === "input" ? "Receive" : "Transmit"} • Simplex • Single-mode`));
        } else {
          select(fieldset, "fiberFamily", "Fibre family", families.map(family => [family, fiberLabels[family]]), render);
          if (draft.fiberFamily === "multimode") {
            select(fieldset, "fiberGrade", "Fibre grade", [["", "Unspecified"], ["om3", "OM3"], ["om4", "OM4"], ["om5", "OM5"]]);
          }
          if (draft.interface === "lc") {
            select(fieldset, "arrangement", "Fibre arrangement", [["duplex", "Duplex"], ["simplex", "Simplex"]], () => {
              draft.technology = ""; draft.txNm = ""; draft.rxNm = ""; render();
            });
          } else fieldset.append(el("p", "Parallel fibre"));
        }
        select(fieldset, "technology", "Optical technology", opticalTechnologiesFor(draft.arrangement, draft.signalFamily));
        input(fieldset, "lineRate", "Line rate (optional)");
        const advanced = el("details"); advanced.open = advancedOpen;
        advanced.addEventListener("toggle", () => { advancedOpen = advanced.open; });
        advanced.append(el("summary", "Advanced"));
        if (draft.signalFamily !== "sdi" || choices.role === "output") input(advanced, "txNm", "TX wavelengths (nm, comma-separated)");
        if (draft.signalFamily !== "sdi" || choices.role === "input") input(advanced, "rxNm", "RX wavelengths (nm, comma-separated)");
        if (draft.interface === "mpo") {
          const physical = draft.mpoPhysical === undefined ? installed.capabilities.mpoPhysical : draft.mpoPhysical;
          mpoForm = mountMpoPhysicalFields(advanced, physical, { onChange: () => {
            draft.mpoPhysical = mpoForm.read(); edited = true; apply.disabled = false; setError("");
          } });
          select(advanced, "fiberCount", "MPO fibre count", [["", "Unspecified"], ...MPO_FIBER_COUNTS.map(count => [String(count), String(count)])]);
          select(advanced, "mpoPolarity", "MPO polarity", [["", "Unspecified"], ...MPO_POLARITIES.map(type => [type, `Type ${type}`])]);
          input(advanced, "laneMapping", "Lane fibre positions (comma-separated)");
        }
        fieldset.append(advanced);
      } else if (["dac", "aoc", "bnc"].includes(draft.interface)) {
        const profiles = draft.interface === "bnc" ? choices.coax : choices.assemblies.filter(p => p.value.startsWith(`${draft.interface}-`));
        select(fieldset, "profile", draft.interface === "bnc" ? "SDI rate" : "Cable assembly",
          profiles.map(p => [p.value, draft.interface === "bnc" ? p.capabilities.supportedRates[0] || "Unspecified" : p.label]));
      }
    }
    apply = el("button", "Apply Transceiver"); apply.type = "button"; apply.className = "tool-button"; apply.disabled = !edited;
    apply.addEventListener("click", () => {
      const optical = draft.method === "custom" && opticalInterface(draft.interface);
      const config = optical ? { ...draft, fiberGrade: draft.fiberFamily === "multimode" ? draft.fiberGrade : "",
        ...(draft.interface === "mpo" && mpoForm?.read() != null ? { mpoPhysical: mpoForm.read() } : {}),
        txNm: csvNumbers(draft.txNm), rxNm: csvNumbers(draft.rxNm),
        fiberCount: draft.fiberCount ? Number(draft.fiberCount) : null, laneMapping: csvNumbers(draft.laneMapping) }
        : { method: draft.method, interface: draft.method === "custom" ? draft.interface : undefined, profile: draft.profile };
      try { if (transceiverConfigurationPatch(connector, config)) commit(config); }
      catch (failure) { setError(failure.message); }
    });
    fieldset.append(apply);
  }
  render();
}
