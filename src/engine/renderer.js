const DEVICE_FILL = "#182531";
const DEVICE_SELECTED = "#ff7904";
const PORT_COLOR = "#32b6ff";
const WIRE_FALLBACK = "#32b6ff";
const GRID_MINOR = "rgba(255,255,255,.055)";
const GRID_MAJOR = "rgba(255,255,255,.12)";

export class WebglGraphRenderer {
  constructor(canvas, labelCanvas = null) {
    this.canvas = canvas;
    this.labelCanvas = labelCanvas;
    this.labelContext = labelCanvas?.getContext("2d") || null;
    this.gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false
    });
    if (!this.gl) throw new Error("WebGL2 is not available in this browser.");
    this.staticWireBuffer = this.gl.createBuffer();
    this.staticDeviceBuffer = this.gl.createBuffer();
    this.liveBuffer = this.gl.createBuffer();
    this.gridBuffer = this.gl.createBuffer();
    this.staticWireVertexCount = 0;
    this.staticDeviceVertexCount = 0;
    this.liveVertexCount = 0;
    this.gridVertexCount = 0;
    this.wireVertexMap = new Map();
    this.deviceVertexMap = new Map();
    this.program = createProgram(this.gl, vertexSource, fragmentSource);
    this.positionLocation = this.gl.getAttribLocation(this.program, "a_position");
    this.colorLocation = this.gl.getAttribLocation(this.program, "a_color");
    this.viewLocation = this.gl.getUniformLocation(this.program, "u_view");
    this.resolution = { width: 1, height: 1 };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    if (this.labelCanvas && (this.labelCanvas.width !== width || this.labelCanvas.height !== height)) {
      this.labelCanvas.width = width;
      this.labelCanvas.height = height;
    }
    this.resolution = { width: rect.width, height: rect.height };
    this.gl.viewport(0, 0, width, height);
  }

  setStaticScene(scene) {
    const start = performance.now();
    this.wireVertexMap.clear();
    this.deviceVertexMap.clear();
    const geometryStart = performance.now();
    // Static geometry is built once per scene load. Pan/zoom/drag must not
    // rebuild this path; otherwise large real projects stutter badly.
    scene.wires.forEach(wire => {
      this.wireVertexMap.set(wire.id, verticesForWire(scene, wire, null, 2.2, wire.color || WIRE_FALLBACK));
    });
    scene.devices.forEach(device => {
      this.deviceVertexMap.set(device.id, verticesForDevice(device, null));
    });
    const geometryMs = performance.now() - geometryStart;
    const uploadStart = performance.now();
    this.staticWireVertexCount = upload(this.gl, this.staticWireBuffer, flattenVertexMap(this.wireVertexMap));
    this.staticDeviceVertexCount = upload(this.gl, this.staticDeviceBuffer, flattenVertexMap(this.deviceVertexMap));
    const uploadMs = performance.now() - uploadStart;
    return {
      totalMs: performance.now() - start,
      geometryMs,
      uploadMs,
      wireVertices: this.staticWireVertexCount,
      deviceVertices: this.staticDeviceVertexCount
    };
  }

  updateDirty(scene, { deviceIds = [], wireIds = [] } = {}) {
    const start = performance.now();
    const geometryStart = performance.now();
    // Only refresh objects whose underlying project data changed. This keeps
    // drop/connection work away from the old full-scene geometry rebuild.
    deviceIds.forEach(id => {
      const device = scene.getDevice(id);
      if (device) this.deviceVertexMap.set(id, verticesForDevice(device, null));
      else this.deviceVertexMap.delete(id);
    });
    wireIds.forEach(id => {
      const wire = scene.getWire(id);
      if (wire) this.wireVertexMap.set(id, verticesForWire(scene, wire, null, 2.2, wire.color || WIRE_FALLBACK));
      else this.wireVertexMap.delete(id);
    });
    const geometryMs = performance.now() - geometryStart;
    const uploadStart = performance.now();
    if (wireIds.length) this.staticWireVertexCount = upload(this.gl, this.staticWireBuffer, flattenVertexMap(this.wireVertexMap));
    if (deviceIds.length) this.staticDeviceVertexCount = upload(this.gl, this.staticDeviceBuffer, flattenVertexMap(this.deviceVertexMap));
    const uploadMs = performance.now() - uploadStart;
    return {
      totalMs: performance.now() - start,
      geometryMs,
      uploadMs,
      dirtyDevices: deviceIds.length,
      dirtyWires: wireIds.length
    };
  }

  draw(scene, camera, options = {}) {
    const start = performance.now();
    this.resize();
    const gl = this.gl;
    gl.clearColor(0.047, 0.071, 0.094, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform4f(this.viewLocation, camera.x, camera.y, this.resolution.width / camera.zoom, this.resolution.height / camera.zoom);
    this.drawGrid(camera);
    this.drawBuffer(this.staticWireBuffer, this.staticWireVertexCount);
    this.drawBuffer(this.staticDeviceBuffer, this.staticDeviceVertexCount);
    const liveVertices = [];
    const dragSession = options.dragSession || null;
    if (dragSession) {
      const offsets = dragSession.offsetMap();
      // During drag, selected devices and affected wires are drawn as a live
      // overlay. The cached static scene remains visible for everything else.
      dragSession.affectedWireIds.forEach(wireId => {
        const wire = scene.getWire(wireId);
        if (wire) pushWire(liveVertices, scene, wire, offsets, 3.2, wire.color || WIRE_FALLBACK);
      });
      dragSession.selectedIds.forEach(id => {
        const device = scene.getDevice(id);
        if (device) pushDevice(liveVertices, device, offsets, true);
      });
    } else {
      (options.selectedIds || new Set()).forEach(id => {
        const device = scene.getDevice(id);
        if (device) pushSelectionOutline(liveVertices, device, null);
      });
    }
    this.liveVertexCount = upload(gl, this.liveBuffer, liveVertices);
    this.drawBuffer(this.liveBuffer, this.liveVertexCount);
    this.drawLabels(scene, camera, options);
    return performance.now() - start;
  }

  drawLabels(scene, camera, options = {}) {
    if (!this.labelContext || !this.labelCanvas) return;
    const ctx = this.labelContext;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.resolution.width, this.resolution.height);
    if (camera.zoom < 0.08) return;
    const view = {
      x: camera.x,
      y: camera.y,
      width: this.resolution.width / camera.zoom,
      height: this.resolution.height / camera.zoom
    };
    const visible = scene.spatialIndex.queryRect(view).map(item => item.payload?.device).filter(Boolean);
    if (visible.length > 1500) return;
    const dragSession = options.dragSession || null;
    const offsets = dragSession?.offsetMap();
    const drawn = new Set();
    visible.forEach(device => {
      drawn.add(device.id);
      drawDeviceLabel(ctx, device, camera, offsets);
    });
    (options.selectedIds || new Set()).forEach(id => {
      if (drawn.has(id)) return;
      const device = scene.getDevice(id);
      if (device) drawDeviceLabel(ctx, device, camera, offsets);
    });
  }

  drawGrid(camera) {
    const vertices = [];
    const width = this.resolution.width / camera.zoom;
    const height = this.resolution.height / camera.zoom;
    const step = adaptiveGridStep(camera.zoom);
    const minX = Math.floor(camera.x / step) * step;
    const maxX = camera.x + width;
    const minY = Math.floor(camera.y / step) * step;
    const maxY = camera.y + height;
    for (let x = minX; x <= maxX; x += step) {
      pushLine(vertices, { x, y: camera.y }, { x, y: maxY }, 1.1 / camera.zoom, Math.round(x / step) % 5 === 0 ? GRID_MAJOR : GRID_MINOR);
    }
    for (let y = minY; y <= maxY; y += step) {
      pushLine(vertices, { x: camera.x, y }, { x: maxX, y }, 1.1 / camera.zoom, Math.round(y / step) % 5 === 0 ? GRID_MAJOR : GRID_MINOR);
    }
    this.gridVertexCount = upload(this.gl, this.gridBuffer, vertices);
    this.drawBuffer(this.gridBuffer, this.gridVertexCount);
  }

  drawBuffer(buffer, vertexCount) {
    if (!vertexCount) return;
    const gl = this.gl;
    const stride = 6 * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.colorLocation);
    gl.vertexAttribPointer(this.colorLocation, 4, gl.FLOAT, false, stride, 2 * 4);
    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
  }
}

