const LED_SIGNAL_TYPE = "led-signal";
const orphanedPersonalSignalType = /^led-signal-personal-[0-9a-f]{8}(?:-\d+)?$/;

// Personal node collision resolution once renamed built-in LED signals, leaving
// saved processors with node IDs that no longer exist in the project library.
export function restoreLedProcessorSignalTypes(definition) {
  if (definition?.isLedProcessor !== true || !Array.isArray(definition.connectors)) return 0;
  let repaired = 0;
  for (const connector of definition.connectors) {
    if (connector?.direction !== "output" || !Number.isSafeInteger(Number(connector.signalIndex))
      || Number(connector.signalIndex) < 1 || !orphanedPersonalSignalType.test(connector.type || "")) continue;
    for (const field of ["type", "physicalType", "connectorType", "cableType"]) {
      if (orphanedPersonalSignalType.test(connector[field] || "")) connector[field] = LED_SIGNAL_TYPE;
    }
    repaired++;
  }
  return repaired;
}

export function restoreProjectLedProcessorSignalTypes(project) {
  let repaired = 0;
  for (const definition of project?.deviceLibrary || []) repaired += restoreLedProcessorSignalTypes(definition);
  const restoreInstance = instance => {
    repaired += restoreLedProcessorSignalTypes(instance?.templateOverride);
  };
  for (const instance of project?.devices || []) restoreInstance(instance);
  for (const rack of project?.racks || []) for (const instance of rack?.devices || []) restoreInstance(instance);
  return repaired;
}

export function isLedProcessorMainSignalOutput(device, connector) {
  return Boolean(
    device?.visual?.isLedProcessor
      && connector?.type === LED_SIGNAL_TYPE
      && connector?.direction === "output"
  );
}

export function ledProcessorOutputsInRect(scene, rect = {}) {
  const outputs = [];
  for (const device of scene?.devices || []) {
    if (!device?.visual?.isLedProcessor) continue;
    for (const connector of connectorsForDevice(device)) {
      if (!isLedProcessorMainSignalOutput(device, connector)) continue;
      if (scene.isConnectorSelectableOnCanvas?.(device, connector) === false) continue;
      const point = scene.connectorWorldPoint(device, connector);
      if (!pointInRect(point, rect)) continue;
      outputs.push(outputRecord(device, connector, point));
    }
  }
  return outputs.sort(compareOutputs);
}

export function selectedLedProcessorOutputs(scene, selectedConnectorKeys = []) {
  const outputs = [];
  for (const key of selectedConnectorKeys || []) {
    const [deviceId, connectorId] = splitConnectorKey(key);
    const device = scene?.getDevice?.(deviceId);
    const connector = scene?.getConnector?.(deviceId, connectorId);
    if (!isLedProcessorMainSignalOutput(device, connector)) continue;
    if (scene.isConnectorSelectableOnCanvas?.(device, connector) === false) continue;
    const point = scene.connectorWorldPoint(device, connector);
    if (scene.connectorExternalWireIds(deviceId, connectorId).size) continue;
    outputs.push(outputRecord(device, connector, point));
  }
  return outputs.sort(compareOutputs);
}

export function shouldUseLedProcessorOutputMarquee(deviceIds = [], outputs = [], rect = {}) {
  if (!outputs.length) return false;
  // A fully enclosed processor is a device selection, even if all its outputs
  // also fall inside the marquee. Partial edge selections still select nodes.
  if (outputs.some(({ device }) => pointInRect(device, rect)
    && pointInRect({ x: device.x + device.width, y: device.y + device.height }, rect))) return false;
  if (!deviceIds.length) return true;
  const ledDeviceIds = new Set(outputs.map(output => output.deviceId));
  return deviceIds.every(deviceId => ledDeviceIds.has(deviceId));
}

function outputRecord(device, connector, point) {
  return {
    deviceId: String(device.id),
    connectorId: String(connector.id),
    device,
    connector,
    point: { x: Number(point.x) || 0, y: Number(point.y) || 0 },
    signalIndex: signalIndexForConnector(connector)
  };
}

function connectorsForDevice(device) {
  if (Array.isArray(device?.connectors)) return device.connectors;
  return [...(device?.connectorsById?.values?.() || [])];
}

function pointInRect(point, rect) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  const left = Number(rect?.x);
  const top = Number(rect?.y);
  const right = left + Number(rect?.width);
  const bottom = top + Number(rect?.height);
  return [x, y, left, top, right, bottom].every(Number.isFinite)
    && x >= Math.min(left, right)
    && x <= Math.max(left, right)
    && y >= Math.min(top, bottom)
    && y <= Math.max(top, bottom);
}

function signalIndexForConnector(connector = {}) {
  const direct = Number(connector.signalIndex ?? connector.ledSignalIndex);
  return Number.isFinite(direct) ? direct : 0;
}

function compareOutputs(a, b) {
  return a.deviceId.localeCompare(b.deviceId)
    || a.signalIndex - b.signalIndex
    || a.point.y - b.point.y
    || a.connectorId.localeCompare(b.connectorId);
}

function splitConnectorKey(key) {
  const text = String(key || "");
  const separator = text.indexOf(":");
  return separator < 0
    ? [text, ""]
    : [text.slice(0, separator), text.slice(separator + 1)];
}
