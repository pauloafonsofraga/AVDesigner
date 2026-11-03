// Internal family keys stay stable for historical project high-water marks.
export const CABLE_NUMBER_PREFIXES = Object.freeze({V:"VX", A:"LX", L:"RX", N:"IT", P:"PWR", U:"USB", F:"F", X:"X"});
const familyByPrefix = Object.freeze({V:"V", VX:"V", A:"A", LX:"A", L:"L", RX:"L", N:"N", IT:"N", P:"P", PWR:"P", USB:"U", F:"F", X:"X"});

export function parseCableNumber(value) {
  const match = String(value || "").match(/^(VX|LX|RX|IT|PWR|USB|V|A|L|N|P|F|X)-(\d{3,})$/);
  return match ? {family:familyByPrefix[match[1]], digits:match[2], number:Number(match[2])} : null;
}

export function formatCableNumber(value, family) {
  const parsed = parseCableNumber(value);
  const target = family === "U" && parsed?.family === "X" ? "U" : parsed?.family;
  return parsed ? `${CABLE_NUMBER_PREFIXES[target]}-${parsed.digits}` : String(value || "");
}