function adaptiveGridStep(zoom) {
  let step = 100;
  while (step * zoom < 18) step *= 2;
  while (step * zoom > 90 && step > 25) step /= 2;
  return step;
}

function pushDevice(vertices, device, offsets = null, selected = false) {
  const offset = offsets?.get(device.id);
  const x = device.x + (offset?.dx || 0);
  const y = device.y + (offset?.dy || 0);
  if (selected) pushSelectionOutline(vertices, device, offsets);
  pushRect(vertices, x, y, device.width, device.height, device.color || DEVICE_FILL);
  pushLine(vertices, { x, y }, { x: x + device.width, y }, 2.2, "#dbe7f3");
  pushLine(vertices, { x: x + device.width, y }, { x: x + device.width, y: y + device.height }, 2.2, "#dbe7f3");
  pushLine(vertices, { x: x + device.width, y: y + device.height }, { x, y: y + device.height }, 2.2, "#dbe7f3");
  pushLine(vertices, { x, y: y + device.height }, { x, y }, 2.2, "#dbe7f3");
  if (device.connectors?.length) {
    device.connectors.forEach(connector => {
      const px = x + connector.x;
      const py = y + connector.y;
      const size = device.kind === "jump" ? 13 : 8;
      pushRect(vertices, px - size / 2, py - size / 2, size, size, connector.color || PORT_COLOR);
    });
  } else {
    for (let index = 0; index < device.portCount; index += 1) {
      const py = y + device.height * ((index + 1) / (device.portCount + 1));
      pushRect(vertices, x - 4, py - 4, 8, 8, PORT_COLOR);
      pushRect(vertices, x + device.width - 4, py - 4, 8, 8, PORT_COLOR);
    }
  }
}

