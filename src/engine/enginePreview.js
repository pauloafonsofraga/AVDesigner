import { adapterMappingForDevice } from "./adapterMapping.js";
import { connectorDisplayAnchors, createConnectorDisplayLayout } from "./connectorDisplayLayout.js";
import { normalizeConnectorRelationships } from "./deviceDefinitionV2.js";
import {
  deviceVisualAssetReadySubscriberCount,
  deviceVisualCacheKey
} from "./deviceVisualBuilder.js";
import {
  legacyFaceBounds,
  legacyFaceHeight,
  legacyFaceImagePlacement
} from "./faceplateGeometry.js";
import { distanceToPolyline, hitTestConnector, hitTestDevice, hitTestWire, screenToWorld } from "./hitTest.js";
import { powerDistroDiagnostics } from "./powerDistroModel.js";
import { normalizeAvDesignerDevice } from "./projectAdapter.js";
import { DEFAULT_RENDER_OPTIONS, WebglGraphRenderer } from "./renderer.js";
import { SceneGraph } from "./sceneGraph.js";

export const ENGINE_PREVIEW_BUILD_ID = "iteration53-2-rack-builder-engine-preview";

const ACTIVE_PREVIEW_SURFACES = new Set();

export const ENGINE_PREVIEW_LIFECYCLE = {
  created: 0,
  disposed: 0,
  activePreviewSurfaces: 0,
  glContextsCreated: 0,
  glContextsDisposed: 0,
  fullSceneReplacements: 0,
  incrementalDeviceReplacements: 0,
  renderRequests: 0,
  renderedFrames: 0
};

export function previewRenderOptions(overrides = {}) {
  return {
    ...DEFAULT_RENDER_OPTIONS,
    gridVisible: false,
    wires: true,
    labels: true,
    connectorMarkers: true,
    connectorColors: true,
    routePoints: false,
    jumpNodes: false,
    ledSurfaces: true,
    textureCacheEnabled: true,
    texturedDevices: true,
    textureQuality: "medium",
    highDpiTextures: true,
    detailedDeviceTextures: true,
    lodMode: false,
    cableHops: false,
    dirtyDeviceIds: new Set(),
    dirtyWireIds: new Set(),
    ...overrides
  };
}

export function normalizePreviewSceneData(input = {}) {
  const devices = (Array.isArray(input.devices) ? input.devices : [])
    .map((item, index) => normalizePreviewDeviceInput(item, index))
    .filter(Boolean);
  return {
    devices,
    wires: stableClone(input.wires || []),
    racks: stableClone(input.racks || []),
    meta: {
      ...(stableClone(input.meta || {})),
      previewBuildId: ENGINE_PREVIEW_BUILD_ID
    }
  };
}

export function createPreviewDeviceFromDraft(draft = {}, index = 0) {
  if (isNormalizedPreviewDevice(draft)) return stableClone(draft);
  const templateSource = stableClone(draft.template || draft.definition || draft.deviceTemplate || {});
  const instanceSource = stableClone(draft.instance || draft.deviceInstance || {});
  const templateId = String(
    templateSource.id
    || instanceSource.templateId
    || draft.templateId
    || draft.id
    || `engine-preview-template-${index + 1}`
  );
  const template = {
    ...templateSource,
    id: templateId
  };
  const instanceId = String(
    instanceSource.instanceId
    || instanceSource.id
    || draft.instanceId
    || `engine-preview-device-${index + 1}`
  );
  const instance = {
    ...instanceSource,
    instanceId,
    id: instanceId,
    templateId,
    name: instanceSource.name || draft.name || template.name || template.model || `Preview Device ${index + 1}`,
    x: finiteNumber(instanceSource.x ?? draft.x, 0),
    y: finiteNumber(instanceSource.y ?? draft.y, 0)
  };
  if (draft.mode === "project-custom" || draft.projectDeviceDraft === true) {
    instance.templateOverride = instance.templateOverride || template;
  }

  const projectData = previewProjectDataWithTemplate(draft.projectData || draft.project || {}, template);
  return normalizeAvDesignerDevice(projectData, instance, index);
}

export function fitCameraToBounds(bounds, viewportWidth, viewportHeight, padding = 36, limits = {}) {
  const safeBounds = normalizeBounds(bounds);
  const width = Math.max(1, Number(viewportWidth) || 1);
  const height = Math.max(1, Number(viewportHeight) || 1);
  const inset = Math.max(0, Number(padding) || 0);
  const availableWidth = Math.max(1, width - inset * 2);
  const availableHeight = Math.max(1, height - inset * 2);
  const minZoom = positiveNumber(limits.minZoom) || 0.05;
  const maxZoom = positiveNumber(limits.maxZoom) || 8;
  const zoom = clamp(
    Math.min(availableWidth / safeBounds.width, availableHeight / safeBounds.height),
    minZoom,
    maxZoom
  );
  return {
    x: safeBounds.x + safeBounds.width / 2 - width / zoom / 2,
    y: safeBounds.y + safeBounds.height / 2 - height / zoom / 2,
    zoom
  };
}

