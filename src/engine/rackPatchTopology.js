function rootProject(project) {
  return project?.state || project?.project || project || {};
}

export function resolveRackPatchPresentation(projectInput, endpoint) {
  const project = rootProject(projectInput);
  const rackId = String(endpoint?.rackId || "");
  const panelId = String(endpoint?.patchPanelId || "");
  const portId = String(endpoint?.patchPortId || "");
  const deviceId = String(endpoint?.deviceId || "");
  const connectorId = String(endpoint?.connectorId || "");
  if (!rackId || !panelId || !portId || !deviceId || !connectorId) return null;

  const rack = (project.racks || []).find(item => String(item?.id || "") === rackId);
  if (!rack) return null;
  const sourceRack = rack.sourceRackId
    ? (project.racks || []).find(item => String(item?.id || "") === String(rack.sourceRackId)) || rack
    : rack;
  const panel = (sourceRack.patchPanels || rack.patchPanels || [])
    .find(item => String(item?.id || "") === panelId);
  const port = (panel?.ports || []).find(item => String(item?.id || "") === portId);
  if (!panel || !port || String(port.sourceConnectorId || "") !== connectorId) return null;

  const sourceDeviceId = String(port.sourceRackDeviceId || "");
  const instance = (project.devices || []).find(item => String(item?.instanceId || item?.id || "") === deviceId);
  if (!sourceDeviceId || !instance || instance.rackId && String(instance.rackId) !== rackId) return null;
  const mappedDeviceId = rack.sourceDeviceMap?.[sourceDeviceId];
  const matchesSource = mappedDeviceId
    ? String(mappedDeviceId) === deviceId
    : String(instance.sourceRackDeviceId || instance.instanceId || instance.id || "") === sourceDeviceId;
  if (!matchesSource) return null;

  return {
    resolved: true,
    rackId,
    rackName: String(rack.name || sourceRack.name || "Rack"),
    panelId,
    panelLabel: String(panel.label || "PATCH PANEL"),
    rackFace: panel.rackFace === "front" ? "front" : "rear",
    placementSide: panel.placementSide === "left" ? "left" : "right",
    portId,
    slot: Math.max(1, Math.trunc(Number(port.slot) || 1)),
    sourceRackDeviceId: sourceDeviceId,
    sourceConnectorId: String(port.sourceConnectorId || "")
  };
}
