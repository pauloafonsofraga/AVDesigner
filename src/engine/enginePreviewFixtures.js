const PNG_FACEPLATE_URL = "Devices/faceplates/E2.png";

const BASE_NODE_LIBRARY = [
  { id: "hdmi", type: "hdmi", color: "#ffd317" },
  { id: "display-port", type: "display-port", color: "#3d6cff" },
  { id: "mini-display-port", type: "mini-display-port", color: "#6d8cff" },
  { id: "dvi", type: "dvi", color: "#147f4d" },
  { id: "vga", type: "vga", color: "#f62459" },
  { id: "sdi", type: "sdi", color: "#1edd82" },
  { id: "trs-ts", type: "trs-ts", color: "#35b7ff" },
  { id: "ethercon", type: "ethercon", color: "#31a56a" },
  { id: "powercon", type: "powercon", color: "#ffd317" },
  { id: "powerlock", type: "powerlock", color: "#18d718" },
  { id: "usb-c", type: "usb-c", color: "#35b7ff" }
];

const FIXTURES = [
  {
    id: "normal-faceplate",
    label: "Normal Faceplate Device",
    template: {
      id: "preview-normal-faceplate-template",
      name: "Preview Faceplate",
      brand: "Engine",
      model: "PNG Faceplate",
      category: "Preview / Normal",
      width: 460,
      height: 270,
      schemaVersion: 2,
      faceImage: PNG_FACEPLATE_URL,
      faceImageNaturalWidth: 1140,
      faceImageNaturalHeight: 420,
      connectors: [
        connector("input-hdmi", "hdmi", "input", 0, 166, { nameText: "IN 1", resolutionFrameRate: "4K60" }),
        connector("input-dvi", "dvi", "input", 0, 220, { nameText: "IN 2" }),
        connector("output-hdmi", "hdmi", "output", 460, 166, { nameText: "OUT 1" }),
        connector("lan", "ethercon", "output", 460, 220, { nameText: "LAN" })
      ]
    },
    instance: { instanceId: "preview-normal-faceplate", x: 80, y: 80 }
  },
  {
    id: "v2-both-side",
    label: "V2 Both-Side Connector",
    template: {
      id: "preview-v2-both-side-template",
      name: "Both Side Preview",
      category: "Preview / V2",
      width: 460,
      height: 250,
      schemaVersion: 2,
      connectors: [
        connector("loop-network", "ethercon", "io", 0, 164, {
          nameText: "LAN",
          signalDirection: "bidirectional",
          displaySide: "both",
          primaryAnchorId: "left",
          anchors: [
            { id: "left", side: "left", x: 0, y: 164 },
            { id: "right", side: "right", x: 460, y: 164 }
          ]
        })
      ]
    },
    instance: { instanceId: "preview-v2-both-side", x: 80, y: 80 }
  },
  {
    id: "shared-bus",
    label: "Shared Bus",
    template: {
      id: "preview-shared-bus-template",
      name: "Shared Bus Preview",
      category: "Preview / Shared Bus",
      width: 480,
      height: 390,
      schemaVersion: 2,
      connectors: [
        connector("shared-hdmi", "hdmi", "input", 0, 178, { nameText: "IN 1" }),
        connector("shared-display-port", "display-port", "input", 0, 232, { nameText: "IN 2" }),
        connector("shared-dvi", "dvi", "input", 0, 286, { nameText: "IN 3" }),
        connector("shared-vga", "vga", "input", 0, 340, { nameText: "IN 4" })
      ],
      connectorRelationships: [
        {
          id: "shared-input-format",
          type: "exclusive",
          members: ["shared-hdmi", "shared-display-port", "shared-dvi", "shared-vga"]
        }
      ]
    },
    instance: { instanceId: "preview-shared-bus", x: 80, y: 80 }
  },
  {
    id: "through-loop",
    label: "Through / Loop",
    template: {
      id: "preview-through-template",
      name: "Through Preview",
      category: "Preview / Through",
      width: 540,
      height: 260,
      schemaVersion: 2,
      connectors: [
        connector("sdi-in", "sdi", "input", 0, 178, { nameText: "IN 1" }),
        connector("sdi-loop", "sdi", "output", 540, 178, { nameText: "OUT 1" })
      ],
      connectorRelationships: [
        {
          id: "sdi-loop-through",
          type: "through",
          members: ["sdi-in", "sdi-loop"],
          sourceConnectorId: "sdi-in",
          targetConnectorId: "sdi-loop"
        }
      ]
    },
    instance: { instanceId: "preview-through-loop", x: 80, y: 80 }
  },
  {
    id: "modular",
    label: "Modular Chassis",
    template: {
      id: "preview-modular-template",
      name: "Modular Preview",
      category: "Preview / Modular",
      width: 520,
      height: 360,
      schemaVersion: 2,
      hasSwappableCards: true,
      connectors: [
        connector("chassis-lan", "ethercon", "input", 0, 290, { nameText: "LAN" })
      ],
      cardSlots: [
        { id: "slot-a", name: "Slot A", y: 132, installedCardTypeId: "hdmi-input-card" },
        { id: "slot-b", name: "Slot B", y: 230, installedCardTypeId: "sdi-output-card" }
      ],
      cardTypes: [
        {
          id: "hdmi-input-card",
          name: "HDMI Input Card",
          kind: "input",
          connectors: [
            { id: "hdmi-card-in-1", type: "hdmi", direction: "input", nameText: "CARD IN 1" },
            { id: "hdmi-card-in-2", type: "hdmi", direction: "input", nameText: "CARD IN 2" }
          ]
        },
        {
          id: "sdi-output-card",
          name: "SDI Output Card",
          kind: "output",
          connectors: [
            { id: "sdi-card-out-1", type: "sdi", direction: "output", nameText: "CARD OUT 1" },
            { id: "sdi-card-out-2", type: "sdi", direction: "output", nameText: "CARD OUT 2" }
          ]
        }
      ]
    },
    instance: { instanceId: "preview-modular", x: 80, y: 80 }
  },
  {
    id: "power-distro",
    label: "Power Distribution",
    template: {
      id: "preview-power-distro-template",
      name: "Power Distro Preview",
      category: "Preview / Power",
      width: 520,
      height: 320,
      schemaVersion: 2,
      isPowerDistro: true,
      connectors: [
        connector("pd-in", "powercon", "input", 0, 150, { nameText: "IN" }),
        connector("pd-out-a", "powercon", "output", 520, 132, { nameText: "OUT A" }),
        connector("pd-out-b", "powerlock", "output", 520, 204, { nameText: "POWERLOCK" })
      ]
    },
    instance: { instanceId: "preview-power-distro", x: 80, y: 80 }
  },
  {
    id: "adapter-breakout",
    label: "Adapter / Breakout",
    template: {
      id: "preview-adapter-breakout-template",
      name: "USB-C Breakout",
      category: "Video Adapters / Breakouts",
      objectType: "adapter",
      isAdapterBreakout: true,
      width: 190,
      height: 112,
      schemaVersion: 2,
      connectors: [
        connector("usb-c-in", "usb-c", "input", 0, 58, { nameText: "USB-C" }),
        connector("hdmi-out", "hdmi", "output", 190, 34, { nameText: "HDMI" }),
        connector("dp-out", "display-port", "output", 190, 82, { nameText: "DP" })
      ]
    },
    instance: { instanceId: "preview-adapter-breakout", x: 160, y: 160 }
  }
];