export function screenToWorldPoint(camera, point) {
  return screenToWorld(camera, point);
}

export function worldToScreenPoint(camera, point) {
  const zoom = Math.max(0.0001, Number(camera?.zoom) || 1);
  return {
    x: ((Number(point?.x) || 0) - (Number(camera?.x) || 0)) * zoom,
    y: ((Number(point?.y) || 0) - (Number(camera?.y) || 0)) * zoom
  };
}

export function deviceLocalToScreenPoint(camera, device, point) {
  const zoom = Math.max(0.0001, Number(camera?.zoom) || 1);
  const world = {
    x: (Number(device?.x) || 0) + (Number(point?.x) || 0),
    y: (Number(device?.y) || 0) + (Number(point?.y) || 0)
  };
  return {
    x: (world.x - (Number(camera?.x) || 0)) * zoom,
    y: (world.y - (Number(camera?.y) || 0)) * zoom
  };
}

export function screenToDeviceLocalPoint(camera, device, point) {
  const world = screenToWorldPoint(camera, point);
  return {
    x: world.x - (Number(device?.x) || 0),
    y: world.y - (Number(device?.y) || 0)
  };
}

export function previewDeviceVisualKey(device, renderOptions = {}) {
  return deviceVisualCacheKey(device, previewRenderOptions(renderOptions));
}

export function previewFaceBounds(device = {}) {
  return legacyFaceBounds(device.visual || device, Math.max(1, Number(device.width) || 1));
}

export function previewFaceHeight(device = {}) {
  return legacyFaceHeight(device.visual || device, Math.max(1, Number(device.width) || 1));
}

export function previewFaceImagePlacement(device = {}, image = null) {
  return legacyFaceImagePlacement(device.visual || device, Math.max(1, Number(device.width) || 1), image);
}

export function previewConnectorLayoutStats(device = {}) {
  const relationships = normalizeConnectorRelationships(
    device.connectorRelationships || device.connectorTopology?.relationships,
    device.connectors || []
  );
  const layout = createConnectorDisplayLayout({ ...device, connectorRelationships: relationships });
  return {
    relationshipCount: relationships.length,
    sharedBusGroups: layout.groups.length,
    sharedBusMembers: layout.groups.map(group => group.members.map(connector => connector.id))
  };
}

export function enginePreviewDiagnostics(surface = null) {
  return {
    buildId: ENGINE_PREVIEW_BUILD_ID,
    lifecycle: { ...ENGINE_PREVIEW_LIFECYCLE, activePreviewSurfaces: ACTIVE_PREVIEW_SURFACES.size },
    assetReadySubscribers: deviceVisualAssetReadySubscriberCount(),
    surface: surface?.diagnostics?.() || null
  };
}

export class EnginePreviewSurface {
  constructor(container, options = {}) {
    if (!container) throw new Error("EnginePreviewSurface requires a container element.");
    this.container = container;
    this.dom = createPreviewDom(container);
    this.scene = new SceneGraph();
    this.camera = {
      x: finiteNumber(options.camera?.x, 0),
      y: finiteNumber(options.camera?.y, 0),
      zoom: positiveNumber(options.camera?.zoom) || 1
    };
    this.renderOptions = previewRenderOptions(options.renderOptions || {});
    this.pendingFrame = 0;
    this.disposed = false;
    this.lastAssetUpdate = null;
    this.lastSetSceneStats = null;
    this.lastDirtyStats = null;
    this.renderer = new WebglGraphRenderer(this.dom.webglCanvas, this.dom.labelCanvas, {
      onTextureAssetReady: event => {
        this.lastAssetUpdate = event;
        this.render();
      }
    });
    this.renderer.setRenderOptions(this.renderOptions);
    ENGINE_PREVIEW_LIFECYCLE.created += 1;
    ENGINE_PREVIEW_LIFECYCLE.glContextsCreated += 1;
    ACTIVE_PREVIEW_SURFACES.add(this);
    ENGINE_PREVIEW_LIFECYCLE.activePreviewSurfaces = ACTIVE_PREVIEW_SURFACES.size;
    this.setSceneData(options.scene || { devices: [], wires: [], racks: [], meta: {} }, { fit: options.fit !== false });
  }

