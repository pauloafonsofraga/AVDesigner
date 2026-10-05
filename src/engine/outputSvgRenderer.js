import { createOutputViewerModel } from "./outputViewerModel.js";
import { drawDeviceVisual } from "./deviceVisualBuilder.js";
import { engineOutputPrimitives, drawEngineOutputLabels, SHARED_BUS_LINE_STYLE } from "./renderer.js";
import { outputAssetSources, isInlineOutputImage } from "./outputViewerAssets.js";
import { OutputSvgContext, svgEscape, svgNumber } from "./outputSvgContext.js";
import { buildOutputJumpNavigation } from "./outputNavigation.js";
import { adapterRotationBounds } from "./adapterRotation.js";

export const OUTPUT_SVG_DEPENDENCY = "engine-svg";

// Resource acquisition is deliberately separate from pure scene serialization.
// resolveImage returns an embedded image with its original intrinsic dimensions.
export async function prepareEnginePrintImages(snapshot, resolveImage) {
  const scene = snapshot.engineScene || snapshot;
  return Object.fromEntries(await Promise.all(outputAssetSources(scene).map(async source => {
    const image = await resolveImage(source);
    if (!isInlineOutputImage(image?.href) || !Number.isFinite(image.width) || !Number.isFinite(image.height)
      || image.width <= 0 || image.height <= 0) throw new Error(`Cannot embed print image: ${source.slice(0,100)}`);
    return [source, { href:image.href, width:image.width, height:image.height }];
  })));
}

function artwork(ctx, device) {
  const bounds = device.kind === "adapter" ? adapterRotationBounds(device) : device;
  ctx.group({ "data-object-id":device.id, "data-kind":device.kind,
    "data-bounds":JSON.stringify({ x:bounds.x, y:bounds.y, width:bounds.width, height:bounds.height }) }, () => {
    ctx.save();
    if (device.kind === "adapter" && device.rotation) {
      ctx.translate(device.x + device.width / 2, device.y + device.height / 2);
      ctx.rotate(device.rotation * Math.PI / 180);
      ctx.translate(-device.width / 2, -device.height / 2);
    } else ctx.translate(device.x, device.y);
    drawDeviceVisual(ctx,device,device.width,device.height,{ connectorMarkers:"live" });
    ctx.restore();
  });
}

export function collectEnginePrintTextMetrics(snapshot, images, measureText) {
  const { contract,scene } = createOutputViewerModel(snapshot);
  const metrics = {}, ctx = new OutputSvgContext({ images });
  ctx.measureText = text => {
    const key = `${ctx.font}\n${text}`;
    if (!(key in metrics)) metrics[key] = measureText(ctx.font,String(text));
    if (!Number.isFinite(metrics[key]) || metrics[key] < 0) throw new Error("Invalid print font metric");
    return { width:metrics[key] };
  };
  scene.devices.filter(d => d.kind !== "jump").forEach(d => artwork(ctx,d));
  if (contract.bounds) drawEngineOutputLabels(ctx,scene,contract.bounds);
  return metrics;
}

/** Deterministic SVG from resolved Engine data and scalar resource descriptors. */
export function renderEngineOutputSvg(snapshot, { images = {}, textMetrics = {}, padding = 24, background = "#ffffff" } = {}) {
  const { contract,scene } = createOutputViewerModel(snapshot);
  if (!Number.isFinite(padding) || padding < 0) throw new RangeError("Invalid print padding");
  const bounds = contract.bounds || { x:0,y:0,width:1,height:1 };
  const ctx = new OutputSvgContext({ images,textMetrics });
  const primitives = engineOutputPrimitives(scene,contract);
  const meshes = (items,attribute) => items.forEach(item => ctx.group({ [attribute]:item.id },()=>ctx.mesh(item.vertices)));
  scene.devices.filter(d => d.kind === "area").forEach(d=>artwork(ctx,d));
  meshes(primitives.racks,"data-rack-id");
  meshes(primitives.wires,"data-wire-id");
  meshes(primitives.looms,"data-loom-id");
  scene.devices.filter(d => !["area","jump"].includes(d.kind)).forEach(d=>artwork(ctx,d));
  meshes(primitives.matrix,"data-matrix-id");
  meshes(primitives.relationships,"data-relationships-device-id");
  contract.sharedBuses.forEach(bus => {
    if (!bus.segments) return;
    ctx.group({ "data-shared-bus-id":bus.relationshipId,"data-device-id":bus.deviceId },()=> {
      ctx.save(); ctx.strokeStyle = SHARED_BUS_LINE_STYLE.color; ctx.lineWidth = SHARED_BUS_LINE_STYLE.width;
      for (const segment of [bus.segments.trunk,bus.segments.stem,...bus.segments.branches]) {
        ctx.beginPath(); ctx.moveTo(segment.x1,segment.y1); ctx.lineTo(segment.x2,segment.y2); ctx.stroke();
      }
      ctx.restore();
    });
  });
  meshes(primitives.jumps,"data-jump-id");
  primitives.connectors.forEach(item=>ctx.group({ "data-connector-id":item.connectorId,"data-device-id":item.deviceId,
    "data-anchor-id":item.anchorId,"data-x":item.point.x,"data-y":item.point.y },()=>ctx.mesh(item.vertices)));
  ctx.group({ "data-layer":"labels" },()=>drawEngineOutputLabels(ctx,scene,bounds));
  const text = ctx.textBounds;
  const x = Math.min(bounds.x,text?.left ?? bounds.x)-padding;
  const y = Math.min(bounds.y,text?.top ?? bounds.y)-padding;
  const view = { x,y,width:Math.max(bounds.x+bounds.width,text?.right ?? bounds.x)-x+padding,
    height:Math.max(bounds.y+bounds.height,text?.bottom ?? bounds.y)-y+padding };
  const navigationCandidates = buildOutputJumpNavigation(contract).jumpNodes.length;
  const diagnostics = { drawingDependency:OUTPUT_SVG_DEPENDENCY, sceneDataSource:contract.sceneDataSource,
    sceneVersion:contract.version, sceneSchemaFingerprint:contract.schemaFingerprint,
    signature:contract.signature, bounds:contract.bounds, viewBox:view, counts:contract.diagnostics.counts,
    visibleAnchors:primitives.connectors.length, embeddedImages:ctx.elements.join("").split("<image ").length-1,
    textMetrics:Object.keys(textMetrics).length, vector:true,
    jumpNodes:primitives.jumps.length, jumpLinks:contract.jumpLinks.length,
    jumpNavigationCandidates:navigationCandidates,
    jumpDestinations:0, jumpAnnotations:0, visibleJumpLinkPaths:0 };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" data-avdesigner-output="engine-svg" data-scene-signature="${svgEscape(contract.signature)}" viewBox="${[view.x,view.y,view.width,view.height].map(svgNumber).join(" ")}" width="${svgNumber(view.width)}" height="${svgNumber(view.height)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Engine project drawing"><metadata>${svgEscape(JSON.stringify(diagnostics))}</metadata><defs>${ctx.defs.join("")}</defs>${background ? `<rect x="${view.x}" y="${view.y}" width="${view.width}" height="${view.height}" fill="${svgEscape(background)}"/>` : ""}${ctx.elements.join("")}</svg>`;
  return { svg,diagnostics };
}
