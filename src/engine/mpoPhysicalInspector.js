import { MPO_REFERENCE, mpoPositionMappingPreset } from "./mpoPhysical.js";

// A local form draft: mounting or expanding it never writes missing properties.
export function mountMpoPhysicalFields(root, initial, { onChange = () => {}, prefix = "mpo", expanded = false } = {}) {
  let value = initial == null ? undefined : structuredClone(initial);
  const current = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const el = (tag, text) => { const n = document.createElement(tag); if (text) n.textContent = text; return n; };
  const details = el(expanded ? "div" : "details"), summary = el(expanded ? "h5" : "summary", "MPO physical properties");
  details.append(summary); root.append(details);
  const controls = {};
  function field(key, label, options) {
    const wrap = el("div"), title = el("label", label), control = el(options ? "select" : "input");
    wrap.className = "field"; title.htmlFor = control.id = prefix + "-" + key;
    if (options) for (const [id, text] of [["", "Unspecified"], ...options]) {
      const option = el("option", text); option.value = id; control.append(option);
    }
    control.value = Array.isArray(current[key]) ? current[key].join(", ") : current[key] ?? "";
    if (!options) control.maxLength = 240;
    wrap.append(title, control); details.append(wrap); controls[key] = control;
    control.addEventListener("change", () => {
      value = { ...(value && typeof value === "object" && !Array.isArray(value) ? value : {}), schemaVersion: 1 };
      const v = control.value.trim();
      if (v) value[key] = ["activePositions", "populatedPositions"].includes(key) ? v.split(/[\s,]+/).map(Number) : v;
      else delete value[key];
      if (key === "format") { if (v === "mpo-12") value.positionCount = 12; else delete value.positionCount; }
      onChange();
    });
    return control;
  }
  field("format", "MPO format", [["mpo-12", "MPO-12 (1 x 12)"]]);
  field("fiberCategory", "MPO fibre category", [["os2", "OS2"], ["om3", "OM3"], ["om4", "OM4"]]);
  field("termination", "MPO termination", [["receptacle", "Equipment receptacle"], ["plug", "Cable / adapter plug"]]);
  field("pinConfiguration", "Guide pins", [["pinned", "Pinned (male)"], ["unpinned", "Unpinned (female)"]]);
  field("polish", "Ferrule polish", [["upc", "UPC"], ["apc", "APC"]]);
  field("keying", "MPO keying", [["centered", "Centred key"]]);
  field("keyOrientation", "Connector key orientation", [["up", "Up"], ["down", "Down"]]);
  field("matingOrientation", "Mating adapter orientation", [
    ["key-up-to-key-down", "Key-up to key-down"], ["key-up-to-key-up", "Key-up to key-up"]]);
  field("reference", "Fibre numbering reference", [[MPO_REFERENCE, "Mating face, key up, left to right"]]);
  field("populatedPositions", "Populated fibre positions");
  field("activePositions", "Active fibre positions");
  const mapping = current.positionMapping;
  const preset = field("_mapping", "Cable mapping preset", [["A", "Type A"], ["B", "Type B"], ["C", "Type C"], ["custom", "Custom map"]]);
  preset.value = mapping ? mapping.polarity || "custom" : "";
  const pairs = field("_pairs", "Cable position pairs (from:to)");
  pairs.value = Array.isArray(mapping?.pairs) ? mapping.pairs.map(p => p.from + ":" + p.to).join(", ") : "";
  const mapRef = field("_reference", "Cable map numbering reference", [[MPO_REFERENCE, "Mating face, key up, left to right at both ends"]]);
  mapRef.value = mapping?.fromReference === mapping?.toReference ? mapping?.fromReference || "" : "";
  const saveMap = () => {
    delete value._mapping; delete value._pairs; delete value._reference;
    if (!preset.value && !pairs.value.trim()) { delete value.positionMapping; return; }
    value.positionMapping = { schemaVersion: 1, scope: "cable", positionCount: 12,
      ...(mapRef.value ? { fromReference: mapRef.value, toReference: mapRef.value } : {}),
      ...(preset.value && preset.value !== "custom" ? { polarity: preset.value } : {}),
      pairs: pairs.value.trim() ? pairs.value.split(",").map(pair => {
        const numbers = pair.trim().split(":");
        return { from: Number(numbers[0]), to: numbers.length === 2 ? Number(numbers[1]) : NaN };
      }) : [] };
  };
  preset.addEventListener("change", () => {
    if (["A", "B", "C"].includes(preset.value)) {
      const map = mpoPositionMappingPreset(preset.value);
      pairs.value = map.pairs.map(p => p.from + ":" + p.to).join(", ");
      mapRef.value = MPO_REFERENCE;
    } else if (!preset.value) { pairs.value = ""; mapRef.value = ""; }
    saveMap();
  });
  for (const control of [pairs, mapRef]) control.addEventListener("change", saveMap);
  return { read: () => value };
}

export function mountFixedMpoInspector(root, initial, { commit, disabled = false, prefix = "fixed-mpo" } = {}) {
  root.replaceChildren();
  const fieldset = document.createElement("fieldset");
  fieldset.disabled = disabled;
  fieldset.style.cssText = "border:0;padding:0;margin:0;min-inline-size:0";
  root.append(fieldset);
  const button = document.createElement("button");
  button.type = "button"; button.className = "tool-button"; button.textContent = "Apply MPO Properties"; button.disabled = true;
  const draft = mountMpoPhysicalFields(fieldset, initial, { prefix, onChange: () => { button.disabled = false; } });
  const error = document.createElement("p"); error.setAttribute("role", "alert"); error.hidden = true;
  button.addEventListener("click", () => {
    try { commit(draft.read()); error.hidden = true; }
    catch (failure) { error.textContent = failure.message; error.hidden = false; }
  });
  fieldset.append(button, error);
}