  mount(container) {
    if (this.disposed || !container) return this.dom.root;
    if (this.dom.root.parentElement !== container) container.appendChild(this.dom.root);
    this.container = container;
    this.resize({ fit: false });
    return this.dom.root;
  }

  authoringOverlay() {
    return this.dom.overlay;
  }

  setCamera(camera = {}, { render = true } = {}) {
    if (this.disposed) return this.camera;
    this.camera = {
      x: finiteNumber(camera.x, this.camera.x),
      y: finiteNumber(camera.y, this.camera.y),
      zoom: positiveNumber(camera.zoom) || this.camera.zoom
    };
    if (render) this.render();
    return this.camera;
  }

  setSceneData(sceneData = {}, { fit = true } = {}) {
    if (this.disposed) return null;
    const normalized = normalizePreviewSceneData(sceneData);
    this.scene.setData(normalized);
    this.lastSetSceneStats = this.renderer.setStaticScene(this.scene);
    ENGINE_PREVIEW_LIFECYCLE.fullSceneReplacements += 1;
    if (fit) this.fitToContent();
    this.render();
    return normalized;
  }

  setDraftDevice(draft = {}, options = {}) {
    const device = createPreviewDeviceFromDraft(draft, 0);
    this.setSceneData({ devices: [device], wires: [], racks: [], meta: { source: "draft-device" } }, options);
    return device;
  }

  replaceDevice(deviceOrDraft = {}, { render = true, refreshTexture = true } = {}) {
    if (this.disposed) return null;
    const device = normalizePreviewDeviceInput(deviceOrDraft, this.scene.devices.length);
    if (!device) return null;
    const replaced = this.scene.replaceDevice(device);
    this.lastDirtyStats = this.renderer.updateDirty(this.scene, {
      deviceIds: [device.id],
      wireIds: [],
      refreshDeviceTextures: refreshTexture !== false,
      refreshCableHops: false
    });
    ENGINE_PREVIEW_LIFECYCLE.incrementalDeviceReplacements += 1;
    if (render) this.render();
    return replaced;
  }

  fitToContent({ padding = 36, bounds = null } = {}) {
    if (this.disposed) return this.camera;
    this.renderer.resize();
    this.camera = fitCameraToBounds(
      bounds || this.scene.bounds(),
      this.renderer.resolution.width,
      this.renderer.resolution.height,
      padding
    );
    return this.camera;
  }

  screenToWorld(point) {
    return screenToWorldPoint(this.camera, point);
  }

  worldToScreen(point) {
    const zoom = Math.max(0.0001, Number(this.camera.zoom) || 1);
    return {
      x: ((Number(point?.x) || 0) - this.camera.x) * zoom,
      y: ((Number(point?.y) || 0) - this.camera.y) * zoom
    };
  }

  deviceLocalToScreen(deviceId, point) {
    const device = this.scene.getDevice(deviceId);
    return device ? deviceLocalToScreenPoint(this.camera, device, point) : null;
  }

  screenToDeviceLocal(deviceId, point) {
    const device = this.scene.getDevice(deviceId);
    return device ? screenToDeviceLocalPoint(this.camera, device, point) : null;
  }

  connectorEntries(deviceId = "", options = {}) {
    if (this.disposed) return [];
    const includeHidden = options.includeHidden === true;
    const includeReferenceOnly = options.includeReferenceOnly === true;
    const predicate = typeof options.predicate === "function" ? options.predicate : null;
    const devices = deviceId
      ? [this.scene.getDevice(deviceId)].filter(Boolean)
      : this.scene.devices;
    const entries = [];
    devices.forEach(device => {
      const displayLayout = this.scene.connectorDisplayLayoutForDevice(device);
      (device.connectors || []).forEach(connector => {
        if (!includeHidden && connector.hiddenOnCanvas === true) return;
        if (!includeReferenceOnly && connector.referenceOnlyOnCanvas === true) return;
        if (predicate && !predicate({ device, connector })) return;
        connectorDisplayAnchors(device, connector, displayLayout).forEach(anchor => {
          const world = this.scene.connectorAnchorWorldPoint(device, connector, anchor.id, displayLayout);
          entries.push({
            device,
            connector,
            anchor,
            anchorId: anchor.id || "",
            logicalKey: `${device.id}:${connector.id}`,
            anchorKey: `${device.id}:${connector.id}:${anchor.id || "primary"}`,
            local: {
              x: Number(anchor.x ?? connector.x) || 0,
              y: Number(anchor.y ?? connector.y) || 0
            },
            world,
            screen: this.worldToScreen(world)
          });
        });
      });
    });
    return entries;
  }

