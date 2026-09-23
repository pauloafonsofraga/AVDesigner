// Canvas drawing commands, not a second device layout engine. Coordinates and
// text placement are supplied by the Engine's existing artwork/label routines.
export const svgEscape = value => String(value ?? "").replace(/[&<>"']/g,
  char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));
export const svgNumber = value => {
  if (!Number.isFinite(Number(value))) throw new TypeError("Non-finite SVG coordinate");
  return String(Number(value));
};

const stateKeys = ["fillStyle", "strokeStyle", "lineWidth", "lineCap", "lineJoin", "globalAlpha",
  "font", "textAlign", "textBaseline", "lineDash", "matrix", "clips"];
const multiply = (a, b) => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
  a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];

export function printPaint(color, role = "fill") {
  const value = String(color).toLowerCase().replace(/\s/g, "");
  if (value === "transparent") return value;
  if (role === "text-stroke") return "#ffffff";
  const hex = /^#([\da-f]{6})$/i.exec(value);
  const rgb = /^rgba?\((\d+),(\d+),(\d+)(?:,([.\d]+))?\)$/.exec(value);
  const channels = hex ? [0,2,4].map(i => parseInt(hex[1].slice(i, i+2),16)) : rgb?.slice(1,4).map(Number);
  if (!channels) return value;
  const [r,g,b] = channels, bright = Math.min(...channels) > 190;
  const dark = Math.max(...channels) < 90;
  const alpha = rgb?.[4] ?? 1;
  if (role === "text") {
    if (bright || dark) return "#17212b";
    if (b > 180 && r < 90) return "#00769d";
  } else if (role === "stroke" && bright) return `rgba(60,78,91,${alpha})`;
  else if (role === "fill" && dark) return `rgba(241,245,248,${alpha})`;
  return value;
}

