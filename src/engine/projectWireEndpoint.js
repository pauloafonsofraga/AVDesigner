export function projectWireEndpoint(wire, end) {
  return wire?.[end] || {
    deviceId: wire?.[`${end}DeviceId`],
    surfaceId: wire?.[`${end}SurfaceId`],
    connectorId: wire?.[`${end}ConnectorId`],
    anchorId: wire?.[`${end}AnchorId`]
  };
}
