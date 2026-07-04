export function validateEngineScene(scene, projectData = null) {
  const start = performance.now();
  const errors = [];
  const warnings = [];
  const root = projectRoot(projectData);
  const productionDevices = Array.isArray(root.devices) ? root.devices : [];
  const productionJumpNodes = Array.isArray(root.jumpNodes) ? root.jumpNodes : [];
  const productionSurfaces = Array.isArray(root.ledSurfaces) ? root.ledSurfaces : [];
  const productionConnections = Array.isArray(root.connections) ? root.connections : [];
  const sceneDevices = Array.isArray(scene?.devices) ? scene.devices : [];
  const sceneWires = Array.isArray(scene?.wires) ? scene.wires : [];
  const productionObjectCount = productionDevices.length + productionJumpNodes.length + productionSurfaces.length;
  const skippedWires = Number(scene?.meta?.skippedWires) || 0;
  const counts = {
    productionObjects: productionObjectCount,
    productionConnections: productionConnections.length,
    objects: sceneDevices.length,
    devices: sceneDevices.filter(device => device.kind !== "jump" && device.kind !== "surface").length,
    jumpNodes: sceneDevices.filter(device => device.kind === "jump").length,
    ledSurfaces: sceneDevices.filter(device => device.kind === "surface").length,
    wires: sceneWires.length,
    routedWires: sceneWires.filter(wire => wire.routePoints?.length).length,
    routePoints: sceneWires.reduce((total, wire) => total + (wire.routePoints?.length || 0), 0),
    selectedObjects: scene?.selectedIds?.size || 0,
    selectedWires: scene?.selectedWireIds?.size || 0,
    selectedConnectors: scene?.selectedConnectorKeys?.size || 0,
    selectedRoutePoints: scene?.selectedRoutePointKeys?.size || 0,
    skippedWires
  };

  checkDuplicates(sceneDevices.map(device => device.id), "object", errors);
  checkDuplicates(sceneWires.map(wire => wire.id), "wire", errors);

  if (productionObjectCount && sceneDevices.length !== productionObjectCount) {
    errors.push(`Scene object count ${sceneDevices.length} does not match production object count ${productionObjectCount}.`);
  }
  if (productionConnections.length && sceneWires.length + skippedWires !== productionConnections.length) {
    warnings.push(`Scene has ${sceneWires.length} wires and ${skippedWires} skipped wires for ${productionConnections.length} production connections.`);
  }
  if (skippedWires) warnings.push(`${skippedWires} production wire(s) were skipped by the project adapter.`);

  sceneWires.forEach(wire => validateWire(scene, wire, errors, warnings));
  validateSelection(scene, errors);
  validateRoutePointParity(sceneWires, productionConnections, errors, warnings);

  const durationMs = performance.now() - start;
  return {
    ok: errors.length === 0,
    durationMs,
    counts,
    errors,
    warnings,
    summary: `${errors.length ? "failed" : "passed"} in ${durationMs.toFixed(1)} ms`
  };
}

function validateWire(scene, wire, errors, warnings) {
  const fromDevice = scene?.getDevice?.(wire.fromDeviceId);
  const toDevice = scene?.getDevice?.(wire.toDeviceId);
  if (!fromDevice) errors.push(`Wire ${wire.id} has missing source object ${wire.fromDeviceId}.`);
  if (!toDevice) errors.push(`Wire ${wire.id} has missing destination object ${wire.toDeviceId}.`);
  const fromConnector = scene?.getConnector?.(wire.fromDeviceId, wire.fromConnectorId);
  const toConnector = scene?.getConnector?.(wire.toDeviceId, wire.toConnectorId);
  if (wire.fromConnectorId && !fromConnector) {
    const message = `Wire ${wire.id} has missing source connector ${wire.fromDeviceId}:${wire.fromConnectorId}.`;
    if (!isVirtualSurfacePort(fromDevice, wire.fromConnectorId)) {
      (wire.fromUsesRealConnector || wire.usesRealConnectorEndpoints ? errors : warnings).push(message);
    }
  }
  if (wire.toConnectorId && !toConnector) {
    const message = `Wire ${wire.id} has missing destination connector ${wire.toDeviceId}:${wire.toConnectorId}.`;
    if (!isVirtualSurfacePort(toDevice, wire.toConnectorId)) {
      (wire.toUsesRealConnector || wire.usesRealConnectorEndpoints ? errors : warnings).push(message);
    }
  }
  (wire.routePoints || []).forEach((point, index) => {
    if (!Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
      errors.push(`Wire ${wire.id} route point ${index} has invalid coordinates.`);
    }
  });
}

