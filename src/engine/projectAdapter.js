const SIZE_PRESETS = {
  small: { deviceCount: 100, wireCount: 300 },
  medium: { deviceCount: 1000, wireCount: 5000 },
  large: { deviceCount: 5000, wireCount: 20000 }
};

const WIRE_COLORS = [
  "#2962ff",
  "#ffd600",
  "#00e676",
  "#32b6ff",
  "#ff99cc",
  "#cfdae0",
  "#ff7904"
];

export function syntheticPreset(name) {
  return SIZE_PRESETS[name] || SIZE_PRESETS.small;
}

export function generateSyntheticProject({ deviceCount = 100, wireCount = 300 } = {}) {
  const buildStart = performance.now();
  const columns = Math.max(1, Math.ceil(Math.sqrt(deviceCount) * 1.35));
  const devices = [];
  const wires = [];
  const stepX = 190;
  const stepY = 112;
  for (let index = 0; index < deviceCount; index += 1) {
    const col = index % columns;
    const row = Math.floor(index / columns);
    devices.push({
      id: `device-${index}`,
      x: col * stepX,
      y: row * stepY,
      width: 122,
      height: 58,
      portCount: 4,
      label: `D${index + 1}`
    });
  }
  for (let index = 0; index < wireCount; index += 1) {
    const fromIndex = index % deviceCount;
    const hop = 1 + ((index * 17) % Math.max(1, Math.min(deviceCount - 1, columns * 3)));
    const toIndex = (fromIndex + hop) % deviceCount;
    if (fromIndex === toIndex) continue;
    wires.push({
      id: `wire-${index}`,
      fromDeviceId: `device-${fromIndex}`,
      toDeviceId: `device-${toIndex}`,
      fromSide: "right",
      toSide: "left",
      fromPortIndex: index % 4,
      toPortIndex: (index * 3) % 4,
      color: WIRE_COLORS[index % WIRE_COLORS.length]
    });
  }
  console.info("[engine] synthetic project generated", {
    devices: devices.length,
    wires: wires.length,
    ms: Math.round((performance.now() - buildStart) * 10) / 10
  });
  return { devices, wires };
}

export async function loadProjectFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  return normalizeAvDesignerProject(data);
}

export function normalizeAvDesignerProject(data) {
  const root = data?.state || data?.project || data || {};
  const templates = collectTemplates(root, data);
  const rawDevices = Array.isArray(root.devices) ? root.devices : [];
  const devices = rawDevices.map((device, index) => {
    const templateId = device.templateId || device.deviceId || device.id || device.template;
    const template = templates.get(templateId) || templates.get(device.templateName) || {};
    const width = Number(device.width || template.width) || 122;
    const height = Number(device.height || template.height) || 58;
    const connectors = Array.isArray(device.connectors) ? device.connectors
      : Array.isArray(template.connectors) ? template.connectors
        : [];
    return {
      id: String(device.instanceId || device.id || `project-device-${index}`),
      x: Number(device.x) || 0,
      y: Number(device.y) || 0,
      width,
      height,
      portCount: Math.max(1, connectors.length || 4),
      label: device.name || template.name || `Device ${index + 1}`
    };
  });
  const deviceIds = new Set(devices.map(device => device.id));
  const rawConnections = Array.isArray(root.connections) ? root.connections : [];
  const wires = rawConnections.map((wire, index) => {
    const fromDeviceId = String(wire.from?.deviceId || wire.fromDeviceId || "");
    const toDeviceId = String(wire.to?.deviceId || wire.toDeviceId || "");
    if (!deviceIds.has(fromDeviceId) || !deviceIds.has(toDeviceId)) return null;
    return {
      id: String(wire.id || `project-wire-${index}`),
      fromDeviceId,
      toDeviceId,
      fromSide: "right",
      toSide: "left",
      fromPortIndex: index % 4,
      toPortIndex: (index * 3) % 4,
      color: wire.color || WIRE_COLORS[index % WIRE_COLORS.length]
    };
  }).filter(Boolean);
  if (!devices.length) return generateSyntheticProject(SIZE_PRESETS.small);
  return { devices, wires };
}

function collectTemplates(root, data) {
  const candidates = [
    root.deviceLibrary,
    root.templates,
    data?.deviceLibrary,
    data?.templates,
    data?.library?.devices
  ];
  const map = new Map();
  candidates.forEach(list => {
    if (!Array.isArray(list)) return;
    list.forEach(template => {
      const id = template.id || template.templateId || template.name;
      if (id) map.set(id, template);
      if (template.name) map.set(template.name, template);
    });
  });
  return map;
}
