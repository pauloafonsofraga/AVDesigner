// One pure model shared by the classic application script and Engine modules.
(() => {
  function normalizeProjectorTemplate(template = {}) {
    const entries = Array.isArray(template?.projectorLenses) ? template.projectorLenses : [];
    const reserved = new Set(entries.map(lens => String(lens?.id || "").trim()).filter(Boolean));
    const used = new Set();
    let counter = 1;
    const projectorLenses = entries.map(lens => {
      let id = String(lens?.id || "").trim();
      if (!id || used.has(id)) {
        while (reserved.has(`lens-${counter}`)) counter++;
        id = `lens-${counter++}`;
        reserved.add(id);
      }
      used.add(id);
      return { id, name: String(lens?.name || "").trim() };
    });
    return { isProjector: template?.isProjector === true, projectorLenses };
  }

  function insertProjectorLens(template, afterId = "") {
    const normalized = normalizeProjectorTemplate(template);
    const used = new Set(normalized.projectorLenses.map(lens => lens.id));
    let counter = 1;
    while (used.has(`lens-${counter}`)) counter++;
    const lens = { id: `lens-${counter}`, name: "" };
    const index = normalized.projectorLenses.findIndex(entry => entry.id === afterId);
    normalized.projectorLenses.splice(index < 0 ? normalized.projectorLenses.length : index + 1, 0, lens);
    return { ...normalized, addedLensId: lens.id };
  }

  function resolveProjectorLens(template = {}, instance = {}) {
    const normalized = normalizeProjectorTemplate(template);
    const choices = normalized.projectorLenses.filter(lens => lens.name);
    const selected = choices.find(lens => lens.id === instance.selectedProjectorLensId)
      || (normalized.isProjector ? choices[0] : null);
    return { ...normalized, selectedProjectorLensId: selected?.id || "",
      projectorLensName: normalized.isProjector ? selected?.name || "" : "" };
  }

  globalThis.AVDesignerProjectors = Object.freeze({ normalizeProjectorTemplate, insertProjectorLens, resolveProjectorLens });
})();