function isVirtualSurfacePort(device, connectorId) {
  return device?.kind === "surface" && String(connectorId || "").startsWith("surface-port-");
}

function validateSelection(scene, errors) {
  [...(scene?.selectedIds || [])].forEach(id => {
    if (!scene.getDevice?.(id)) errors.push(`Selected object ${id} does not exist.`);
  });
  [...(scene?.selectedWireIds || [])].forEach(id => {
    if (!scene.getWire?.(id)) errors.push(`Selected wire ${id} does not exist.`);
  });
  [...(scene?.selectedConnectorKeys || [])].forEach(key => {
    const { deviceId, connectorId } = splitConnectorKey(key);
    if (!scene.getConnector?.(deviceId, connectorId)) errors.push(`Selected connector ${key} does not exist.`);
  });
  [...(scene?.selectedRoutePointKeys || [])].forEach(key => {
    const { wireId, pointIndex } = splitRoutePointKey(key);
    const point = scene.getWire?.(wireId)?.routePoints?.[pointIndex];
    if (!point) errors.push(`Selected route point ${key} does not exist.`);
  });
}

function validateRoutePointParity(sceneWires, productionConnections, errors, warnings) {
  if (!productionConnections.length) return;
  const connectionById = new Map(productionConnections.map(connection => [String(connection.id || ""), connection]));
  sceneWires.forEach(wire => {
    const connection = connectionById.get(String(wire.sourceId || wire.id));
    if (!connection) {
      warnings.push(`Scene wire ${wire.id} has no matching production connection ${wire.sourceId || wire.id}.`);
      return;
    }
    const productionPoints = routePointsFromConnection(connection);
    const scenePoints = routePointsFromWire(wire);
    if (productionPoints.length !== scenePoints.length) {
      errors.push(`Wire ${wire.id} route point count ${scenePoints.length} does not match production count ${productionPoints.length}.`);
      return;
    }
    productionPoints.forEach((point, index) => {
      const scenePoint = scenePoints[index];
      if (!nearlyEqual(point.x, scenePoint.x) || !nearlyEqual(point.y, scenePoint.y)) {
        errors.push(`Wire ${wire.id} route point ${index} differs from production data.`);
      }
    });
  });
}

function checkDuplicates(ids, label, errors) {
  const seen = new Set();
  ids.forEach(id => {
    if (!id) errors.push(`Missing ${label} id.`);
    if (seen.has(id)) errors.push(`Duplicate ${label} id ${id}.`);
    seen.add(id);
  });
}

function routePointsFromConnection(connection) {
  return (connection?.routePoints || connection?.orthogonalRoutePoints || [])
    .map(point => ({ x: Number(point.x), y: Number(point.y) }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function routePointsFromWire(wire) {
  return (wire?.routePoints || [])
    .map(point => ({ x: Number(point.x), y: Number(point.y) }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function projectRoot(project) {
  if (!project || typeof project !== "object") return {};
  if (project.state && typeof project.state === "object") return project.state;
  if (project.project && typeof project.project === "object") return project.project;
  return project;
}

function splitConnectorKey(key) {
  const text = String(key || "");
  const separator = text.indexOf(":");
  if (separator < 0) return { deviceId: text, connectorId: "" };
  return {
    deviceId: text.slice(0, separator),
    connectorId: text.slice(separator + 1)
  };
}

function splitRoutePointKey(key) {
  const text = String(key || "");
  const separator = text.lastIndexOf(":");
  if (separator < 0) return { wireId: text, pointIndex: -1 };
  return {
    wireId: text.slice(0, separator),
    pointIndex: Number(text.slice(separator + 1))
  };
}

function nearlyEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.001;
}