export function enginePreviewFixtureDefinitions() {
  return cloneJson(FIXTURES.map(fixture => ({
    ...fixture,
    instance: {
      ...fixture.instance,
      templateId: fixture.instance.templateId || fixture.template.id
    },
    projectData: fixtureProjectData(fixture)
  })));
}

export function enginePreviewFixtureById(id) {
  return enginePreviewFixtureDefinitions().find(fixture => fixture.id === id) || null;
}

export function enginePreviewFixtureScene(id) {
  const fixture = enginePreviewFixtureById(id) || enginePreviewFixtureDefinitions()[0];
  return {
    devices: [fixture],
    wires: fixture.wires || [],
    racks: fixture.racks || [],
    meta: { fixtureId: fixture.id, fixtureLabel: fixture.label }
  };
}

function fixtureProjectData(fixture) {
  return {
    projectName: `Engine Preview Fixture - ${fixture.label}`,
    nodeLibrary: BASE_NODE_LIBRARY,
    deviceLibrary: [fixture.template]
  };
}

function connector(id, type, direction, x, y, extra = {}) {
  const side = direction === "output" ? "right" : "left";
  const displaySide = extra.displaySide || side;
  return {
    id,
    schemaVersion: 2,
    type,
    physicalType: type,
    connectorType: type,
    direction,
    signalDirection: extra.signalDirection || (direction === "io" ? "bidirectional" : direction),
    displaySide,
    primaryAnchorId: extra.primaryAnchorId || side,
    anchors: extra.anchors || [{ id: side, side, x, y }],
    x,
    y,
    nameText: extra.nameText || "",
    resolutionFrameRate: extra.resolutionFrameRate || "",
    customText: extra.customText || "",
    fiberMode: extra.fiberMode || "",
    installedModuleType: extra.installedModuleType || "",
    customColor: extra.customColor || "",
    ...extra
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