function pushSelectionOutline(vertices, device, offsets = null) {
  const offset = offsets?.get(device.id);
  const x = device.x + (offset?.dx || 0) - 7;
  const y = device.y + (offset?.dy || 0) - 7;
  const w = device.width + 14;
  const h = device.height + 14;
  pushLine(vertices, { x, y }, { x: x + w, y }, 4, DEVICE_SELECTED);
  pushLine(vertices, { x: x + w, y }, { x: x + w, y: y + h }, 4, DEVICE_SELECTED);
  pushLine(vertices, { x: x + w, y: y + h }, { x, y: y + h }, 4, DEVICE_SELECTED);
  pushLine(vertices, { x, y: y + h }, { x, y }, 4, DEVICE_SELECTED);
}

function pushWire(vertices, scene, wire, offsets, width, color) {
  const points = scene.wirePoints(wire, offsets);
  for (let index = 1; index < points.length; index += 1) {
    pushLine(vertices, points[index - 1], points[index], width, color);
  }
}

function verticesForDevice(device, offsets = null) {
  const vertices = [];
  pushDevice(vertices, device, offsets);
  return vertices;
}

function verticesForWire(scene, wire, offsets = null, width = 2.2, color = WIRE_FALLBACK) {
  const vertices = [];
  pushWire(vertices, scene, wire, offsets, width, color);
  return vertices;
}

function flattenVertexMap(map) {
  const vertices = [];
  map.forEach(chunk => vertices.push(...chunk));
  return vertices;
}

function drawDeviceLabel(ctx, device, camera, offsets = null) {
  const offset = offsets?.get(device.id);
  const x = (device.x + (offset?.dx || 0) - camera.x) * camera.zoom;
  const y = (device.y + (offset?.dy || 0) - camera.y) * camera.zoom;
  const text = String(device.label || device.id || "").trim();
  if (!text) return;
  const size = Math.max(9, Math.min(16, 11 * Math.sqrt(camera.zoom)));
  ctx.font = `700 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,.78)";
  ctx.lineWidth = Math.max(2, size * 0.22);
  ctx.fillStyle = "#ffffff";
  const labelX = x + 8;
  const labelY = y + 7;
  ctx.strokeText(text, labelX, labelY);
  ctx.fillText(text, labelX, labelY);
}

function pushRect(vertices, x, y, width, height, colorValue) {
  const color = parseColor(colorValue);
  const x2 = x + width;
  const y2 = y + height;
  pushVertex(vertices, x, y, color);
  pushVertex(vertices, x2, y, color);
  pushVertex(vertices, x2, y2, color);
  pushVertex(vertices, x, y, color);
  pushVertex(vertices, x2, y2, color);
  pushVertex(vertices, x, y2, color);
}

function pushLine(vertices, from, to, width, colorValue) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!length) return;
  const nx = -dy / length * width / 2;
  const ny = dx / length * width / 2;
  const color = parseColor(colorValue);
  pushVertex(vertices, from.x + nx, from.y + ny, color);
  pushVertex(vertices, to.x + nx, to.y + ny, color);
  pushVertex(vertices, to.x - nx, to.y - ny, color);
  pushVertex(vertices, from.x + nx, from.y + ny, color);
  pushVertex(vertices, to.x - nx, to.y - ny, color);
  pushVertex(vertices, from.x - nx, from.y - ny, color);
}

function pushVertex(vertices, x, y, color) {
  vertices.push(x, y, color[0], color[1], color[2], color[3]);
}

function upload(gl, buffer, vertices) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  return vertices.length / 6;
}

function parseColor(value) {
  if (Array.isArray(value)) return value;
  const text = String(value || "#ffffff").trim();
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (rgba) {
    const parts = rgba[1].split(",").map(part => Number(part.trim()));
    return [
      (parts[0] || 0) / 255,
      (parts[1] || 0) / 255,
      (parts[2] || 0) / 255,
      Number.isFinite(parts[3]) ? parts[3] : 1
    ];
  }
  const hex = /^#?([0-9a-f]{6})$/i.exec(text);
  if (!hex) return [1, 1, 1, 1];
  const valueInt = parseInt(hex[1], 16);
  return [
    ((valueInt >> 16) & 255) / 255,
    ((valueInt >> 8) & 255) / 255,
    (valueInt & 255) / 255,
    1
  ];
}

function createProgram(gl, vertex, fragment) {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "WebGL program link failed");
  }
  return program;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "WebGL shader compile failed");
  }
  return shader;
}

const vertexSource = `#version 300 es
  in vec2 a_position;
  in vec4 a_color;
  uniform vec4 u_view;
  out vec4 v_color;
  void main() {
    vec2 clip = vec2(
      ((a_position.x - u_view.x) / u_view.z) * 2.0 - 1.0,
      1.0 - ((a_position.y - u_view.y) / u_view.w) * 2.0
    );
    gl_Position = vec4(clip, 0.0, 1.0);
    v_color = a_color;
  }
`;

const fragmentSource = `#version 300 es
  precision mediump float;
  in vec4 v_color;
  out vec4 outColor;
  void main() {
    outColor = v_color;
  }
`;
