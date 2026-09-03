import { isCanvasObjectKind, isLedSurfaceKind } from "./canvasObjectKinds.js";
import {
  matrixCrosspointKey,
  matrixRouteDiagnosticsForDevice,
  normalizeMatrixRoutesForDevice
} from "./matrixRouting.js";
import {
  connectorVisualAnchors,
  isV2Connector,
  normalizeConnectorRelationships,
  validateConnectorTopology
} from "./deviceDefinitionV2.js";

export function validateEngineScene(scene, projectData = null) {
  const start = performance.now();
  const errors = [];
  const warnings = [];
  const root = projectRoot(projectData);
  const productionDevices = Array.isArray(root.devices) ? root.devices : [];
  const productionJumpNodes = Array.isArray(root.jumpNodes) ? root.jumpNodes : [];
  const productionSurfaces = Array.isArray(root.ledSurfaces) ? root.ledSurfaces : [];
  const productionImages = Array.isArray(root.imageObjects) ? root.imageObjects : [];
  const productionAreas = Array.isArray(root.areas) ? root.areas : [];
  const productionComments = Array.isArray(root.comments) ? root.comments : [];
  const productionTitleBlocks = Array.isArray(root.titleBlocks) ? root.titleBlocks : [];
  const productionConnections = Array.isArray(root.connections) ? root.connections : [];
  const sceneDevices = Array.isArray(scene?.devices) ? scene.devices : [];
  const sceneWires = Array.isArray(scene?.wires) ? scene.wires : [];
  const productionObjectCount = productionDevices.length
    + productionJumpNodes.length
    + productionSurfaces.length
    + productionImages.length
    + productionAreas.length
    + productionComments.length
    + productionTitleBlocks.length;
  const skippedWires = Number(scene?.meta?.skippedWires) || 0;
  const counts = {
    productionObjects: productionObjectCount,
    productionConnections: productionConnections.length,
    objects: sceneDevices.length,
    devices: sceneDevices.filter(device => device.kind !== "jump" && !isCanvasObjectKind(device)).length,
    jumpNodes: sceneDevices.filter(device => device.kind === "jump").length,
    ledSurfaces: sceneDevices.filter(device => isLedSurfaceKind(device)).length,
    imageObjects: sceneDevices.filter(device => device.kind === "image-object").length,
    areas: sceneDevices.filter(device => device.kind === "area").length,
    comments: sceneDevices.filter(device => device.kind === "comment").length,
    titleBlocks: sceneDevices.filter(device => device.kind === "title-block").length,
    wires: sceneWires.length,
    routedWires: sceneWires.filter(wire => wire.routePoints?.length).length,
    routePoints: sceneWires.reduce((total, wire) => total + (wire.routePoints?.length || 0), 0),
    selectedObjects: scene?.selectedIds?.size || 0,
    selectedWires: scene?.selectedWireIds?.size || 0,
    selectedConnectors: scene?.selectedConnectorKeys?.size || 0,
    selectedRoutePoints: scene?.selectedRoutePointKeys?.size || 0,
    skippedWires,
    duplicateObjectIds: 0,
    duplicateWireIds: 0,
    orphanWires: 0,
    invalidConnectorReferences: 0,
    routePointMismatches: 0,
    rackExposedPortRecords: 0,
    rackResolvedExposedPorts: 0,
    rackHiddenChildConnectors: 0,
    rackHiddenExternalWires: 0,
    rackBezierInternalWires: 0,
    rackConnectorHitTargetMismatches: 0,
    rackInternalNonOrthogonalSegments: 0,
    matrixDevices: 0,
    matrixInputs: 0,
    matrixOutputs: 0,
    matrixCrosspoints: 0,
    matrixAssignedRoutes: 0,
    matrixInvalidRoutes: 0,
    matrixRouteMismatches: 0,
    v2Devices: 0,
    v2Connectors: 0,
    connectorAnchors: 0,
    connectorRelationships: 0,
    connectorTopologyErrors: 0,
    connectorTopologyWarnings: 0,
    wireAnchorMismatches: 0
  };

  counts.duplicateObjectIds = checkDuplicates(sceneDevices.map(device => device.id), "object", errors);
  counts.duplicateWireIds = checkDuplicates(sceneWires.map(wire => wire.id), "wire", errors);

  if (productionObjectCount && sceneDevices.length !== productionObjectCount) {
    errors.push(`Scene object count ${sceneDevices.length} does not match production object count ${productionObjectCount}.`);
  }
  if (productionConnections.length && sceneWires.length + skippedWires !== productionConnections.length) {
    warnings.push(`Scene has ${sceneWires.length} wires and ${skippedWires} skipped wires for ${productionConnections.length} production connections.`);
  }
  if (skippedWires) warnings.push(`${skippedWires} production wire(s) were skipped by the project adapter.`);

  validateConnectorTopologies(sceneDevices, errors, warnings, counts);
  sceneWires.forEach(wire => validateWire(scene, wire, errors, warnings, counts));
  validateSelection(scene, errors);
  validateRoutePointParity(sceneWires, productionConnections, root.wireMode === "orthogonal" ? "orthogonal" : "bezier", errors, warnings, counts);
  validateRackCanvasParity(scene, errors, counts);
  validateMatrixRoutingParity(scene, productionDevices, errors, warnings, counts);

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

function validateConnectorTopologies(sceneDevices, errors, warnings, counts) {
  (sceneDevices || []).forEach(device => {
    const connectors = Array.isArray(device?.connectors) ? device.connectors : [];
    const relationships = normalizeConnectorRelationships(
      device?.connectorRelationships || device?.connectorTopology?.relationships,
      connectors
    );
    const hasV2Topology = Number(device?.schemaVersion || 0) >= 2
      || connectors.some(connector => isV2Connector(connector))
      || relationships.length > 0;
    if (!hasV2Topology) return;
    counts.v2Devices += 1;
    counts.v2Connectors += connectors.filter(connector => isV2Connector(connector)).length;
    counts.connectorAnchors += connectors.reduce((total, connector) => (
      total + (Array.isArray(connector?.anchors) ? connector.anchors.length : 0)
    ), 0);
    counts.connectorRelationships += relationships.length;
    const validation = validateConnectorTopology(connectors, relationships);
    validation.errors.forEach(message => {
      counts.connectorTopologyErrors += 1;
      errors.push(`Device ${device.id} topology: ${message}`);
    });
    validation.warnings.forEach(message => {
      counts.connectorTopologyWarnings += 1;
      warnings.push(`Device ${device.id} topology: ${message}`);
    });
  });
}

function validateMatrixRoutingParity(scene, productionDevices, errors, warnings, counts) {
  const productionById = new Map((productionDevices || [])
    .map(device => [String(device?.instanceId || device?.id || device?.deviceId || ""), device])
    .filter(([id]) => id));
  (Array.isArray(scene?.devices) ? scene.devices : [])
    .filter(device => device?.visual?.isMatrixRouter)
    .forEach(device => {
      const diagnostics = matrixRouteDiagnosticsForDevice(device);
      counts.matrixDevices += 1;
      counts.matrixInputs += diagnostics.inputs;
      counts.matrixOutputs += diagnostics.outputs;
      counts.matrixCrosspoints += diagnostics.crosspoints;
      counts.matrixAssignedRoutes += diagnostics.assignedRoutes;
      counts.matrixInvalidRoutes += diagnostics.invalidRoutes;
      if (diagnostics.invalidRoutes > 0) {
        errors.push(`Matrix device ${device.sourceId || device.id} has ${diagnostics.invalidRoutes} invalid route reference(s).`);
      }
      const productionDevice = productionById.get(String(device.sourceId || device.id));
      if (!productionDevice) return;
      const productionRoutes = productionDevice.matrixRoutes && typeof productionDevice.matrixRoutes === "object" && !Array.isArray(productionDevice.matrixRoutes)
        ? productionDevice.matrixRoutes
        : {};
      const normalizedProductionRoutes = normalizeMatrixRoutesForDevice(device, productionRoutes);
      const sceneRoutes = normalizeMatrixRoutesForDevice(device, device.matrixRoutes);
      const productionKeys = Object.keys(productionRoutes);
      if (productionKeys.length !== Object.keys(normalizedProductionRoutes).length) {
        const invalidCount = productionKeys.length - Object.keys(normalizedProductionRoutes).length;
        counts.matrixInvalidRoutes += invalidCount;
        warnings.push(`Production matrix device ${device.sourceId || device.id} has ${invalidCount} stale route reference(s) that Engine will ignore.`);
      }
      if (!routesEqual(sceneRoutes, normalizedProductionRoutes)) {
        counts.matrixRouteMismatches += 1;
        errors.push(`Matrix device ${device.sourceId || device.id} route state differs from production data.`);
      }
      const routeKeys = new Set();
      Object.entries(sceneRoutes).forEach(([outputId, inputId]) => {
        const routeKey = matrixCrosspointKey(device.sourceId || device.id, inputId, outputId);
        if (routeKeys.has(routeKey)) {
          counts.matrixRouteMismatches += 1;
          errors.push(`Matrix device ${device.sourceId || device.id} has duplicate route key ${routeKey}.`);
        }
        routeKeys.add(routeKey);
      });
    });
}

function validateRackCanvasParity(scene, errors, counts) {
  const racks = Array.isArray(scene?.racks) ? scene.racks : [];
  if (!racks.length) return;
  racks.forEach(rack => {
    const diagnostic = scene?.rackConnectorDiagnostics?.(rack.id);
    if (!diagnostic) return;
    counts.rackExposedPortRecords += diagnostic.exposedPortRecords || 0;
    counts.rackResolvedExposedPorts += diagnostic.resolvedExposedConnectors || 0;
    counts.rackHiddenChildConnectors += diagnostic.hiddenChildConnectors || 0;
    counts.rackHiddenExternalWires += diagnostic.hiddenExternalWires || 0;
    counts.rackBezierInternalWires += diagnostic.bezierInternalWires || 0;
    if (diagnostic.connectorHitTargets !== diagnostic.resolvedExposedConnectors) {
      counts.rackConnectorHitTargetMismatches += 1;
      errors.push(`Rack ${rack.id} has ${diagnostic.resolvedExposedConnectors} selectable exposed connector(s) but ${diagnostic.connectorHitTargets} connector hit target(s).`);
    }
    (diagnostic.unresolvedExposureKeys || []).forEach(key => {
      errors.push(`Rack ${rack.id} exposed port ${key} does not resolve to a placed child connector.`);
    });
    if (diagnostic.bezierInternalWires > 0) {
      errors.push(`Rack ${rack.id} has ${diagnostic.bezierInternalWires} internal wire(s) not forced to orthogonal routing.`);
    }
    if (diagnostic.hiddenExternalWires > 0) {
      errors.push(`Rack ${rack.id} has ${diagnostic.hiddenExternalWires} external wire(s) attached to hidden child connector(s).`);
    }
  });
  (Array.isArray(scene?.wires) ? scene.wires : [])
    .filter(wire => wire.internalRackWire)
    .forEach(wire => {
      if (wire.routeStyle !== "orthogonal") {
        counts.rackInternalNonOrthogonalSegments += 1;
        errors.push(`Rack internal wire ${wire.id} is ${wire.routeStyle || "bezier"} instead of orthogonal.`);
        return;
      }
      const points = scene?.wirePoints?.(wire) || [];
      for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        const horizontal = nearlyEqual(previous.y, current.y);
        const vertical = nearlyEqual(previous.x, current.x);
        if (!horizontal && !vertical) {
          counts.rackInternalNonOrthogonalSegments += 1;
          errors.push(`Rack internal wire ${wire.id} segment ${index - 1} is not horizontal or vertical.`);
          break;
        }
      }
    });
}

