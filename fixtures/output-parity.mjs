import { ledSurfaceOrderingFixture } from "./led-surface-ordering.mjs";
import { modularIntegrationFixture, adapterIntegrationFixture } from "./modular-integration.mjs";
import { powerTemplate } from "./power-distro-catalog.mjs";

export function outputParityFixture() {
  const project = ledSurfaceOrderingFixture();
  const ordinary = { id: "ordinary", name: "Signal Device", schemaVersion: 2, deviceDefinitionVersion: 2,
    width: 240, height: 300, connectors: ["input", "output"].map(direction => ({
      id: direction, type: "sdi", direction, signalDirection: direction,
      displaySide: direction === "input" ? "left" : "right", primaryAnchorId: direction,
      x: direction === "input" ? 0 : 240, y: 180, nameText: direction, label: "SDI 12G",
      anchors: [{ id: direction, side: direction === "input" ? "left" : "right", x: direction === "input" ? 0 : 240, y: 180 }]
    })) };
  const instance = (id, template, x, y, extra = {}) => ({
    instanceId: id, templateId: template.id, name: id, x, y, templateOverride: structuredClone(template), ...extra
  });
  const chassis = modularIntegrationFixture();
  chassis.cardSlots.push({ id: "repeated-slot", installedCardTypeId: "input-card", y: 1232 });
  const adapter = adapterIntegrationFixture();
  adapter.connectors.push({ ...structuredClone(ordinary.connectors[1]), x: 190, y: 50,
    anchors: [{ id: "output", side: "right", x: 190, y: 50 }] });
  project.devices.push(
    instance("ordinary-a", ordinary, 1800, 100), instance("ordinary-b", ordinary, 2600, 700),
    instance("chassis", chassis, 1800, 1200), instance("breakout", adapter, 2900, 1200),
    instance("power", powerTemplate(["powercon", "socapex"]), 2900, 1500),
    instance("matrix", { ...ordinary, id: "matrix-template", isMatrixRouter: true }, 2500, 1200, { matrixRoutes: { output: "input" } }),
    instance("rack-a", ordinary, 3400, 200, { rackId: "rack", sourceRackDeviceId: "source-a" }),
    instance("rack-b", ordinary, 3400, 600, { rackId: "rack", sourceRackDeviceId: "source-b" })
  );
  const wire = (id, from, to, extra = {}) => ({ id, from, to, cableType: "sdi", ...extra });
  const endpoint = (deviceId, connectorId) => ({ deviceId, connectorId });
  project.connections.push(
    wire("curve", endpoint("ordinary-a", "output"), endpoint("ordinary-b", "input")),
    wire("cross-horizontal", endpoint("ordinary-a", "output"), endpoint("ordinary-b", "input"),
      { orthogonalRoutePoints: [{ x: 2100, y: 280 }, { x: 2100, y: 500 }, { x: 2800, y: 500 }, { x: 2800, y: 880 }] }),
    wire("cross-vertical", endpoint("ordinary-b", "output"), endpoint("ordinary-a", "input"),
      { orthogonalRoutePoints: [{ x: 3000, y: 880 }, { x: 3000, y: 1000 }, { x: 2400, y: 1000 }, { x: 2400, y: -100 }, { x: 1600, y: -100 }, { x: 1600, y: 280 }] }),
    wire("installed-card-wire", endpoint("chassis", "output-slot__out-0"), endpoint("matrix", "input")),
    wire("rack-exposed-wire", endpoint("matrix", "output"), endpoint("rack-a", "input")),
    wire("jump-source", endpoint("ordinary-a", "output"), { jumpNodeId: "jump-out" }),
    wire("jump-destination", { jumpNodeId: "jump-in" }, endpoint("ordinary-b", "input"))
  );
  project.jumpNodes = [{ id: "jump-out", x: 2200, y: 30 }, { id: "jump-in", x: 2800, y: 30 }];
  project.jumpLinks = [{ id: "portal", outputJumpId: "jump-out", inputJumpId: "jump-in" }];
  project.racks = [{ id: "rack", name: "Output Parity Rack", canvasInstance: true, showInternalWiring: true,
    sourceDeviceMap: { "source-a": "rack-a", "source-b": "rack-b" },
    exposedPorts: [{ deviceId: "source-a", connectorId: "input" }, { deviceId: "source-b", connectorId: "output" }],
    internalConnections: [wire("internal", endpoint("source-a", "output"), endpoint("source-b", "input"))] }];
  project.comments = [{ id: "comment", text: "Output parity", x: 3000, y: 40, width: 250, height: 100,
    anchor: { x: 2850, y: -80 } }];
  project.titleBlocks = [{ id: "title", x: 50, y: 3100, width: 1800, height: 240,
    fields: { title: "Engine Output Scene", client: "Parity Fixture", company: "AV Designer" } }];
  project.imageObjects = [{ id: "image", x: 3100, y: 1100, width: 160, height: 90, image: project.ledSurfaces[0].image }];
  project.areas = [{ id: "area", x: -100, y: -200, width: 1700, height: 1400, name: "LED Processing", textSize: 60 }];
  project.projectName = "Engine output parity";
  project.cableHops = true;
  return project;
}
