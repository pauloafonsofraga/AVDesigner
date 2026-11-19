import { hasPhysicalConnectorMetadata, physicalConnectorDeclarationIssue } from "./physicalConnectorMetadata.js";

export function mountPhysicalConnectorInspector(root, connector, { commit, disabled = false } = {}) {
  if (!root || !hasPhysicalConnectorMetadata(connector)) return;
  const type = connector.physicalType || connector.type;
  const details = document.createElement("details"), summary = document.createElement("summary");
  summary.textContent = "Physical connector & signal"; details.append(summary); root.append(details);
  const fields = ["signalFamily", "protocol", "pinoutId"];
  if (type === "pluggable-terminal") fields.unshift("poleCount", "pitchMm", "series");
  if (type === "circular-din") fields.unshift("pinCount", "pinConfiguration", "diameterMm");
  if (type === "rj12") fields.unshift("contactCount");
  if (["external-pcie-link", "livecore-link"].includes(type)) fields.unshift("vendorInterface");
  const names = { signalFamily: "Signal family", protocol: "Protocol", pinoutId: "Documented pinout ID", poleCount: "Pole count", pitchMm: "Pitch (mm)", series: "Terminal series", pinCount: "Pin count", pinConfiguration: "Pin arrangement (e.g. DIN 180 degrees)", diameterMm: "Diameter (mm)", contactCount: "Populated contacts", vendorInterface: "Vendor interface" };
  let draft = structuredClone(connector.physicalConstraints || { version: 1 });
  const error = document.createElement("small"); error.setAttribute("role", "status");
  for (const field of fields) {
    const label = document.createElement("label"), title = document.createElement("span"), input = document.createElement("input");
    label.className = "field"; title.textContent = names[field]; input.dataset.physicalField = field;
    const numeric = ["poleCount", "pinCount", "diameterMm", "pitchMm", "contactCount"].includes(field);
    input.type = numeric ? "number" : "text"; input.placeholder = "Unknown"; input.disabled = disabled;
    if (numeric) { input.min = "0.01"; input.max = "128"; input.step = field.endsWith("Mm") ? "any" : "1"; }
    input.value = draft[field] ?? "";
    input.addEventListener("change", () => {
      const next = { ...draft, version: 1 };
      if (!input.value.trim()) delete next[field]; else next[field] = numeric ? Number(input.value) : input.value.trim();
      const issue = physicalConnectorDeclarationIssue(type, next);
      if (issue) { error.textContent = issue; input.value = draft[field] ?? ""; return; }
      try { commit(next); draft = next; error.textContent = ""; }
      catch (e) { error.textContent = e.message; input.value = draft[field] ?? ""; }
    });
    label.append(title, input); details.append(label);
  }
  details.append(error);
}