function validateWire(scene, wire, errors, warnings, counts) {
  const fromObjectId = wire.fromSurfaceId || wire.fromDeviceId;
  const toObjectId = wire.toSurfaceId || wire.toDeviceId;
  const fromDevice = scene?.getDevice?.(fromObjectId);
  const toDevice = scene?.getDevice?.(toObjectId);
  let hasMissingEndpoint = false;
  if (!fromDevice) {
    hasMissingEndpoint = true;
    errors.push(`Wire ${wire.id} has missing source object ${fromObjectId}.`);
  }
  if (!toDevice) {
    hasMissingEndpoint = true;
    errors.push(`Wire ${wire.id} has missing destination object ${toObjectId}.`);
  }
  if (hasMissingEndpoint) counts.orphanWires += 1;
  const fromConnector = wire.fromSurfaceId ? null : scene?.getConnector?.(wire.fromDeviceId, wire.fromConnectorId);
  const toConnector = wire.toSurfaceId ? null : scene?.getConnector?.(wire.toDeviceId, wire.toConnectorId);
  if (wire.fromSurfaceId && wire.fromConnectorId) {
    counts.invalidConnectorReferences += 1;
    errors.push(`Wire ${wire.id} LED source surface endpoint must not use connector ${wire.fromConnectorId}.`);
  }
  if (wire.toSurfaceId && wire.toConnectorId) {
    counts.invalidConnectorReferences += 1;
    errors.push(`Wire ${wire.id} LED destination surface endpoint must not use connector ${wire.toConnectorId}.`);
  }
  if (wire.fromConnectorId && !fromConnector) {
    const message = `Wire ${wire.id} has missing source connector ${wire.fromDeviceId}:${wire.fromConnectorId}.`;
    counts.invalidConnectorReferences += 1;
    (wire.fromUsesRealConnector || wire.usesRealConnectorEndpoints ? errors : warnings).push(message);
  }
  if (wire.toConnectorId && !toConnector) {
    const message = `Wire ${wire.id} has missing destination connector ${wire.toDeviceId}:${wire.toConnectorId}.`;
    counts.invalidConnectorReferences += 1;
    (wire.toUsesRealConnector || wire.usesRealConnectorEndpoints ? errors : warnings).push(message);
  }
  if (wire.fromAnchorId && fromConnector && !connectorHasExactAnchor(fromConnector, wire.fromAnchorId, fromDevice)) {
    counts.wireAnchorMismatches += 1;
    errors.push(`Wire ${wire.id} has missing source anchor ${wire.fromDeviceId}:${wire.fromConnectorId}:${wire.fromAnchorId}.`);
  }
  if (wire.toAnchorId && toConnector && !connectorHasExactAnchor(toConnector, wire.toAnchorId, toDevice)) {
    counts.wireAnchorMismatches += 1;
    errors.push(`Wire ${wire.id} has missing destination anchor ${wire.toDeviceId}:${wire.toConnectorId}:${wire.toAnchorId}.`);
  }
  (wire.routePoints || []).forEach((point, index) => {
    if (!Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
      errors.push(`Wire ${wire.id} route point ${index} has invalid coordinates.`);
    }
  });
}

