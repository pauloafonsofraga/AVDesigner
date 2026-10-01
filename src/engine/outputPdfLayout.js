const MM_TO_PT = 72 / 25.4;
const PAPER_MM = Object.freeze({
  A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841]
});

export function pdfPageLayout({ paper = "A3", orientation = "landscape", marginMm = 4,
  scale = "fit", svgViewBox }) {
  const size = PAPER_MM[String(paper).toUpperCase()];
  if (!size || !["landscape", "portrait"].includes(orientation)) throw new RangeError("Unsupported PDF paper or orientation");
  const [short, long] = size.map(value => value * MM_TO_PT);
  const paperWidth = orientation === "landscape" ? long : short;
  const paperHeight = orientation === "landscape" ? short : long;
  const margin = Number(marginMm) * MM_TO_PT;
  const view = svgViewBox;
  if (!Number.isFinite(margin) || margin < 0 || margin * 2 >= Math.min(paperWidth, paperHeight)
    || !view || ![view.x, view.y, view.width, view.height].every(Number.isFinite)
    || view.width <= 0 || view.height <= 0) throw new RangeError("Invalid PDF drawing geometry");
  const availableWidth = paperWidth - 2 * margin, availableHeight = paperHeight - 2 * margin;
  const fitScale = Math.min(availableWidth / view.width, availableHeight / view.height);
  const scaleFactor = scale === "fit" ? 1 : Number(scale) / 100;
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0 || scaleFactor > 1) throw new RangeError("PDF scale must be Fit or 1-100%");
  const drawingScale = fitScale * scaleFactor;
  const renderedWidth = view.width * drawingScale, renderedHeight = view.height * drawingScale;
  const offsetX = margin + (availableWidth - renderedWidth) / 2;
  const offsetY = margin + (availableHeight - renderedHeight) / 2;
  const point = (x, y) => ({ x: offsetX + (x - view.x) * drawingScale,
    y: offsetY + (y - view.y) * drawingScale });
  const rect = bounds => {
    const topLeft = point(bounds.x, bounds.y);
    return { x: topLeft.x, y: topLeft.y,
      width: bounds.width * drawingScale, height: bounds.height * drawingScale };
  };
  return Object.freeze({ paperWidth, paperHeight, margin, scale: drawingScale, fitScale,
    drawingRect: Object.freeze({ x: offsetX, y: offsetY, width: renderedWidth, height: renderedHeight }),
    point, rect });
}
