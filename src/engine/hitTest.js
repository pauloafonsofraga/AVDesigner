export function screenToWorld(camera, point) {
  return {
    x: camera.x + point.x / camera.zoom,
    y: camera.y + point.y / camera.zoom
  };
}

export function hitTestDevice(scene, worldPoint) {
  const start = performance.now();
  const hits = scene.spatialIndex.queryPoint(worldPoint);
  let result = null;
  for (let index = hits.length - 1; index >= 0; index -= 1) {
    const item = hits[index];
    if (item?.payload?.device) {
      result = item.payload.device;
      break;
    }
  }
  return {
    device: result,
    ms: performance.now() - start
  };
}
