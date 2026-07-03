export class DragSession {
  constructor({ scene, selectedIds, startWorld }) {
    this.scene = scene;
    this.selectedIds = [...selectedIds];
    this.startWorld = { ...startWorld };
    this.dx = 0;
    this.dy = 0;
    this.startPositions = new Map();
    this.selectedIds.forEach(id => {
      const device = scene.getDevice(id);
      if (device) this.startPositions.set(id, { x: device.x, y: device.y });
    });
    const lookupStart = performance.now();
    this.affectedWireIds = scene.affectedWireIdsForDevices(this.selectedIds);
    this.affectedWireLookupMs = performance.now() - lookupStart;
  }

  update(worldPoint) {
    this.dx = worldPoint.x - this.startWorld.x;
    this.dy = worldPoint.y - this.startWorld.y;
  }

  offsetMap() {
    const offsets = new Map();
    this.selectedIds.forEach(id => offsets.set(id, { dx: this.dx, dy: this.dy }));
    return offsets;
  }

  commit() {
    const start = performance.now();
    this.scene.moveDevicesBy(this.selectedIds, this.dx, this.dy);
    return performance.now() - start;
  }
}
