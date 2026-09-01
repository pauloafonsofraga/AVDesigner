import { ObjectSnapSession } from "./objectSnapping.js";

export class DragSession {
  constructor({ scene, selectedIds, startWorld, startPoint = null, startClient = null, enableSnapping = false, snapMode = "full" }) {
    this.scene = scene;
    this.selectedIds = [...selectedIds];
    this.startWorld = { ...startWorld };
    this.startPoint = startPoint ? { ...startPoint } : null;
    this.startClient = startClient ? { ...startClient } : null;
    this.lastWorldPoint = { ...startWorld };
    this.snapMode = snapMode || "full";
    this.rawDx = 0;
    this.rawDy = 0;
    this.preSnapDx = 0;
    this.preSnapDy = 0;
    this.dx = 0;
    this.dy = 0;
    this.axisLock = null;
    this.snapGuides = null;
    this.snapCandidateCount = 0;
    this.snapTargetCount = 0;
    this.snapMs = 0;
    this.snapSession = enableSnapping ? new ObjectSnapSession({ scene, selectedIds: this.selectedIds }) : null;
    this.snapTargetCount = this.snapSession?.targetCount || 0;
    this.snapDiagnostics = this.snapSession?.diagnostics?.() || null;
    this.startPositions = new Map();
    this.offsets = new Map();
    this.selectedIds.forEach(id => {
      const device = scene.getDevice(id);
      if (device) this.startPositions.set(id, { x: device.x, y: device.y });
      this.offsets.set(id, { dx: 0, dy: 0 });
    });
    const lookupStart = performance.now();
    this.affectedWireIds = scene.affectedWireIdsForObjects(this.selectedIds);
    this.affectedWireLookupMs = performance.now() - lookupStart;
  }

  update(worldPoint, { camera = null, snappingEnabled = true, axisLockRequested = false, snapMode = this.snapMode } = {}) {
    this.lastWorldPoint = { ...worldPoint };
    this.rawDx = worldPoint.x - this.startWorld.x;
    this.rawDy = worldPoint.y - this.startWorld.y;
    const axisLock = this.resolveAxisLock(axisLockRequested);
    let nextDx = axisLock === "y" ? 0 : this.rawDx;
    let nextDy = axisLock === "x" ? 0 : this.rawDy;
    this.preSnapDx = nextDx;
    this.preSnapDy = nextDy;
    this.snapMode = snapMode || "full";
    const snapStart = performance.now();
    const snapped = this.snapSession?.snap({
      dx: nextDx,
      dy: nextDy,
      zoom: camera?.zoom || 1,
      axisLock,
      enabled: snappingEnabled,
      mode: this.snapMode
    });
    this.snapMs = performance.now() - snapStart;
    if (snapped) {
      nextDx = snapped.dx;
      nextDy = snapped.dy;
      this.snapGuides = snapped.guides;
      this.snapCandidateCount = snapped.candidateCount || 0;
    } else {
      this.snapGuides = null;
      this.snapCandidateCount = 0;
    }
    this.snapDiagnostics = this.snapSession?.diagnostics?.() || null;
    this.dx = nextDx;
    this.dy = nextDy;
    this.offsets.forEach(offset => {
      offset.dx = this.dx;
      offset.dy = this.dy;
    });
  }

  offsetMap() {
    return this.offsets;
  }

  resolveAxisLock(axisLockRequested) {
    if (!axisLockRequested) {
      this.axisLock = null;
      return null;
    }
    if (!this.axisLock && (Math.abs(this.rawDx) > 0.01 || Math.abs(this.rawDy) > 0.01)) {
      this.axisLock = Math.abs(this.rawDx) >= Math.abs(this.rawDy) ? "x" : "y";
    }
    return this.axisLock;
  }

  commit() {
    const start = performance.now();
    this.scene.moveDevicesBy(this.selectedIds, this.dx, this.dy);
    return performance.now() - start;
  }
}
