export const LEGACY_ADAPTER_WIDTH = 190;
export const LEGACY_ADAPTER_NODE_EDGE_PADDING = 16;
export const LEGACY_ADAPTER_NODE_RADIUS = 7;
export const LEGACY_ADAPTER_START_Y = LEGACY_ADAPTER_NODE_EDGE_PADDING + LEGACY_ADAPTER_NODE_RADIUS;
export const LEGACY_ADAPTER_MIN_HEIGHT = LEGACY_ADAPTER_START_Y + LEGACY_ADAPTER_NODE_EDGE_PADDING + LEGACY_ADAPTER_NODE_RADIUS;

const ADAPTER_BREAKOUT_CATEGORY_RE = /\b(?:adapters?|breakouts?)\b/i;

export function isAdapterTemplateLikeForEngine(template = {}, instance = {}) {
  return template?.objectType === "adapter"
    || instance?.objectType === "adapter"
    || template?.isAdapterBreakout === true
    || instance?.isAdapterBreakout === true;
}

export function adapterClassificationForEngine(template = {}, instance = {}, isAdapter = isAdapterTemplateLikeForEngine(template, instance)) {
  const category = String(instance?.category || template?.category || template?.type || template?.section || "").trim();
  const legacyFlag = template?.objectType === "adapter"
    || instance?.objectType === "adapter"
    || template?.isAdapterBreakout === true
    || instance?.isAdapterBreakout === true;
  return {
    isAdapter,
    legacyFlag,
    categoryMatch: ADAPTER_BREAKOUT_CATEGORY_RE.test(category),
    objectType: String(instance?.objectType || template?.objectType || ""),
    isAdapterBreakout: template?.isAdapterBreakout === true || instance?.isAdapterBreakout === true,
    category
  };
}

export function adapterHeightForConnectors(connectors = [], explicitHeight = 0) {
  const usable = adapterUsableConnectors(connectors);
  const maxConnectorY = usable.reduce((max, connector) => {
    const y = Number(connector.y);
    return Number.isFinite(y) ? Math.max(max, y) : max;
  }, LEGACY_ADAPTER_START_Y);
  return Math.max(
    LEGACY_ADAPTER_MIN_HEIGHT,
    positiveNumber(explicitHeight) || 0,
    Math.ceil(maxConnectorY + LEGACY_ADAPTER_NODE_RADIUS + LEGACY_ADAPTER_NODE_EDGE_PADDING)
  );
}

export function adapterInternalWirePairs(connectors = []) {
  const { inputs, outputs } = adapterConnectorGroups(connectors);
  if (!inputs.length || !outputs.length) return [];
  if (inputs.length === 1) return outputs.map(output => adapterPair(inputs[0], output));
  if (outputs.length === 1) return inputs.map(input => adapterPair(input, outputs[0]));
  if (inputs.length < outputs.length) {
    return outputs.map((output, index) => adapterPair(
      inputs[Math.min(inputs.length - 1, Math.floor(index * inputs.length / outputs.length))],
      output
    ));
  }
  if (outputs.length < inputs.length) {
    return inputs.map((input, index) => adapterPair(
      input,
      outputs[Math.min(outputs.length - 1, Math.floor(index * outputs.length / inputs.length))]
    ));
  }
  return inputs.map((input, index) => adapterPair(input, outputs[index]));
}

export function adapterMappingForDevice(device = {}) {
  const connectors = Array.isArray(device.connectors) ? device.connectors : [];
  const { inputs, outputs } = adapterConnectorGroups(connectors);
  const branches = adapterInternalWirePairs(connectors);
  return {
    deviceId: String(device.id || ""),
    isAdapter: device.kind === "adapter" || Boolean(device.visual?.isAdapterBreakout),
    sources: inputs,
    destinations: outputs,
    branches,
    branchCount: branches.length,
    fanDirection: adapterFanDirection(inputs.length, outputs.length),
    multipleInternalBranches: branches.length > Math.min(inputs.length || 0, outputs.length || 0),
    // Legacy still treats real project endpoints as single external cable
    // sockets. The multi-branch behavior is the internal derived fan-out/fan-in
    // visual, not duplicate reportable project cables.
    multipleExternalConnections: false
  };
}

export function adapterInternalBezierGeometry(input, output, baseX = 0, baseY = 0) {
  const start = {
    x: baseX + connectorRenderX(input),
    y: baseY + connectorRenderY(input)
  };
  const end = {
    x: baseX + connectorRenderX(output),
    y: baseY + connectorRenderY(output)
  };
  const dir = end.x >= start.x ? 1 : -1;
  const dx = Math.max(36, Math.abs(end.x - start.x) * 0.42);
  return {
    start,
    c1: { x: start.x + dx * dir, y: start.y },
    c2: { x: end.x - dx * dir, y: end.y },
    end
  };
}

export function traceAdapterInternalWirePath(ctx, input, output, baseX = 0, baseY = 0) {
  const geometry = adapterInternalBezierGeometry(input, output, baseX, baseY);
  ctx.moveTo(geometry.start.x, geometry.start.y);
  ctx.bezierCurveTo(geometry.c1.x, geometry.c1.y, geometry.c2.x, geometry.c2.y, geometry.end.x, geometry.end.y);
  return geometry;
}

export function adapterColorStops(inputColor, outputColor) {
  return [
    { offset: 0, color: inputColor },
    { offset: 0.25, color: inputColor },
    { offset: 0.75, color: outputColor },
    { offset: 1, color: outputColor }
  ];
}

function adapterConnectorGroups(connectors = []) {
  const usable = adapterUsableConnectors(connectors);
  return {
    inputs: usable
      .filter(connector => connector.direction === "input")
      .sort(connectorSort),
    outputs: usable
      .filter(connector => connector.direction !== "input")
      .sort(connectorSort)
  };
}

function adapterUsableConnectors(connectors = []) {
  return (Array.isArray(connectors) ? connectors : [])
    .filter(connector => connector && !connector.empty && connector.type)
    .slice();
}

function adapterPair(input, output) {
  return {
    input,
    output,
    inputId: String(input?.id || ""),
    outputId: String(output?.id || "")
  };
}

function adapterFanDirection(inputCount, outputCount) {
  if (inputCount === 1 && outputCount > 1) return "fan-out";
  if (outputCount === 1 && inputCount > 1) return "fan-in";
  if (inputCount === outputCount) return "one-to-one";
  return inputCount < outputCount ? "distributed-fan-out" : "distributed-fan-in";
}

function connectorSort(a, b) {
  return (Number(a.y) || 0) - (Number(b.y) || 0)
    || (Number(a.x) || 0) - (Number(b.x) || 0)
    || String(a.id || "").localeCompare(String(b.id || ""));
}

function connectorRenderX(connector = {}) {
  if (Number.isFinite(Number(connector.x))) return Number(connector.x);
  return connector.side === "right" || connector.direction === "output" ? LEGACY_ADAPTER_WIDTH : 0;
}

function connectorRenderY(connector = {}) {
  if (Number.isFinite(Number(connector.y))) return Number(connector.y);
  return LEGACY_ADAPTER_START_Y;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
