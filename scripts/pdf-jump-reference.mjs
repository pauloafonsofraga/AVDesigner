import { buildOutputJumpNavigation } from "../src/engine/outputNavigation.js";

const escape = value => String(value).replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
})[character]);

// Developer reference only. The normal print serializer never calls this.
export function referenceJumpLinksInSvg(svg, scene) {
  const manifest = buildOutputJumpNavigation(scene);
  const links = manifest.jumpNodes.map(node => {
    const bounds = Object.entries(node.bounds).map(([key, value]) => `${key}="${value}"`).join(" ");
    return `<a id="${node.destinationId}" href="#${node.targetDestinationId}" data-pdf-jump-source="${escape(node.sourceId)}" data-pdf-jump-target="${escape(node.targetId)}"><rect ${bounds} fill="none" stroke="none" pointer-events="all"/></a>`;
  }).join("");
  if (!svg.endsWith("</svg>")) throw new Error("Expected a complete Engine SVG");
  return { svg: svg.slice(0, -6) + `<g data-layer="experimental-pdf-jump-links">${links}</g></svg>`,
    manifest };
}
