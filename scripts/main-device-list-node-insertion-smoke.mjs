import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const catalogue = JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url), "utf8"));
const factoryMatrix = structuredClone(catalogue.devices.find(device => device.id === "matrix-8x8"));
assert.ok(factoryMatrix, "factory 8x8 Matrix fixture exists");

const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
const libraryLogs = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => {
  if (message.type() === "error") errors.push(message.text());
  if (message.text().includes("[avdesigner-library-drag]")) libraryLogs.push(message.text());
});

function projectTemplate(id, name) {
  return { ...structuredClone(factoryMatrix), id, name, model: name,
    projectCustomDevice: true, isProjectCustomDevice: true };
}

const project = {
  version: 1,
  projectName: "Main Device List node insertion regression",
  deviceLibrary: [projectTemplate("project-custom-8x8-matrix", "Existing Matrix A"),
    projectTemplate("project-custom-8x8-matrix-2", "Existing Matrix B")],
  nodeLibrary: catalogue.nodes,
  devices: [
    { instanceId: "dev-001", templateId: "project-custom-8x8-matrix", name: "Existing Matrix A", x: -1100, y: 80 },
    { instanceId: "dev-002", templateId: "project-custom-8x8-matrix-2", name: "Existing Matrix B", x: 1100, y: 80 }
  ],
  connections: [], jumpNodes: [], jumpLinks: [], ledSurfaces: [], racks: [], looms: [],
  comments: [], areas: [], titleBlocks: [], imageObjects: []
};

async function loadProject(data) {
  await page.evaluate(snapshot => {
    const file = new File([JSON.stringify(snapshot)], "insertion-regression.avd", { type: "application/json" });
    loadProjectFile(file);
  }, data);
  await page.waitForFunction(() => activeEngineBridge()?.ready
    && activeEngineBridge().scene.devices.filter(device => !device.isJumpNode).length >= 2);
  await page.waitForTimeout(120);
}

async function dragMainListDevice(templateId, expectedDeviceCount = 3, target = { x: 0.5, y: 0.5 }) {
  const item = page.locator(`.library-device[data-template-id="${templateId}"]`).first();
  await item.scrollIntoViewIfNeeded();
  const source = await item.boundingBox();
  const canvas = await page.locator(".engine-bridge-canvas").boundingBox();
  assert.ok(source && canvas, "main-list item and live Engine canvas are visible");
  const start = { x: source.x + Math.min(90, source.width / 2), y: source.y + source.height / 2 };
  const end = { x: canvas.x + canvas.width * target.x, y: canvas.y + canvas.height * target.y };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(count => activeEngineBridge()?.scene.devices.filter(device => !device.isJumpNode).length >= count,
    expectedDeviceCount)
    .catch(async () => {
      const debug = await page.evaluate(() => ({ devices: state.devices.map(device => device.instanceId),
        drag: libraryDrag && { templateId: libraryDrag.templateId, moved: libraryDrag.moved },
        canvas: (() => { const target = canvasDropTargetForEvent({ clientX: innerWidth * .72, clientY: innerHeight * .54 });
          return { isOverCanvas: target.isOverCanvas, isOverEngineCanvas: target.isOverEngineCanvas, topmost: target.topmost }; })(),
        status: document.querySelector("#statusMessage")?.textContent,
        placement: activeEngineBridge().lastPlacementDiagnostics,
        projectDefinitions: projectCustomDeviceTemplates().map(template => template.id) }));
      throw new Error(`Main-list drag did not insert: ${JSON.stringify({ debug, libraryLogs })}`);
    });
  await page.waitForTimeout(150);
}

