import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const SVG_NS = "http://www.w3.org/2000/svg";

function decodeSvgDataUrl(value) {
  const match = /^data:image\/svg\+xml(?:;charset=[^;,]+)?(;base64)?,(.*)$/i.exec(value);
  if (!match) return null;
  if (!match[1]) return decodeURIComponent(match[2]);
  if (typeof atob === "function") {
    const binary = atob(match[2]);
    return new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
  }
  return Buffer.from(match[2], "base64").toString("utf8");
}

/** Keep inline SVG plug art vector by replacing image wrappers with nested SVG. */
export function expandInlineSvgImages(svg) {
  if (!svg.includes("data:image/svg+xml")) return svg;
  const errors = [];
  const parser = new DOMParser({ onError: (level, message) => errors.push(`${level}: ${message}`) });
  const document = parser.parseFromString(svg, "image/svg+xml");
  if (errors.length) throw new Error(`Invalid Engine SVG: ${errors[0]}`);
  const images = Array.from({ length: document.getElementsByTagNameNS(SVG_NS, "image").length }, (_, index) =>
    document.getElementsByTagNameNS(SVG_NS, "image").item(index));
  for (const image of images) {
    const href = image.getAttribute("href") || image.getAttribute("xlink:href") || "";
    const source = decodeSvgDataUrl(href);
    if (source === null) continue;
    errors.length = 0;
    const nested = parser.parseFromString(source, "image/svg+xml").documentElement;
    if (errors.length || nested?.localName !== "svg") throw new Error("Invalid inline SVG artwork");
    const embedded = document.createElementNS(SVG_NS, "svg");
    for (let index = 0; index < nested.attributes.length; index++) {
      const attribute = nested.attributes.item(index);
      if (!["x", "y", "width", "height"].includes(attribute.name)) {
        embedded.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
      }
    }
    for (const key of ["x", "y", "width", "height", "preserveAspectRatio"]) {
      if (image.hasAttribute(key)) embedded.setAttribute(key, image.getAttribute(key));
    }
    while (nested.firstChild) {
      embedded.appendChild(document.importNode(nested.firstChild, true));
      nested.removeChild(nested.firstChild);
    }
    image.parentNode.replaceChild(embedded, image);
  }
  return new XMLSerializer().serializeToString(document);
}
