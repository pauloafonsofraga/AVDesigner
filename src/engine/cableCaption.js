import { engineConnectorDisplayLabel } from "./connectorCompatibility.js";
import { isJumpNodeDevice, sceneJumpDeviceWire } from "./jumpNodeModel.js";

function endpointIdentity(device, connector, surface = false) {
  if (!device || isJumpNodeDevice(device)) return { device: "Unconnected", node: "" };
  return {
    device: String(device.label || device.visual?.displayName || "Unconnected"),
    node: surface ? "LED Screen" : String(connector?.nameText || engineConnectorDisplayLabel(connector) || "Unconnected")
  };
}

function wireEndpoint(scene, wire, end) {
  const surfaceId = wire[`${end}SurfaceId`];
  const device = scene.getDevice(surfaceId || wire[`${end}DeviceId`]);
  const connector = surfaceId ? null : scene.getConnector(device?.id, wire[`${end}ConnectorId`]);
  return endpointIdentity(device, connector, Boolean(surfaceId));
}

function jumpEndpoint(scene, jumpId) {
  if (!isJumpNodeDevice(scene.getDevice(jumpId))) return endpointIdentity(null);
  // Avoid the general mutation helper's full-scene safety scan during drawing.
  const local = sceneJumpDeviceWire(scene, jumpId, { wireIds: scene.wireIdsByDeviceId.get(jumpId) || [] });
  return endpointIdentity(local?.otherDevice, local?.otherConnector, Boolean(local?.wire?.[`${local.otherEnd}SurfaceId`]));
}

// SceneGraph indexes resolve only the two physical legs of a Jump pair. No
// traversal through device internals, and no cache to outlive a rename/rewire.
export function resolveCableEndpoints(scene, cable) {
  const virtual = Boolean(cable.outputJumpId && cable.inputJumpId);
  const pair = virtual ? cable
    : scene.jumpLinkForNode(cable.fromDeviceId) || scene.jumpLinkForNode(cable.toDeviceId);
  return {
    from: pair ? jumpEndpoint(scene, pair.outputJumpId) : wireEndpoint(scene, cable, "from"),
    to: pair ? jumpEndpoint(scene, pair.inputJumpId) : wireEndpoint(scene, cable, "to"),
    virtual
  };
}

export function wireCaption(scene, cable, highlighted = false) {
  const { from, to, virtual } = resolveCableEndpoints(scene, cable);
  const label = endpoint => highlighted && endpoint.node ? `${endpoint.device} - ${endpoint.node}` : endpoint.device;
  const length = virtual ? "" : String(cable.length ?? "");
  return `${label(from)} to ${label(to)}${length.trim() ? ` - ${length}` : ""}`;
}
