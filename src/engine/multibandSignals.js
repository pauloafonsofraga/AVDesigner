const band = (id, color) => Object.freeze({id, color});
export const MULTIBAND_SIGNALS = Object.freeze({
  powerlock: Object.freeze({rendering:"multiband", bands:Object.freeze([
    band("conductor-1","#03E300"),band("conductor-2","#2A7FFF"),band("conductor-3","#A05A2C"),
    band("conductor-4","#4A4A4A"),band("conductor-5","#999999")])}),
  "component-video": Object.freeze({label:"Component Video (YPbPr)", rendering:"multiband", impedanceOhms:75,
    connectorFamilies:Object.freeze(["bnc","rca"]), bands:Object.freeze([band("Y","#00E676"),band("Pb","#2A7FFF"),band("Pr","#FF1744")])}),
  rgbhv: Object.freeze({label:"RGBHV", rendering:"multiband", impedanceOhms:75,
    connectorFamilies:Object.freeze(["bnc"]), bands:Object.freeze([band("R","#FF1744"),band("G","#00E676"),
      band("B","#2A7FFF"),band("H","#FFD600"),band("V","#FFFFFF")])})
});

export function multibandSignal(value) {
  const type = typeof value === "string" ? value : value?.compatibilityType || value?.type || value?.physicalType;
  return MULTIBAND_SIGNALS[type] || null;
}
export const multibandColors = value => multibandSignal(value)?.bands.map(b => b.color) || null;
export function groupedCoaxMetadata(connector) {
  const signal = multibandSignal(connector);
  if (!signal?.impedanceOhms) return null;
  const requested = String(connector?.coaxConnectorFamily || signal.connectorFamilies[0]).toLowerCase();
  const family = signal.connectorFamilies.includes(requested) ? requested : signal.connectorFamilies[0];
  return {signal:signal.label, count:signal.bands.length, impedanceOhms:75, connectorFamily:family,
    circuits:signal.bands.map(({id}) => ({id, impedanceOhms:75, connectorFamily:family}))};
}
export function groupedCoaxLabel(connector) {
  const info = groupedCoaxMetadata(connector);
  return info ? `${info.count} x ${info.connectorFamily.toUpperCase()} (75 ohm)` : "";
}
export const multibandCss = colors => `linear-gradient(90deg, ${colors.map((c,i)=>`${c} ${i/colors.length*100}% ${(i+1)/colors.length*100}%`).join(", ")})`;
