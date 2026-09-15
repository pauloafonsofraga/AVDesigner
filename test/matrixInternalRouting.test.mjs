import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  matrixInternalRoutePairsForDevice,
  matrixInternalRoutePolyline,
  matrixInternalRoutingVisible,
  normalizeMatrixRoutesForDevice,
  setMatrixRouteForDevice
} from "../src/engine/matrixRouting.js";

const INDEX_HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const RENDERER_SOURCE = readFileSync(new URL("../src/engine/renderer.js", import.meta.url), "utf8");
const PRODUCTION_BRIDGE_SOURCE = readFileSync(new URL("../src/engine/productionBridge.js", import.meta.url), "utf8");

function functionSource(source, functionName) {
  const namePattern = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:function\\s+${namePattern}\\s*\\([^)]*\\)\\s*\\{|${namePattern}\\s*\\([^)]*\\)\\s*\\{)`).exec(source);
  assert.ok(match, `Missing function ${functionName}`);
  const start = match.index;
  const bodyStart = start + match[0].lastIndexOf("{");
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`Unterminated function ${functionName}`);
}

function matrixDevice(overrides = {}) {
  return {
    id: "matrix-a",
    sourceId: "dev-matrix-a",
    x: 40,
    y: 80,
    width: 320,
    height: 220,
    visual: { isMatrixRouter: true },
    connectorRelationships: [
      {
        id: "shared-inputs",
        type: "exclusive",
        members: ["in-hdmi", "in-dvi", "in-vga"]
      }
    ],
    connectors: [
      {
        id: "in-hdmi",
        type: "hdmi",
        direction: "input",
        includeInMatrix: true,
        x: 0,
        y: 92,
        color: "#ffcc00",
        schemaVersion: 2,
        displaySide: "left",
        primaryAnchorId: "left",
        anchors: [{ id: "left", side: "left", x: 0, y: 92 }]
      },
      {
        id: "in-dvi",
        type: "dvi",
        direction: "input",
        includeInMatrix: true,
        x: 0,
        y: 118,
        color: "#365cff",
        schemaVersion: 2,
        displaySide: "left",
        primaryAnchorId: "left",
        anchors: [{ id: "left", side: "left", x: 0, y: 118 }]
      },
      {
        id: "in-vga",
        type: "vga",
        direction: "input",
        includeInMatrix: true,
        x: 0,
        y: 144,
        color: "#19d27c",
        schemaVersion: 2,
        displaySide: "left",
        primaryAnchorId: "left",
        anchors: [{ id: "left", side: "left", x: 0, y: 144 }]
      },
      {
        id: "slot-a__out-hdmi",
        sourceConnectorId: "out-hdmi",
        cardSlotId: "slot-a",
        cardTypeId: "tri-output",
        generatedFromCard: true,
        type: "hdmi",
        direction: "output",
        includeInMatrix: true,
        x: 320,
        y: 116,
        color: "#32b6ff",
        schemaVersion: 2,
        displaySide: "both",
        primaryAnchorId: "right",
        anchors: [
          { id: "left", side: "left", x: 0, y: 116 },
          { id: "right", side: "right", x: 320, y: 116 }
        ]
      },
      {
        id: "slot-b__out-sdi",
        sourceConnectorId: "out-sdi",
        cardSlotId: "slot-b",
        cardTypeId: "tri-output",
        generatedFromCard: true,
        type: "sdi",
        direction: "output",
        includeInMatrix: true,
        x: 320,
        y: 176,
        color: "#fb7904",
        schemaVersion: 2,
        displaySide: "right",
        primaryAnchorId: "right",
        anchors: [{ id: "right", side: "right", x: 320, y: 176 }]
      }
    ],
    matrixRoutes: {
      "slot-a__out-hdmi": "in-hdmi",
      "slot-b__out-sdi": "in-hdmi",
      "missing-output": "in-hdmi",
      "slot-a__missing": "missing-input"
    },
    ...overrides
  };
}

test("matrix internal route pairs use assigned stable connector IDs and installed anchors", () => {
  const device = matrixDevice();
  const normalized = normalizeMatrixRoutesForDevice(device, device.matrixRoutes);
  assert.deepEqual(normalized, {
    "slot-a__out-hdmi": "in-hdmi",
    "slot-b__out-sdi": "in-hdmi"
  });

  const pairs = matrixInternalRoutePairsForDevice(device);
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs.map(pair => pair.output.id), ["slot-a__out-hdmi", "slot-b__out-sdi"]);
  assert.ok(pairs.every(pair => pair.input.id === "in-hdmi"), "one input may feed multiple matrix outputs");
  assert.equal(pairs[0].inputAnchor.side, "left");
  assert.equal(pairs[0].inputAnchor.x, 0);
  assert.equal(pairs[0].outputAnchor.side, "right", "both-side output routes should use the output/right anchor");
  assert.equal(pairs[0].outputAnchor.x, device.width);
  assert.equal(pairs[0].end.y, 116);
  assert.equal(pairs[1].end.y, 176);
});

test("matrix internal route visibility defaults on and can be toggled without deleting routes", () => {
  const device = matrixDevice();
  assert.equal(matrixInternalRoutingVisible(device), true);
  assert.equal(matrixInternalRoutePairsForDevice(device).length, 2);

  const hidden = { ...device, showInternalMatrixRouting: false };
  assert.equal(matrixInternalRoutingVisible(hidden), false);
  assert.equal(matrixInternalRoutePairsForDevice(hidden).length, 0);
  assert.deepEqual(normalizeMatrixRoutesForDevice(hidden, hidden.matrixRoutes), {
    "slot-a__out-hdmi": "in-hdmi",
    "slot-b__out-sdi": "in-hdmi"
  });
});

test("matrix internal route polyline stays inside the installed device frame", () => {
  const device = matrixDevice();
  const pair = matrixInternalRoutePairsForDevice(device)[0];
  const points = matrixInternalRoutePolyline(device, pair, device.x, device.y, 18);
  assert.equal(points[0].x, device.x);
  assert.equal(points[0].y, device.y + pair.start.y);
  assert.equal(points.at(-1).x, device.x + device.width);
  assert.equal(points.at(-1).y, device.y + pair.end.y);
  points.forEach(point => {
    assert.ok(point.x >= device.x - 0.000001, "route point should not leave the left edge");
    assert.ok(point.x <= device.x + device.width + 0.000001, "route point should not leave the right edge");
    assert.ok(point.y >= device.y - 0.000001, "route point should not leave the top edge");
    assert.ok(point.y <= device.y + device.height + 0.000001, "route point should not leave the bottom edge");
  });
});

test("matrix route assignment helper preserves stable generated connector IDs", () => {
  const device = matrixDevice({ matrixRoutes: {} });
  const after = setMatrixRouteForDevice(device, "slot-a__out-hdmi", "in-dvi");
  assert.deepEqual(after, { "slot-a__out-hdmi": "in-dvi" });
  const toggledOff = setMatrixRouteForDevice({ ...device, matrixRoutes: after }, "slot-a__out-hdmi", "in-dvi", { toggle: true });
  assert.deepEqual(toggledOff, {});
});

test("Engine renderer owns a dynamic internal matrix route buffer", () => {
  assert.match(RENDERER_SOURCE, /from "\.\/matrixRouting\.js\?v=iteration54-4-0-matrix-routing-internal-routes"/);
  assert.match(RENDERER_SOURCE, /matrixRouteBuffer = this\.gl\.createBuffer\(\)/);
  assert.match(RENDERER_SOURCE, /matrixRouteVertexMap = new Map\(\)/);
  assert.match(RENDERER_SOURCE, /matrixRouteRangeMap = new Map\(\)/);
  assert.match(functionSource(RENDERER_SOURCE, "setStaticScene"), /verticesForMatrixInternalRoutes\(device, null, this\.renderOptions\)/);
  assert.match(functionSource(RENDERER_SOURCE, "draw"), /this\.drawTextureDevices\(scene, camera, renderOptions, dragSession, layerTrace, device => device\.kind !== "area"\)/);
  assert.match(functionSource(RENDERER_SOURCE, "draw"), /this\.drawMatrixInternalRoutes\(dragSession, layerTrace\)/);
  assert.match(functionSource(RENDERER_SOURCE, "draw"), /pushVisibleConnectorNodes\(liveVertices, scene, camera, this\.resolution, renderOptions, dragSession, layerTrace, this\)/);
  assert.match(functionSource(RENDERER_SOURCE, "updateMatrixInternalRoutes"), /subUpload\(this\.gl, this\.matrixRouteBuffer, range\.offset, next\)/);
  assert.doesNotMatch(functionSource(RENDERER_SOURCE, "updateMatrixInternalRoutes"), /refreshCableHops|ensureDeviceTexture|setStaticScene/);
});

test("Production bridge updates matrix route geometry without dirtying textures or wires", () => {
  assert.match(PRODUCTION_BRIDGE_SOURCE, /from "\.\/matrixRouting\.js\?v=iteration54-4-0-matrix-routing-internal-routes"/);
  const applyMatrixRoutes = functionSource(PRODUCTION_BRIDGE_SOURCE, "applyMatrixRoutes");
  const commitMatrixRoute = functionSource(PRODUCTION_BRIDGE_SOURCE, "commitMatrixRoute");
  const applyObjectInspectorFields = functionSource(PRODUCTION_BRIDGE_SOURCE, "applyObjectInspectorFields");
  const sanitizeObjectInspectorFields = functionSource(PRODUCTION_BRIDGE_SOURCE, "sanitizeObjectInspectorFields");

  assert.match(applyMatrixRoutes, /this\.renderer\.updateMatrixInternalRoutes\?\.\(this\.scene, \[device\.id\]\)/);
  assert.doesNotMatch(applyMatrixRoutes, /updateDirty|dirtyTextures|refreshCableHops/);
  assert.match(commitMatrixRoute, /matrixRoutingCommand\(sourceId, before, after\)/);
  assert.match(sanitizeObjectInspectorFields, /showInternalMatrixRouting/);
  assert.match(functionSource(PRODUCTION_BRIDGE_SOURCE, "applyObjectFieldsToSceneDevice"), /device\.showInternalMatrixRouting = sanitized\.showInternalMatrixRouting/);
  assert.match(applyObjectInspectorFields, /objectInspectorPatchOnlyInternalMatrixRouting\(sanitized\)/);
  assert.match(applyObjectInspectorFields, /this\.renderer\.updateMatrixInternalRoutes\?\.\(this\.scene, \[device\.id\]\)/);
});

test("Legacy canvas and exported viewer render assigned matrix routes without normal cables", () => {
  assert.match(INDEX_HTML, /function drawMatrixInternalRoutes\(group, instance, template\)/);
  assert.match(INDEX_HTML, /function normalizedMatrixRoutesForInstance\(instance, template = templateForInstance\(instance\)\)/);
  assert.match(
    INDEX_HTML,
    /function matrixInternalRoutePairs\(instance, template = templateForInstance\(instance\)\) \{[\s\S]*?normalizedMatrixRoutesForInstance\(instance, template\)/
  );
  assert.match(functionSource(INDEX_HTML, "appendCanvasDevice"), /drawMatrixInternalRoutes\(group, instance, template\)/);
  assert.match(functionSource(INDEX_HTML, "showDeviceContextMenu"), /data-device-menu="toggle-matrix-internal-routing"/);
  assert.match(INDEX_HTML, /\.matrix-internal-wire/);
  assert.match(INDEX_HTML, /matrixConnectorIncludedViewer/);
  assert.match(functionSource(INDEX_HTML, "matrixEndpointsForViewer"), /filter\(matrixConnectorIncludedViewer\)/);
  assert.match(INDEX_HTML, /function drawMatrixInternalRoutes\(g,inst,t\)/, "exported viewer should include a compact matrix route renderer");
  assert.match(INDEX_HTML, /drawMatrixInternalRoutes\(g,inst,t\);effectiveConnectors\(t\)/, "exported viewer should draw matrix internals before connector nodes");
  assert.doesNotMatch(functionSource(INDEX_HTML, "drawMatrixInternalRoutes"), /state\.connections|connections\.push|data\.connections/);
});
