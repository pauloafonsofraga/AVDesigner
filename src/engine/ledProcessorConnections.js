const LED_SIGNAL_TYPE = "led-signal";

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
    const point = scene.connectorWorldPoint(device, connector);
    if (scene.connectorExternalWireIds(deviceId, connectorId).size) continue;
    outputs.push(outputRecord(device, connector, point));
  }
  return outputs.sort(compareOutputs);
}

export function shouldUseLedProcessorOutputMarquee(deviceIds = [], outputs = []) {
  if (!outputs.length) return false;
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