  hitTestConnector(screenPoint, tolerancePx = 12, options = {}) {
    if (options.includeReferenceOnly || options.includeHidden || typeof options.predicate === "function") {
      return this.hitTestConnectorEntries(screenPoint, tolerancePx, options);
    }
    const worldPoint = this.screenToWorld(screenPoint);
    return hitTestConnector(this.scene, worldPoint, Math.max(1, tolerancePx / Math.max(0.0001, this.camera.zoom)));
  }

  hitTestConnectorEntries(screenPoint, tolerancePx = 12, options = {}) {
    const start = performance.now();
    const worldPoint = this.screenToWorld(screenPoint);
    const tolerance = Math.max(1, tolerancePx / Math.max(0.0001, this.camera.zoom));
    let best = null;
    let bestDistance = Infinity;
    const entries = this.connectorEntries(options.deviceId || "", options);
    entries.forEach(entry => {
      if (!entry?.world || !entry.connector || !entry.device) return;
      const distance = Math.hypot(entry.world.x - worldPoint.x, entry.world.y - worldPoint.y);
      const radius = entry.device.kind === "jump" ? tolerance * 1.9 : tolerance;
      if (distance <= radius && distance < bestDistance) {
        bestDistance = distance;
        best = {
          device: entry.device,
          connector: entry.connector,
          anchor: entry.anchor,
          anchorId: entry.anchorId,
          anchorKey: entry.anchorKey,
          logicalKey: entry.logicalKey,
          point: entry.world,
          distance,
          key: entry.logicalKey,
          entry
        };
      }
    });
    return {
      connector: best,
      candidates: entries.length,
      ms: performance.now() - start
    };
  }

  hitTestDevice(screenPoint, predicate = null) {
    return hitTestDevice(this.scene, this.screenToWorld(screenPoint), predicate);
  }

  hitTestWire(screenPoint, tolerancePx = 8, predicate = null) {
    const worldPoint = this.screenToWorld(screenPoint);
    const tolerance = Math.max(1, tolerancePx / Math.max(0.0001, this.camera.zoom));
    if (!predicate) return hitTestWire(this.scene, worldPoint, tolerance);
    const start = performance.now();
    const candidates = this.scene.wireIndex.queryRect({
      x: worldPoint.x - tolerance,
      y: worldPoint.y - tolerance,
      width: tolerance * 2,
      height: tolerance * 2
    });
    let best = null;
    let bestDistance = Infinity;
    candidates.forEach(item => {
      const wire = item.payload?.wire || item.wire;
      if (!wire || !predicate(wire)) return;
      const pathHit = distanceToPolyline(this.scene.wireRenderPolyline(wire), worldPoint);
      if (pathHit.distance <= tolerance && pathHit.distance < bestDistance) {
        bestDistance = pathHit.distance;
        best = {
          wire,
          distance: pathHit.distance,
          segmentIndex: pathHit.segmentIndex,
          point: pathHit.point
        };
      }
    });
    return {
      wire: best,
      candidates: candidates.length,
      ms: performance.now() - start
    };
  }

  replaceSceneItems({ devices = [], wires = [] } = {}, { render = true, refreshTexture = true, refreshCableHops = false } = {}) {
    if (this.disposed) return null;
    const deviceIds = [];
    const wireIds = [];
    (devices || []).forEach((item, index) => {
      const device = normalizePreviewDeviceInput(item, index);
      if (!device?.id) return;
      this.scene.replaceDevice(device);
      deviceIds.push(device.id);
    });
    (wires || []).forEach(wire => {
      if (!wire?.id) return;
      if (this.scene.getWire(wire.id)) this.scene.applyWireState(wire.id, wire);
      else this.scene.insertWire(wire);
      wireIds.push(wire.id);
    });
    this.lastDirtyStats = this.renderer.updateDirty(this.scene, {
      deviceIds,
      wireIds,
      refreshDeviceTextures: refreshTexture !== false,
      refreshCableHops: refreshCableHops !== false
    });
    if (deviceIds.length) ENGINE_PREVIEW_LIFECYCLE.incrementalDeviceReplacements += deviceIds.length;
    if (render) this.render();
    return {
      devices: deviceIds,
      wires: wireIds,
      stats: this.lastDirtyStats
    };
  }

  resize({ fit = false } = {}) {
    if (this.disposed) return;
    if (fit) this.fitToContent();
    else this.renderer.resize();
    this.render();
  }

