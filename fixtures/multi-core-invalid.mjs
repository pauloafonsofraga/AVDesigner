import { multiCoreJumpProject } from "./multi-core-jump.mjs";

export const multiCoreInvalidCases = [
  ["missing aggregate", p => p.multiCores = []],
  ["missing end", p => delete p.multiCores[0].ends.B],
  ["missing port", p => p.multiCores[0].ends.A.connectors.shift()],
  ["duplicate circuit", p => p.multiCores[0].circuits[1].id = p.multiCores[0].circuits[0].id],
  ["duplicate end", p => p.multiCores[0].ends.B.id = p.multiCores[0].ends.A.id],
  ["incompatible media", p => p.multiCores[0].circuits[0].mediaSpec = "Cat6A"],
  ["unknown physical metadata", p => p.multiCores[0].circuits[0].physical = { futureProperty: "retained" }],
  ["future schema", p => p.multiCores[0].schemaVersion = 999],
  ["invalid route point", p => p.multiCores[0].trunk.routePoints.push({ id: "bad", x: "invalid", y: 50 })],
  ["missing Jump", p => p.jumpNodes = []],
  ["duplicate gateway owner", p => { const c = structuredClone(p.multiCores[0]); c.id = "other"; p.multiCores.push(c); }],
  ["unresolved cable", p => p.connections[0].from.deviceId = "missing"],
  ["missing artwork", p => p.multiCores[0].ends.A.faces[0].image = "missing-phase8.png"]
].map(([name, mutate]) => ({ name, project() { const p = multiCoreJumpProject(); mutate(p); p.projectName = `Negative: ${name}`; return p; } }));
