export const TITLE_BLOCK_BASE_WIDTH = 760;
export const TITLE_BLOCK_BASE_HEIGHT = 112;

export function titleBlockLayout(width = TITLE_BLOCK_BASE_WIDTH, height = TITLE_BLOCK_BASE_HEIGHT) {
  const resolvedWidth = Math.max(1, Number(width) || TITLE_BLOCK_BASE_WIDTH);
  const resolvedHeight = Math.max(1, Number(height) || TITLE_BLOCK_BASE_HEIGHT);
  const logoSide = Math.min(resolvedHeight, resolvedWidth);
  const logoX = resolvedWidth - logoSide;
  const firstColumnWidth = Math.min(152, Math.max(1, logoX / 4));
  const columns = [
    0,
    firstColumnWidth,
    firstColumnWidth * 2,
    firstColumnWidth * 3,
    logoX,
    resolvedWidth
  ];
  const half = resolvedHeight / 2;
  const logoPadding = Math.max(8, Math.min(14, logoSide * 0.105));
  return {
    width: resolvedWidth,
    height: resolvedHeight,
    outerRect: { x: 0, y: 0, width: resolvedWidth, height: resolvedHeight },
    columns,
    half,
    logoCell: { x: logoX, y: 0, width: logoSide, height: logoSide },
    logoContentRect: {
      x: logoX + logoPadding,
      y: logoPadding,
      width: Math.max(1, logoSide - logoPadding * 2),
      height: Math.max(1, logoSide - logoPadding * 2)
    },
    rowDivider: { x1: 0, y1: half, x2: logoX, y2: half },
    metaDividers: [
      resolvedHeight * 0.25,
      resolvedHeight * 0.5,
      resolvedHeight * 0.75
    ].map(y => ({ x1: columns[3], y1: y, x2: logoX, y2: y })),
    fields: {
      client: { x: columns[0], y: 0, width: columns[1] - columns[0], height: half },
      revision: { x: columns[0], y: half, width: columns[1] - columns[0], height: half },
      project: { x: columns[1], y: 0, width: columns[2] - columns[1], height: half },
      location: { x: columns[1], y: half, width: columns[2] - columns[1], height: half },
      title: { x: columns[2], y: 0, width: columns[3] - columns[2], height: half },
      jobId: { x: columns[2], y: half, width: columns[3] - columns[2], height: half },
      eventDate: { x: columns[3], y: 0, width: logoX - columns[3], height: resolvedHeight * 0.25 },
      drawingDate: { x: columns[3], y: resolvedHeight * 0.25, width: logoX - columns[3], height: resolvedHeight * 0.25 },
      accountManager: { x: columns[3], y: resolvedHeight * 0.5, width: logoX - columns[3], height: resolvedHeight * 0.25 },
      approvedBy: { x: columns[3], y: resolvedHeight * 0.75, width: logoX - columns[3], height: resolvedHeight * 0.25 }
    }
  };
}
