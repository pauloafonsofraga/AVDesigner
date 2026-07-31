export function rackExposedPortKey(definitionDeviceId, connectorId) {
  return `${String(definitionDeviceId || "")}__${String(connectorId || "")}`;
}

export function normalizeRackExposedPorts(exposedPorts = []) {
  const seen = new Set();
  return (Array.isArray(exposedPorts) ? exposedPorts : [])
    .map(port => normalizeRackExposedPort(port))
    .filter(port => {
      if (!port || seen.has(port.key)) return false;
      seen.add(port.key);
      return true;
    });
}

export function normalizeRackExposedPort(port) {
  if (!port || typeof port !== "object") return null;
  const deviceId = String(port.rackDefinitionDeviceId || port.deviceId || "").trim();
  const connectorId = String(port.connectorId || "").trim();
  if (!deviceId || !connectorId) return null;
  return {
    ...port,
    deviceId,
    rackDefinitionDeviceId: deviceId,
    connectorId,
    key: rackExposedPortKey(deviceId, connectorId)
  };
}

export function rackDefinitionDeviceIdForChild(device, rack) {
  const explicit = String(device?.sourceRackDeviceId || "").trim();
  if (explicit) return explicit;
  const childId = String(device?.id || "").trim();
  const sourceMap = rack?.sourceDeviceMap && typeof rack.sourceDeviceMap === "object"
    ? rack.sourceDeviceMap
    : {};
  const match = Object.entries(sourceMap)
    .find(([, canvasChildId]) => String(canvasChildId || "") === childId);
  return String(match?.[0] || childId || "").trim();
}

export function rackExposedPortSet(rack) {
  return new Set(normalizeRackExposedPorts(rack?.exposedPorts).map(port => port.key));
}

export function isRackChildConnectorExposedOnCanvas(device, connector, rack) {
  if (!device?.rackId) return true;
  const definitionDeviceId = rackDefinitionDeviceIdForChild(device, rack);
  if (!definitionDeviceId || !connector?.id) return false;
  return rackExposedPortSet(rack).has(rackExposedPortKey(definitionDeviceId, connector.id));
}