try {
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html`);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  project.nodeLibrary = await page.evaluate(() => structuredClone(personalLibraryNodes));
  await loadProject(project);
  const before = await page.evaluate(async () => {
    const saved = JSON.parse(await projectJsonPayload());
    return { templateIds: saved.deviceLibrary.map(item => item.id).sort(),
      nodeIds: serializeNodeLibrary().map(item => item.id).sort(),
      nodeColors: Object.fromEntries(serializeNodeLibrary().map(node => [node.id, node.color])),
      sceneCount: activeEngineBridge().scene.devices.length };
  });
  assert.deepEqual(before.templateIds, ["project-custom-8x8-matrix", "project-custom-8x8-matrix-2"]);
  await page.screenshot({ path: "/tmp/main-device-list-insertion-before.png" });

  await dragMainListDevice("matrix-8x8");
  const matrix = await page.evaluate(async () => {
    const bridge = activeEngineBridge();
    const inserted = bridge.scene.devices.filter(device => !["dev-001", "dev-002"].includes(device.id)).at(-1);
    const { engineConnectorCompatibilityType } = await import("./src/engine/connectorCompatibility.js");
    const connectorData = inserted.connectors.map(connector => ({ id: connector.id, type: connector.type,
      compatibilityType: connector.compatibilityType || "", typeLabel: connector.typeLabel || "",
      color: connector.color, engineCompatibilityType: engineConnectorCompatibilityType(connector) }));
    const { engineCompatibilitySummary } = await import("./src/engine/connectorCompatibility.js");
    const output = bridge.scene.getDevice("dev-001");
    const check = (sourceId, targetId) => engineCompatibilitySummary(
      { device: output, connector: output.connectors.find(connector => connector.id === sourceId) },
      { device: inserted, connector: inserted.connectors.find(connector => connector.id === targetId) });
    const saved = JSON.parse(await projectJsonPayload());
    return { id: inserted.id, templateId: inserted.templateId, connectors: connectorData,
      sdi: check("out-1", "in-1"), hdmi: check("out-3", "in-3"),
      deviceLibraryIds: saved.deviceLibrary.map(item => item.id).sort(),
      nodeIds: serializeNodeLibrary().map(item => item.id).sort(),
      fullRuntimeLibraryCount: deviceLibrary.length };
  });
  assert.ok(matrix.id);
  assert.equal(matrix.connectors.find(connector => connector.id === "in-1").type, "sdi");
  assert.equal(matrix.connectors.find(connector => connector.id === "in-1").color.toLowerCase(), before.nodeColors.sdi.toLowerCase());
  assert.equal(matrix.connectors.find(connector => connector.id === "in-3").type, "hdmi");
  assert.equal(matrix.connectors.find(connector => connector.id === "in-3").color.toLowerCase(), before.nodeColors.hdmi.toLowerCase());
  assert.equal(matrix.connectors.find(connector => connector.id === "ctrl").type, "cat6");
  assert.equal(matrix.sdi.valid, true);
  assert.equal(matrix.sdi.selectedCableType, "sdi");
  assert.equal(matrix.hdmi.valid, true);
  assert.equal(matrix.hdmi.selectedCableType, "hdmi");
  assert.equal(matrix.deviceLibraryIds.length, 3, "only the placed custom definition is added to the portable project");
  assert.equal(matrix.deviceLibraryIds.filter(id => !before.templateIds.includes(id)).length, 1);
  assert.deepEqual(matrix.nodeIds, before.nodeIds, "canonical-equivalent Matrix nodes do not add aliases");
  assert.ok(matrix.fullRuntimeLibraryCount >= catalogue.devices.length,
    "runtime factory context may be broad while the saved project remains compact");
  await page.screenshot({ path: "/tmp/main-device-list-insertion-after.png" });

  const mixedTemplate = structuredClone(factoryMatrix);
  mixedTemplate.id = "personal-mixed-shared-types";
  mixedTemplate.name = "Mixed shared-type test device";
  mixedTemplate.model = mixedTemplate.name;
  mixedTemplate.connectors = [
    { ...structuredClone(factoryMatrix.connectors.find(connector => connector.type === "sdi")), id: "shared-sdi-in", direction: "input" },
    { ...structuredClone(factoryMatrix.connectors.find(connector => connector.type === "hdmi")), id: "shared-hdmi-in", direction: "input" },
    { ...structuredClone(factoryMatrix.connectors.find(connector => connector.type === "cat6")), id: "shared-cat6", direction: "io" },
    { id: "shared-dvi-in", label: "DVI", nameText: "DVI", direction: "input", type: "dvi", x: 0, y: 420 }
  ];
  const personalVariantResult = await page.evaluate(template => {
    const current = structuredClone(personalLibraryNodes.find(node => node.id === "sdi"));
    const variant = { ...current, label: "Personal SDI", color: "#123456", compatibilityType: "sdi" };
    personalLibraryNodes = [...personalLibraryNodes.filter(node => node.id !== "sdi"), variant];
    personalLibraryDevices.push(template);
    renderDeviceLibrary();
    return { nodeBefore: serializeNodeLibrary().map(node => node.id).sort(),
      rendered: Boolean(document.querySelector('.library-device[data-template-id="personal-mixed-shared-types"]')) };
  }, mixedTemplate);
  assert.equal(personalVariantResult.rendered, true);
  await dragMainListDevice("personal-mixed-shared-types", 4, { x: 0.78, y: 0.25 });
  const mixed = await page.evaluate(async () => {
    const bridge = activeEngineBridge();
    const inserted = bridge.scene.devices.filter(device => !["dev-001", "dev-002"].includes(device.id)
      && device.templateId !== "matrix-8x8").at(-1);
    const fields = Object.fromEntries(inserted.connectors.map(connector => [connector.id, {
      type: connector.type, compatibilityType: connector.compatibilityType || "",
      typeLabel: connector.typeLabel || "", color: connector.color
    }]));
    const { engineCompatibilitySummary, engineConnectorCompatibilityType } = await import("./src/engine/connectorCompatibility.js");
    const output = bridge.scene.getDevice("dev-001");
    const sdi = engineCompatibilitySummary({ device: output, connector: output.connectors.find(connector => connector.id === "out-1") },
      { device: inserted, connector: inserted.connectors.find(connector => connector.id === "shared-sdi-in") });
    const saved = JSON.parse(await projectJsonPayload());
    return { fields, sdi, effectiveSdi: engineConnectorCompatibilityType(inserted.connectors.find(connector => connector.id === "shared-sdi-in")),
      libraryIds: saved.deviceLibrary.map(item => item.id).sort(), nodeIds: serializeNodeLibrary().map(item => item.id).sort() };
  });
  assert.match(mixed.fields["shared-sdi-in"].type, /^sdi-personal-[0-9a-f]{8}$/);
  assert.equal(mixed.fields["shared-sdi-in"].compatibilityType, "sdi");
  assert.equal(mixed.fields["shared-sdi-in"].typeLabel, "Personal SDI");
  assert.equal(mixed.fields["shared-sdi-in"].color.toLowerCase(), "#123456");
  assert.equal(mixed.effectiveSdi, "sdi");
  assert.equal(mixed.sdi.valid, true);
  assert.equal(mixed.sdi.selectedCableType, "sdi");
  assert.equal(mixed.fields["shared-hdmi-in"].type, "hdmi");
  assert.equal(mixed.fields["shared-cat6"].type, "cat6");
  assert.equal(mixed.fields["shared-dvi-in"].type, "dvi");
  assert.equal(mixed.fields["shared-dvi-in"].color.toLowerCase(), before.nodeColors.dvi.toLowerCase());
  assert.equal(mixed.libraryIds.length, 4, "only one selected project definition is materialized per drop");
  assert.ok(mixed.nodeIds.includes(mixed.fields["shared-sdi-in"].type));

  const savedText = await page.evaluate(() => projectJsonPayload());
  await page.evaluate(text => {
    loadProjectFile(new File([text], "saved-insertion-regression.avd", { type: "application/json" }));
  }, savedText);
  await page.waitForFunction(() => activeEngineBridge()?.ready && activeEngineBridge().scene.devices.length === 4);
  const reloaded = await page.evaluate(() => activeEngineBridge().scene.devices
    .filter(device => device.id !== "dev-001" && device.id !== "dev-002")
    .map(device => ({ id: device.id, connectors: device.connectors.map(connector => ({ id: connector.id,
      type: connector.type, compatibilityType: connector.compatibilityType || "", typeLabel: connector.typeLabel || "",
      color: connector.color })) })));
  const reloadedMixed = reloaded.find(device => device.connectors.some(connector => connector.id === "shared-sdi-in"));
  assert.ok(reloadedMixed);
  const reloadedSdi = reloadedMixed.connectors.find(connector => connector.id === "shared-sdi-in");
  assert.deepEqual({ type: reloadedSdi.type, compatibilityType: reloadedSdi.compatibilityType,
    typeLabel: reloadedSdi.typeLabel, color: reloadedSdi.color }, mixed.fields["shared-sdi-in"]);
  assert.deepEqual(errors, [], "browser acceptance has no console or page errors");
  console.log("Main Device List insertion node compatibility and library scope PASS", JSON.stringify({
    before, matrix, mixed, reloadedNodeParity: true, browserErrors: errors.length,
    screenshots: ["/tmp/main-device-list-insertion-before.png", "/tmp/main-device-list-insertion-after.png"]
  }));
} finally {
  await page.close();
  await browser.close();
}
