import { deflateSync } from "node:zlib";

function png(width, height, variant = 0) {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 4 + 1) + 1 + x * 4;
    const stripe = Math.floor(x / (width / 6)) % 2;
    rows.set(variant ? [35, 170 + stripe * 40, 90, 255] : [225, 80 + stripe * 90, 45 + Math.floor(y / height * 80), 255], offset);
  }
  const chunk = (type, bytes) => {
    const data = Buffer.concat([Buffer.from(type), bytes]);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const result = Buffer.alloc(bytes.length + 12);
    result.writeUInt32BE(bytes.length); data.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return "data:image/png;base64," + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 0 })), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}

let assets;
export function canvasClipboardAssetsFixture() {
  assets ??= {
    faceplate: png(2304, 1600),
    connector: png(160, 160, 1),
    card: "data:image/svg+xml;base64," + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="80"><desc>${"Card artwork ".repeat(6000)}</desc><rect width="180" height="80" fill="#159447"/><text x="15" y="48" fill="white" font-size="24">I/O CARD</text></svg>`).toString("base64")
  };
  const connector = (id, direction) => ({ id, type: "custom-port", direction, signalDirection: direction,
    x: direction === "input" ? 0 : 440, y: 240, displaySide: direction === "input" ? "left" : "right", nameText: id });
  const template = { id: "asset-device", name: "Asset Heavy Device", width: 440, height: 620, schemaVersion: 2,
    deviceDefinitionVersion: 2, faceImage: assets.faceplate, thumbnailImage: assets.faceplate,
    faceImageNaturalWidth: 2304, faceImageNaturalHeight: 1600, faceImageScale: 1,
    hasSwappableCards: true, connectors: [connector("input", "input"), connector("output", "output")],
    cardTypes: [{ id: "io-card", name: "Asset Card", kind: "io", thumbnailImage: assets.card,
      captionTextColor: "#ffffff", captionBackgroundColor: "#159447", connectors: [connector("card-in", "input"), connector("card-out", "output")] }],
    cardSlots: [{ id: "slot", y: 320, installedCardTypeId: "io-card" }], projectCustomDevice: true };
  const project = { deviceLibrary: [template], nodeLibrary: [{ id: "custom-port", label: "Artwork port", custom: true,
    color: "#00aa66", thumbnail: assets.connector }],
    devices: [{ instanceId: "asset-a", templateId: template.id, name: "Asset A", x: 0, y: 0, faceImage: assets.faceplate },
      { instanceId: "asset-b", templateId: template.id, name: "Asset B", x: 720, y: 0 }],
    imageObjects: [{ id: "asset-image", x: 10, y: 740, width: 440, height: 306, image: assets.faceplate }],
    connections: [{ id: "asset-wire", from: { deviceId: "asset-a", connectorId: "output" },
      to: { deviceId: "asset-b", connectorId: "input" }, cableType: "custom-port" }],
    ledSurfaces: [], areas: [], jumpNodes: [], jumpLinks: [], comments: [], titleBlocks: [], racks: [] };
  const items = [{ type: "device", id: "asset-a" }, { type: "device", id: "asset-b" }, { type: "image-object", id: "asset-image" }];
  return { project, items, assets, bounds: { x: 0, y: 0, width: 1160, height: 1046 } };
}

export function inlineAssetMetrics(value) {
  const references = [];
  const visit = item => {
    if (typeof item === "string" && item.startsWith("data:image/")) references.push(item);
    else if (item && typeof item === "object") Object.values(item).forEach(visit);
  };
  visit(value);
  return { originalInlineJsonBytes: Buffer.byteLength(JSON.stringify(value)),
    embeddedAssetStringBytes: references.reduce((n, value) => n + Buffer.byteLength(value), 0),
    uniqueAssets: new Set(references).size, assetReferences: references.length,
    repeatedAssetReferences: references.length - new Set(references).size };
}

export function canvasClipboardMimeFixture() {
  const fixture = canvasClipboardAssetsFixture();
  const faceplate = fixture.assets.faceplate.replace("data:image/png;", "data:image/jpeg;");
  fixture.assets = { ...fixture.assets, faceplate };
  fixture.project.deviceLibrary[0].faceImage = faceplate;
  fixture.project.devices[0].faceImage = faceplate;
  fixture.project.imageObjects[0].image = faceplate;
  // The thumbnail retains its correct PNG header: both representations must
  // share one stored asset without changing the reusable definition's identity.
  return fixture;
}