export class OutputSvgContext {
  constructor({ images = {}, textMetrics = {} } = {}) {
    this.images = images; this.textMetrics = textMetrics;
    this.elements = []; this.defs = []; this.stack = []; this.path = []; this.textBounds = null;
    this.fillStyle = "#000000"; this.strokeStyle = "#000000"; this.lineWidth = 1;
    this.lineCap = "butt"; this.lineJoin = "miter"; this.globalAlpha = 1;
    this.font = "10px sans-serif"; this.textAlign = "left"; this.textBaseline = "alphabetic";
    this.lineDash = []; this.matrix = [1,0,0,1,0,0]; this.clips = [];
  }
  save() { this.stack.push(Object.fromEntries(stateKeys.map(k => [k, Array.isArray(this[k]) ? [...this[k]] : this[k]]))); }
  restore() { const state = this.stack.pop(); if (!state) throw new Error("Unbalanced SVG restore"); Object.assign(this,state); }
  translate(x,y) { this.matrix = multiply(this.matrix, [1,0,0,1,x,y]); }
  scale(x,y) { this.matrix = multiply(this.matrix, [x,0,0,y,0,0]); }
  rotate(angle) { const c = Math.cos(angle), s = Math.sin(angle); this.matrix = multiply(this.matrix, [c,s,-s,c,0,0]); }
  setLineDash(dash) { this.lineDash = [...dash]; }
  beginPath() { this.path = []; }
  moveTo(x,y) { this.path.push(`M${svgNumber(x)} ${svgNumber(y)}`); }
  lineTo(x,y) { this.path.push(`L${svgNumber(x)} ${svgNumber(y)}`); }
  quadraticCurveTo(...p) { this.path.push(`Q${p.map(svgNumber).join(" ")}`); }
  bezierCurveTo(...p) { this.path.push(`C${p.map(svgNumber).join(" ")}`); }
  closePath() { this.path.push("Z"); }
  rect(x,y,w,h) { this.moveTo(x,y); this.lineTo(x+w,y); this.lineTo(x+w,y+h); this.lineTo(x,y+h); this.closePath(); }
  arc(x,y,r,start,end,anticlockwise = false) {
    if (r < 0) throw new RangeError("Negative SVG arc radius");
    const tau = Math.PI * 2, full = Math.abs(end-start) >= tau;
    let delta = end-start;
    if (full) delta = anticlockwise ? -tau : tau;
    else if (anticlockwise && delta > 0) delta -= tau;
    else if (!anticlockwise && delta < 0) delta += tau;
    const point = a => [x+r*Math.cos(a), y+r*Math.sin(a)];
    if (this.path.length) this.lineTo(...point(start)); else this.moveTo(...point(start));
    const steps = full ? 2 : 1;
    for (let i=1; i<=steps; i++) this.path.push(`A${r} ${r} 0 ${Math.abs(delta/steps)>Math.PI?1:0} ${anticlockwise?0:1} ${point(start+delta*i/steps).map(svgNumber).join(" ")}`);
  }
  transformAttribute() { return `transform="matrix(${this.matrix.map(svgNumber).join(" ")})"`; }
  paint(value,role) {
    if (typeof value !== "object") return svgEscape(printPaint(value,role));
    if (!value.id) {
      value.id = `print-gradient-${this.defs.length}`;
      const stops = value.stops.map(([offset,color]) => `<stop offset="${svgNumber(offset)}" stop-color="${svgEscape(printPaint(color,role))}"/>`).join("");
      this.defs.push(`<${value.type} id="${value.id}" gradientUnits="userSpaceOnUse" ${value.attrs}>${stops}</${value.type}>`);
    }
    return `url(#${value.id})`;
  }
  emit(element) {
    let value = `<g ${this.transformAttribute()} opacity="${svgNumber(this.globalAlpha)}">${element}</g>`;
    for (const id of this.clips) value = `<g clip-path="url(#${id})">${value}</g>`;
    this.elements.push(value);
  }
  strokeAttributes(role = "stroke") {
    return `stroke="${this.paint(this.strokeStyle,role)}" stroke-width="${svgNumber(this.lineWidth)}" stroke-linecap="${svgEscape(this.lineCap)}" stroke-linejoin="${svgEscape(this.lineJoin)}"${this.lineDash.length ? ` stroke-dasharray="${this.lineDash.map(svgNumber).join(" ")}"` : ""}`;
  }
  fill() { this.emit(`<path d="${this.path.join(" ")}" fill="${this.paint(this.fillStyle,"fill")}"/>`); }
  stroke() { this.emit(`<path d="${this.path.join(" ")}" fill="none" ${this.strokeAttributes()}/>`); }
  fillRect(x,y,w,h) { this.emit(`<rect x="${svgNumber(x)}" y="${svgNumber(y)}" width="${svgNumber(w)}" height="${svgNumber(h)}" fill="${this.paint(this.fillStyle,"fill")}"/>`); }
  strokeRect(x,y,w,h) { this.emit(`<rect x="${svgNumber(x)}" y="${svgNumber(y)}" width="${svgNumber(w)}" height="${svgNumber(h)}" fill="none" ${this.strokeAttributes()}/>`); }
  clip() {
    const id = `print-clip-${this.defs.length}`;
    this.defs.push(`<clipPath id="${id}"><path ${this.transformAttribute()} d="${this.path.join(" ")}"/></clipPath>`);
    this.clips = [...this.clips,id];
  }
  measureText(text) {
    const key = `${this.font}\n${text}`;
    if (Number.isFinite(this.textMetrics[key])) return { width: this.textMetrics[key] };
    // Deterministic headless fallback. Browser export supplies exact measured
    // widths as scalar inputs; the serializer itself never accesses a DOM/font.
    const size = Number(this.font.match(/([.\d]+)px/)?.[1] || 10);
    return { width: [...String(text)].reduce((sum,char) => sum + (/[ ilI.,:;!|]/.test(char) ? .3 : /[MW@]/.test(char) ? .9 : .6),0)*size };
  }
  text(text,x,y,stroke) {
    const parsed = this.font.match(/^(.*?)\s*([.\d]+)px\s+(.+)$/);
    const weight = parsed?.[1]?.trim() || "normal", size = Number(parsed?.[2] || 10);
    const anchor = this.textAlign === "center" ? "middle" : ["right","end"].includes(this.textAlign) ? "end" : "start";
    const baseline = ({ middle:"central", top:"text-before-edge", bottom:"text-after-edge", hanging:"hanging" })[this.textBaseline] || "alphabetic";
    // Include outward Engine labels in the print viewport without moving them
    // or changing the canonical geometric bounds/signature.
    const width = this.measureText(text).width, halo = stroke ? this.lineWidth/2 : 0;
    const left = x - (anchor === "middle" ? width/2 : anchor === "end" ? width : 0) - halo;
    const top = y - (["top","hanging"].includes(this.textBaseline) ? 0 : this.textBaseline === "middle" ? size*.6 : size) - halo;
    for (const [px,py] of [[left,top],[left+width+2*halo,top],[left,top+size*1.2+2*halo],[left+width+2*halo,top+size*1.2+2*halo]]) {
      const [a,b,c,d,e,f] = this.matrix, wx = a*px+c*py+e, wy = b*px+d*py+f;
      if (!this.textBounds) this.textBounds = { left:wx,top:wy,right:wx,bottom:wy };
      this.textBounds.left = Math.min(this.textBounds.left,wx); this.textBounds.top = Math.min(this.textBounds.top,wy);
      this.textBounds.right = Math.max(this.textBounds.right,wx); this.textBounds.bottom = Math.max(this.textBounds.bottom,wy);
    }
    this.emit(`<text x="${svgNumber(x)}" y="${svgNumber(y)}" font-family="${svgEscape(parsed?.[3] || "sans-serif")}" font-size="${size}" font-weight="${svgEscape(weight)}" text-anchor="${anchor}" dominant-baseline="${baseline}" xml:space="preserve" ${stroke ? `fill="none" ${this.strokeAttributes("text-stroke")}` : `fill="${this.paint(this.fillStyle,"text")}"`}>${svgEscape(text)}</text>`);
  }
  fillText(text,x,y) { this.text(text,x,y,false); }
  strokeText(text,x,y) { this.text(text,x,y,true); }
  resolveImage(source) {
    if (!source) return null;
    const image = this.images[source];
    if (!image || !/^data:image\//i.test(image.href) || !(image.width > 0 && image.height > 0)) throw new Error(`Missing print image: ${String(source).slice(0,100)}`);
    return { ...image, complete:true, naturalWidth:image.width, naturalHeight:image.height };
  }
  drawImage(image,x,y,width,height) {
    this.emit(`<image href="${svgEscape(image.href)}" x="${svgNumber(x)}" y="${svgNumber(y)}" width="${svgNumber(width)}" height="${svgNumber(height)}" preserveAspectRatio="none"/>`);
  }
  createLinearGradient(x1,y1,x2,y2) { return this.gradient("linearGradient",`x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"`); }
  createRadialGradient(x1,y1,r1,x2,y2,r2) { return this.gradient("radialGradient",`fx="${x1}" fy="${y1}" fr="${r1}" cx="${x2}" cy="${y2}" r="${r2}"`); }
  gradient(type,attrs) { return { type,attrs,stops:[],addColorStop(offset,color) { this.stops.push([offset,color]); } }; }
  group(attributes, draw) {
    const start = this.elements.length;
    draw();
    const content = this.elements.splice(start).join("");
    this.elements.push(`<g ${Object.entries(attributes).map(([key,value]) => `${key}="${svgEscape(value)}"`).join(" ")}>${content}</g>`);
  }
  mesh(vertices) {
    let color = "", paths = [];
    const flush = () => { if (paths.length) this.elements.push(`<path fill="${color}" d="${paths.join(" ")}"/>`); paths = []; };
    for (let i=0; i<vertices.length; i+=18) {
      const rgba = vertices.slice(i+2,i+6), next = `rgba(${rgba.slice(0,3).map(c=>Math.round(c*255)).join(",")},${svgNumber(rgba[3])})`;
      if (next !== color) { flush(); color = next; }
      paths.push(`M${svgNumber(vertices[i])} ${svgNumber(vertices[i+1])}L${svgNumber(vertices[i+6])} ${svgNumber(vertices[i+7])}L${svgNumber(vertices[i+12])} ${svgNumber(vertices[i+13])}Z`);
    }
    flush();
  }
}
