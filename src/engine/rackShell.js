export const DEFAULT_RACK_SHELL_STYLE_ID = "standard";
export const DEFAULT_RACK_SHELL_COLOR = "#3A7FA5";
export const RACK_SHELL_ASSET_PATH = "./assets/rack-shells/standard-neutral.png";

export const RACK_SHELL_STYLES = Object.freeze({
  standard: Object.freeze({
    id: "standard",
    label: "Standard",
    src: RACK_SHELL_ASSET_PATH,
    sourceWidth: 96,
    sourceHeight: 96,
    insets: Object.freeze({ left: 24, top: 24, right: 24, bottom: 24 }),
    padding: Object.freeze({ left: 18, top: 18, right: 18, bottom: 18 })
  }),
  professional: Object.freeze({
    id: "professional",
    label: "Professional AV Rack",
    src: "./assets/rack-shells/professional-neutral.png",
    sourceWidth: 1254,
    sourceHeight: 1254,
    sourceInsets: Object.freeze({ left: 165, top: 155, right: 165, bottom: 175 }),
    destinationInsets: Object.freeze({ left: 27, top: 27, right: 27, bottom: 27 }),
    padding: Object.freeze({ left: 18, top: 18, right: 18, bottom: 18 })
  }),
  touring: Object.freeze({
    id: "touring",
    label: "Touring Flight Case",
    src: "./assets/rack-shells/touring-neutral.png",
    sourceWidth: 1254,
    sourceHeight: 1254,
    sourceInsets: Object.freeze({ left: 180, top: 170, right: 180, bottom: 180 }),
    destinationInsets: Object.freeze({ left: 34, top: 34, right: 34, bottom: 34 }),
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
  const insets = destinationInsetsFor(style);
  const { left, top, right, bottom } = style.padding;
  const width = Math.max(insets.left + insets.right,
    Number(compactContentBounds.width) + left + right);
  const height = Math.max(insets.top + insets.bottom,
    Number(compactContentBounds.height) + top + bottom);
  return {
    x: Number(compactContentBounds.x) - left - (width - Number(compactContentBounds.width) - left - right) / 2,
    y: Number(compactContentBounds.y) - top - (height - Number(compactContentBounds.height) - top - bottom) / 2,
    width,
    height
  };
}

function resolveRackShellStyle(value) {
  if (typeof value === "string") {
    return RACK_SHELL_STYLES[value] || RACK_SHELL_STYLES[DEFAULT_RACK_SHELL_STYLE_ID];
  }
  if (value && typeof value === "object"
    && Number.isFinite(Number(value.sourceWidth)) && Number.isFinite(Number(value.sourceHeight))
    && (value.sourceInsets || value.destinationInsets || value.insets)) {
    const legacyInsets = value.insets || {};
    return {
      ...value,
      sourceInsets: value.sourceInsets || legacyInsets,
      destinationInsets: value.destinationInsets || legacyInsets,
      padding: value.padding || { left: 0, top: 0, right: 0, bottom: 0 }
    };
  }
  return rackShellStyle(value);
}

export function rackShellSlices(styleOrId = DEFAULT_RACK_SHELL_STYLE_ID, shellRect = {}) {
  const style = resolveRackShellStyle(styleOrId);
  const sourceInsets = sourceInsetsFor(style);
  const destinationInsets = destinationInsetsFor(style);
  const sx = [0, sourceInsets.left, style.sourceWidth - sourceInsets.right, style.sourceWidth];
  const sy = [0, sourceInsets.top, style.sourceHeight - sourceInsets.bottom, style.sourceHeight];
  const minWidth = destinationInsets.left + destinationInsets.right;
  const minHeight = destinationInsets.top + destinationInsets.bottom;
  const width = Math.max(minWidth, Number(shellRect.width) || 0);
  const height = Math.max(minHeight, Number(shellRect.height) || 0);
  const dx = [Number(shellRect.x) || 0, (Number(shellRect.x) || 0) + destinationInsets.left,
    (Number(shellRect.x) || 0) + width - destinationInsets.right, (Number(shellRect.x) || 0) + width];
  const dy = [Number(shellRect.y) || 0, (Number(shellRect.y) || 0) + destinationInsets.top,
    (Number(shellRect.y) || 0) + height - destinationInsets.bottom, (Number(shellRect.y) || 0) + height];
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

function sourceInsetsFor(style) {
  return style.sourceInsets || style.insets;
}

function destinationInsetsFor(style) {
  return style.destinationInsets || style.insets;
}
