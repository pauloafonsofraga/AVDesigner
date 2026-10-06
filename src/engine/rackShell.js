export const DEFAULT_RACK_SHELL_STYLE_ID = "standard";
export const DEFAULT_RACK_SHELL_COLOR = "#3A7FA5";
export const RACK_SHELL_ASSET_PATH = "./assets/rack-shells/standard-neutral.png";

export const RACK_SHELL_STYLES = Object.freeze({
  standard: Object.freeze({
    id: "standard",
    src: RACK_SHELL_ASSET_PATH,
    sourceWidth: 96,
    sourceHeight: 96,
    insets: Object.freeze({ left: 24, top: 24, right: 24, bottom: 24 }),
    padding: Object.freeze({ left: 18, top: 18, right: 18, bottom: 18 })
  })
});

const SLICE_ROLES = [
  ["top-left", "left", "top"], ["top", "center", "top"], ["top-right", "right", "top"],
  ["left", "left", "center"], ["center", "center", "center"], ["right", "right", "center"],
  ["bottom-left", "left", "bottom"], ["bottom", "center", "bottom"], ["bottom-right", "right", "bottom"]
];

export function normalizeRackShell(value = {}) {
  const requestedStyle = String(value?.styleId || DEFAULT_RACK_SHELL_STYLE_ID);
  const styleId = RACK_SHELL_STYLES[requestedStyle] ? requestedStyle : DEFAULT_RACK_SHELL_STYLE_ID;
  const color = /^#[0-9a-f]{6}$/i.test(String(value?.color || ""))
    ? String(value.color).toUpperCase() : DEFAULT_RACK_SHELL_COLOR;
  return { styleId, color };
}

export function rackShellStyle(value = {}) {
  return RACK_SHELL_STYLES[normalizeRackShell(value).styleId];
}

export function rackShellBounds(compactContentBounds, rackShell = {}) {
  if (!compactContentBounds) return null;
  const style = rackShellStyle(rackShell);
  const { left, top, right, bottom } = style.padding;
  const width = Math.max(style.insets.left + style.insets.right,
    Number(compactContentBounds.width) + left + right);
  const height = Math.max(style.insets.top + style.insets.bottom,
    Number(compactContentBounds.height) + top + bottom);
  return {
    x: Number(compactContentBounds.x) - left - (width - Number(compactContentBounds.width) - left - right) / 2,
    y: Number(compactContentBounds.y) - top - (height - Number(compactContentBounds.height) - top - bottom) / 2,
    width,
    height
  };
}

export function rackShellSlices(styleOrId = DEFAULT_RACK_SHELL_STYLE_ID, shellRect = {}) {
  const style = typeof styleOrId === "string"
    ? RACK_SHELL_STYLES[styleOrId] || RACK_SHELL_STYLES[DEFAULT_RACK_SHELL_STYLE_ID]
    : rackShellStyle(styleOrId);
  const sx = [0, style.insets.left, style.sourceWidth - style.insets.right, style.sourceWidth];
  const sy = [0, style.insets.top, style.sourceHeight - style.insets.bottom, style.sourceHeight];
  const minWidth = style.insets.left + style.insets.right;
  const minHeight = style.insets.top + style.insets.bottom;
  const width = Math.max(minWidth, Number(shellRect.width) || 0);
  const height = Math.max(minHeight, Number(shellRect.height) || 0);
  const dx = [Number(shellRect.x) || 0, (Number(shellRect.x) || 0) + style.insets.left,
    (Number(shellRect.x) || 0) + width - style.insets.right, (Number(shellRect.x) || 0) + width];
  const dy = [Number(shellRect.y) || 0, (Number(shellRect.y) || 0) + style.insets.top,
    (Number(shellRect.y) || 0) + height - style.insets.bottom, (Number(shellRect.y) || 0) + height];
  return SLICE_ROLES.map(([role, column, row]) => {
    const col = column === "left" ? 0 : column === "center" ? 1 : 2;
    const r = row === "top" ? 0 : row === "center" ? 1 : 2;
    return {
      role,
      sourceRect: { x: sx[col], y: sy[r], width: sx[col + 1] - sx[col], height: sy[r + 1] - sy[r] },
      destinationRect: { x: dx[col], y: dy[r], width: dx[col + 1] - dx[col], height: dy[r + 1] - dy[r] }
    };
  });
}
