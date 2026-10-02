// The factory catalogue, not an alias prefix or display label, defines which
// node IDs are established electrical protocols.
export function canonicalFactoryNodeIds(nodeTypes) {
  const entries = Array.isArray(nodeTypes)
    ? nodeTypes.map(node => [node?.id, node])
    : Object.entries(nodeTypes || {});
  return new Set(entries
    .filter(([id, node]) => id && node?.custom !== true && id !== "misc")
    .map(([id]) => id));
}

export function generatedPersonalAliasBase(id, canonicalIds) {
  const match = /^(.+)-personal-[0-9a-f]{8}(?:-(?:[2-9]|[1-9]\d+))?$/.exec(String(id || ""));
  return match && canonicalIds?.has(match[1]) ? match[1] : "";
}

export function restoreNodeCompatibilityTypes(nodes, canonicalIds) {
  let repaired = 0;
  for (const node of nodes || []) {
    if (!node?.id || node.compatibilityType) continue;
    const base = generatedPersonalAliasBase(node.id, canonicalIds);
    if (!base) continue;
    node.compatibilityType = base;
    repaired++;
  }
  return repaired;
}

export function restoreProjectNodeCompatibilityTypes(project, nodeTypes) {
  const root = project?.state || project?.project || project;
  const canonicalIds = canonicalFactoryNodeIds(nodeTypes);
  return restoreNodeCompatibilityTypes(root?.nodeLibrary || root?.nodes, canonicalIds);
}