  render() {
    if (this.disposed) return;
    ENGINE_PREVIEW_LIFECYCLE.renderRequests += 1;
    if (typeof requestAnimationFrame !== "function") {
      this.renderNow();
      return;
    }
    if (this.pendingFrame) return;
    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = 0;
      this.renderNow();
    });
  }

  renderNow() {
    if (this.disposed) return null;
    const stats = this.renderer.draw(this.scene, this.camera, {
      renderOptions: this.renderOptions,
      previewSurface: true
    });
    ENGINE_PREVIEW_LIFECYCLE.renderedFrames += 1;
    return stats;
  }

  diagnostics() {
    const devices = this.scene.devices || [];
    return {
      buildId: ENGINE_PREVIEW_BUILD_ID,
      disposed: this.disposed,
      surfaceId: this.dom.root.dataset.enginePreviewSurfaceId || "",
      devices: devices.length,
      wires: this.scene.wires?.length || 0,
      racks: this.scene.racks?.length || 0,
      camera: { ...this.camera },
      viewport: { ...this.renderer.resolution },
      dpr: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      textureStats: this.renderer.textureStats(),
      assetReadySubscribers: deviceVisualAssetReadySubscriberCount(),
      sharedBus: devices.map(device => ({
        deviceId: device.id,
        ...previewConnectorLayoutStats(device)
      })),
      adapters: devices
        .filter(device => device.kind === "adapter" || device.visual?.isAdapterBreakout)
        .map(device => adapterMappingForDevice(device)),
      powerDistros: devices
        .filter(device => device.kind === "power-distro" || device.visual?.isPowerDistro)
        .map(device => powerDistroDiagnostics(device)),
      lastAssetUpdate: this.lastAssetUpdate,
      lastSetSceneStats: this.lastSetSceneStats,
      lastDirtyStats: this.lastDirtyStats
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pendingFrame && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.pendingFrame);
    }
    this.pendingFrame = 0;
    this.renderer?.dispose?.();
    this.dom.root.remove();
    ACTIVE_PREVIEW_SURFACES.delete(this);
    ENGINE_PREVIEW_LIFECYCLE.disposed += 1;
    ENGINE_PREVIEW_LIFECYCLE.glContextsDisposed += 1;
    ENGINE_PREVIEW_LIFECYCLE.activePreviewSurfaces = ACTIVE_PREVIEW_SURFACES.size;
  }
}

function normalizePreviewDeviceInput(item, index) {
  if (isNormalizedPreviewDevice(item)) return stableClone(item);
  return createPreviewDeviceFromDraft(item, index);
}

function isNormalizedPreviewDevice(value) {
  return Boolean(value && Array.isArray(value.connectors) && value.id && Number.isFinite(Number(value.width)) && Number.isFinite(Number(value.height)));
}

function previewProjectDataWithTemplate(projectInput, template) {
  const projectData = stableClone(projectInput || {});
  const root = projectData.state || projectData.project || projectData;
  if (!Array.isArray(root.deviceLibrary)) root.deviceLibrary = [];
  const templateId = String(template.id || "");
  if (templateId && !root.deviceLibrary.some(item => String(item?.id || "") === templateId)) {
    root.deviceLibrary.push(template);
  }
  if (root !== projectData && !Array.isArray(projectData.deviceLibrary)) projectData.deviceLibrary = root.deviceLibrary;
  return projectData;
}

function createPreviewDom(container) {
  const documentRef = container.ownerDocument || document;
  const root = documentRef.createElement("div");
  root.className = "engine-preview-surface";
  root.dataset.enginePreviewSurfaceId = `engine-preview-${ENGINE_PREVIEW_LIFECYCLE.created + 1}`;
  const webglCanvas = documentRef.createElement("canvas");
  webglCanvas.className = "engine-preview-webgl";
  const labelCanvas = documentRef.createElement("canvas");
  labelCanvas.className = "engine-preview-labels";
  const overlay = documentRef.createElement("div");
  overlay.className = "engine-preview-authoring-overlay";
  root.append(webglCanvas, labelCanvas, overlay);
  container.appendChild(root);
  Object.assign(root.style, {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden"
  });
  [webglCanvas, labelCanvas, overlay].forEach(element => {
    Object.assign(element.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%"
    });
  });
  labelCanvas.style.pointerEvents = "none";
  overlay.style.pointerEvents = "none";
  return { root, webglCanvas, labelCanvas, overlay };
}

function stableClone(value) {
  if (value == null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeBounds(bounds = {}) {
  return {
    x: finiteNumber(bounds.x, 0),
    y: finiteNumber(bounds.y, 0),
    width: Math.max(1, finiteNumber(bounds.width, 1)),
    height: Math.max(1, finiteNumber(bounds.height, 1))
  };
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}