function connectorHasExactAnchor(connector, anchorId, device) {
  return connectorVisualAnchors(connector, device).some(anchor => anchor.id === String(anchorId || ""));
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

function validateRoutePointParity(sceneWires, productionConnections, wireMode, errors, warnings, counts) {
  if (!productionConnections.length) return;
  const connectionById = new Map(productionConnections.map(connection => [String(connection.id || ""), connection]));
  sceneWires.forEach(wire => {
    const connection = connectionById.get(String(wire.sourceId || wire.id));
    if (!connection) {
      warnings.push(`Scene wire ${wire.id} has no matching production connection ${wire.sourceId || wire.id}.`);
      return;
    }
    const productionPoints = routePointsFromConnection(connection, wireMode);
    const scenePoints = routePointsFromWire(wire);
    const productionRouteStyle = Array.isArray(connection?.orthogonalRoutePoints)
      ? "orthogonal"
      : productionPoints.length ? "custom" : "bezier";
    const sceneRouteStyle = wire?.routeStyle === "orthogonal"
      ? "orthogonal"
      : scenePoints.length ? "custom" : "bezier";
    if (productionRouteStyle !== sceneRouteStyle) {
      counts.routePointMismatches += 1;
      errors.push(`Wire ${wire.id} route style ${sceneRouteStyle} does not match production ${productionRouteStyle}.`);
    }
    if (productionPoints.length !== scenePoints.length) {
      counts.routePointMismatches += 1;
      errors.push(`Wire ${wire.id} route point count ${scenePoints.length} does not match production count ${productionPoints.length}.`);
      return;
    }
    productionPoints.forEach((point, index) => {
      const scenePoint = scenePoints[index];
      if (!nearlyEqual(point.x, scenePoint.x) || !nearlyEqual(point.y, scenePoint.y)) {
        counts.routePointMismatches += 1;
        errors.push(`Wire ${wire.id} route point ${index} differs from production data.`);
      }
    });
  });
}

function checkDuplicates(ids, label, errors) {
  const seen = new Set();
  let duplicates = 0;
  ids.forEach(id => {
    if (!id) errors.push(`Missing ${label} id.`);
    if (seen.has(id)) {
      duplicates += 1;
      errors.push(`Duplicate ${label} id ${id}.`);
    }
    seen.add(id);
  });
  return duplicates;
}

function routesEqual(a, b) {
  const left = a && typeof a === "object" && !Array.isArray(a) ? a : {};
  const right = b && typeof b === "object" && !Array.isArray(b) ? b : {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (String(left[key] || "") !== String(right[key] || "")) return false;
  }
  return true;
}

function routePointsFromConnection(connection, wireMode = "bezier") {
  const points = Array.isArray(connection?.orthogonalRoutePoints)
    ? connection.orthogonalRoutePoints
    : wireMode === "orthogonal"
      ? connection?.orthogonalRoutePoints
      : connection?.routePoints;
  return (points || [])
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
