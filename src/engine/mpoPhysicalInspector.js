import { MPO_CATEGORIES, MPO_REFERENCE, mpoPositionMappingPreset } from "./mpoPhysical.js";
import { WAVELENGTH_MODES } from "./customTransceiverOptics.js";
import { mpoFibreGrades, standaloneMpoFibre, standaloneMpoPatch } from "./standaloneConnectors.js";

// A local form draft: mounting or expanding it never writes missing properties.
export function mountMpoPhysicalFields(root, initial, { onChange = () => {}, prefix = "mpo", expanded = false, cableMapping = true, showFibreCategory = true } = {}) {
  let value = initial == null ? undefined : structuredClone(initial);
  const current = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const el = (tag, text) => { const n = document.createElement(tag); if (text) n.textContent = text; return n; };
  const details = el(expanded ? "div" : "details"), summary = el(expanded ? "h5" : "summary", "MPO physical properties");
  details.append(summary);
  function field(key, label, options, container = details) {
    const wrap = el("div"), title = el("label", label), control = el(options ? "select" : "input");
    wrap.className = "field"; title.htmlFor = control.id = prefix + "-" + key;
    if (options) for (const [id, text] of [["", "Unspecified"], ...options]) {
      const option = el("option", text); option.value = id; control.append(option);
    }
    control.value = Array.isArray(current[key]) ? current[key].join(", ") : current[key] ?? "";
    if (!options) control.maxLength = 240;
    wrap.append(title, control); container.append(wrap);
    control.addEventListener("change", () => {
      if (key.startsWith("_")) return;
      value = { ...(value && typeof value === "object" && !Array.isArray(value) ? value : {}), schemaVersion: 1 };
      const v = control.value.trim();
      if (v) value[key] = ["activePositions", "populatedPositions"].includes(key) ? v.split(/[\s,]+/).map(Number) : v;
      else delete value[key];
      if (key === "format") { if (v === "mpo-12") value.positionCount = 12; else delete value.positionCount; }
      if (["populatedPositions", "activePositions"].includes(key) && v) value.reference ??= MPO_REFERENCE;
      onChange();
    });
    return control;
  }
  field("format", "MPO Format", [["mpo-12", "MPO-12 (1 x 12)"]], root);
  root.append(details);
  if (showFibreCategory) field("fiberCategory", "MPO fibre category", MPO_CATEGORIES.map(grade => [grade, grade.toUpperCase()]));
  field("pinConfiguration", "Guide pins", [["pinned", "Pinned (male)"], ["unpinned", "Unpinned (female)"]]);
  field("polish", "Ferrule polish", [["upc", "UPC"], ["apc", "APC"]]);
  field("keying", "MPO keying", [["centered", "Centred key"]]);
  field("keyOrientation", "Connector key orientation", [["up", "Up"], ["down", "Down"]]);
  field("matingOrientation", "Mating adapter orientation", [
    ["key-up-to-key-down", "Key-up to key-down"], ["key-up-to-key-up", "Key-up to key-up"]]);
  field("populatedPositions", "Populated fibre positions");
  field("activePositions", "Active fibre positions");
  if (!cableMapping) return { read: () => value };
  const mapping = current.positionMapping;
  const preset = field("_mapping", "Cable mapping preset", [["A", "Type A"], ["B", "Type B"], ["C", "Type C"], ["custom", "Custom map"]]);
  preset.value = mapping ? mapping.polarity || "custom" : "";
  const pairs = field("_pairs", "Cable position pairs (from:to)");
  pairs.value = Array.isArray(mapping?.pairs) ? mapping.pairs.map(p => p.from + ":" + p.to).join(", ") : "";
  const saveMap = () => {
    value = { ...(value && typeof value === "object" && !Array.isArray(value) ? value : {}), schemaVersion: 1 };
    if (!preset.value && !pairs.value.trim()) delete value.positionMapping;
    else value.positionMapping = { schemaVersion: 1, scope: "cable", positionCount: 12,
      fromReference: MPO_REFERENCE, toReference: MPO_REFERENCE,
      ...(preset.value && preset.value !== "custom" ? { polarity: preset.value } : {}),
      pairs: pairs.value.trim() ? pairs.value.split(",").map(pair => {
        const numbers = pair.trim().split(":");
        return { from: Number(numbers[0]), to: numbers.length === 2 ? Number(numbers[1]) : NaN };
      }) : [] };
    onChange();
  };
  preset.addEventListener("change", () => {
    if (["A", "B", "C"].includes(preset.value)) {
      const map = mpoPositionMappingPreset(preset.value);
      pairs.value = map.pairs.map(p => p.from + ":" + p.to).join(", ");
    } else if (!preset.value) pairs.value = "";
    saveMap();
  });
  pairs.addEventListener("change", saveMap);
  return { read: () => value };
}

export function mountFixedMpoInspector(root, connector, { commit, disabled = false, prefix = "fixed-mpo" } = {}) {
  root.replaceChildren();
  const fieldset = document.createElement("fieldset");
  fieldset.disabled = disabled;
  fieldset.style.cssText = "border:0;padding:0;margin:0;min-inline-size:0";
  root.append(fieldset);
  const button = document.createElement("button");
  button.type = "button"; button.className = "tool-button"; button.textContent = "Apply MPO Properties"; button.disabled = true;
  const fibre = standaloneMpoFibre(connector);
  let fibreChanged = false, wavelengthChanged = false;
  function select(key, title, options) {
    const field = document.createElement("label"), text = document.createElement("span"), control = document.createElement("select");
    field.className = "field";
    text.textContent = title;
    control.id = prefix + "-" + key;
    field.append(text, control);
    fieldset.append(field);
    fill(control, options, fibre[key]);
    control.addEventListener("change", () => {
      fibre[key] = control.value;
      if (key === "wavelengthMode") wavelengthChanged = true;
      else fibreChanged = true;
      button.disabled = false;
    });
    return control;
  }
  function fill(control, options, value) {
    control.replaceChildren(...options.map(([id, label]) => new Option(label, id)));
    control.value = options.some(([id]) => id === value) ? value : "";
  }
  const gradeOptions = () => [["", "Unspecified"], ...mpoFibreGrades(fibre.family).map(grade => [grade, grade.toUpperCase()])];
  const family = select("family", "Fibre category", [["", "Unspecified"], ["single-mode", "Single-mode"], ["multimode", "Multimode"]]);
  const grade = select("grade", "Fibre grade", gradeOptions());
  grade.disabled = !fibre.family;
  family.addEventListener("change", () => {
    fibre.grade = "";
    fill(grade, gradeOptions(), "");
    grade.disabled = !fibre.family;
  });
  const arrangement = document.createElement("p");
  arrangement.className = "field-hint";
  arrangement.textContent = "Fibre arrangement: Parallel";
  fieldset.append(arrangement);
  select("wavelengthMode", "Wavelength Mode", WAVELENGTH_MODES);
  const draft = mountMpoPhysicalFields(fieldset, connector.mpoPhysical, { prefix, cableMapping: false, showFibreCategory: false,
    onChange: () => { button.disabled = false; } });
  const error = document.createElement("p"); error.setAttribute("role", "alert"); error.hidden = true;
  button.addEventListener("click", () => {
    try { commit(standaloneMpoPatch(connector, draft.read(), fibre, { fibreChanged, wavelengthChanged })); error.hidden = true; }
    catch (failure) { error.textContent = failure.message; error.hidden = false; }
  });
  fieldset.append(button, error);
}
