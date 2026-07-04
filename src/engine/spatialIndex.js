export class SpatialIndex {
  constructor(cellSize = 360) {
    this.cellSize = cellSize;
    this.items = new Map();
    this.buckets = new Map();
  }

  clear() {
    this.items.clear();
    this.buckets.clear();
  }

  rebuild(items) {
    this.clear();
    items.forEach(item => this.insert(item.id, item.bounds, item));
  }

  insert(id, bounds, payload = null) {
    if (!id || !bounds) return;
    if (this.items.has(id)) this.delete(id);
    const normalized = normalizeBounds(bounds);
    const bucketKeys = [];
    const range = this.bucketRange(normalized);
    for (let x = range.minX; x <= range.maxX; x += 1) {
      for (let y = range.minY; y <= range.maxY; y += 1) {
        const key = this.bucketKey(x, y);
        if (!this.buckets.has(key)) this.buckets.set(key, new Set());
        this.buckets.get(key).add(id);
        bucketKeys.push(key);
      }
    }
    this.items.set(id, { id, bounds: normalized, payload, bucketKeys });
  }

  delete(id) {
    const item = this.items.get(id);
    if (!item) return;
    (item.bucketKeys || []).forEach(key => {
      const bucket = this.buckets.get(key);
      if (!bucket) return;
      bucket.delete(id);
      if (!bucket.size) this.buckets.delete(key);
    });
    this.items.delete(id);
  }

  update(id, bounds, payload = null) {
    this.delete(id);
    this.insert(id, bounds, payload);
  }

  queryPoint(point) {
    const key = this.bucketKey(
      Math.floor(point.x / this.cellSize),
      Math.floor(point.y / this.cellSize)
    );
    const ids = this.buckets.get(key);
    if (!ids) return [];
    const hits = [];
    ids.forEach(id => {
      const item = this.items.get(id);
      if (item && pointInBounds(point, item.bounds)) hits.push(item);
    });
    return hits;
  }

  queryRect(rect) {
    const bounds = normalizeBounds(rect);
    const range = this.bucketRange(bounds);
    const ids = new Set();
    for (let x = range.minX; x <= range.maxX; x += 1) {
      for (let y = range.minY; y <= range.maxY; y += 1) {
        (this.buckets.get(this.bucketKey(x, y)) || []).forEach(id => ids.add(id));
      }
    }
    const hits = [];
    ids.forEach(id => {
      const item = this.items.get(id);
      if (item && rectsIntersect(bounds, item.bounds)) hits.push(item);
    });
    return hits;
  }

  bucketRange(bounds) {
    return {
      minX: Math.floor(bounds.x / this.cellSize),
      maxX: Math.floor((bounds.x + bounds.width) / this.cellSize),
      minY: Math.floor(bounds.y / this.cellSize),
      maxY: Math.floor((bounds.y + bounds.height) / this.cellSize)
    };
  }

  bucketKey(x, y) {
    return `${x}:${y}`;
  }
}

export function normalizeBounds(bounds) {
  const x = Number(bounds.x) || 0;
  const y = Number(bounds.y) || 0;
  const width = Math.max(0, Number(bounds.width) || 0);
  const height = Math.max(0, Number(bounds.height) || 0);
  return { x, y, width, height };
}

export function pointInBounds(point, bounds) {
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height;
}

export function rectsIntersect(a, b) {
  return a.x <= b.x + b.width
    && a.x + a.width >= b.x
    && a.y <= b.y + b.height
    && a.y + a.height >= b.y;
}
