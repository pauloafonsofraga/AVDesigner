import { normalizeMultiCoreDefinition } from "./multiCoreModel.js";

// Authored identities/correspondence, not a position- or label-based mapper.
const channels = [
  ["c-a1", "01", "a-91", "b-41", "coax", "12G-SDI", "sdi", "bnc"],
  ["c-b7", "02", "a-92", "b-42", "coax", "12G-SDI", "sdi", "bnc"],
  ["c-c3", "03", "a-93", "b-43", "coax", "12G-SDI", "sdi", "bnc"],
  ["c-d9", "04", "a-94", "b-44", "coax", "12G-SDI", "sdi", "bnc"],
  ["c-e2", "05", "a-95", "b-45", "coax", "12G-SDI", "sdi", "bnc"],
  ["c-f8", "06", "a-96", "b-46", "coax", "12G-SDI", "sdi", "bnc"],
  ["c-g4", "07", "a-97", "b-47", "coax", "12G-SDI", "sdi", "bnc"],
  ["c-h6", "08", "a-98", "b-48", "coax", "12G-SDI", "sdi", "bnc"],
  ["c-j2", "09", "a-21", "b-71", "twisted-pair", "Cat6A", "cat6a", "rj45"],
  ["c-k8", "10", "a-22", "b-72", "twisted-pair", "Cat6A", "cat6a", "rj45"],
  ["c-m4", "11", "a-23", "b-73", "twisted-pair", "Cat6A", "cat6a", "rj45"],
  ["c-n6", "12", "a-24", "b-74", "twisted-pair", "Cat6A", "cat6a", "rj45"],
  ["c-p3", "13", "a-51", "b-81", "optical-fibre", "OM4", "fiber-lc", "lc-duplex"],
  ["c-q9", "14", "a-52", "b-82", "optical-fibre", "OM4", "fiber-lc", "lc-duplex"]
];

export function hybridMultiCoreDefinition() {
  const ends = {};
  for (const [role, style, name, id] of [["A", "rack-panel", "FOH Rack Panel", "def-end-a93"], ["B", "stage-box", "Stage Box", "def-end-b62"]]) {
    ends[role] = { id, style, name, manufacturer: "Example", model: "Hybrid termination", width: 240, height: 840,
      faces: [{ id: "front", name: "Front", width: 240, height: 840, image: "", portPlacements: [] },
        { id: "rear", name: "Rear", width: 240, height: 840, image: "", portPlacements: [] }],
      connectors: channels.map(([, number, a, b, family, spec, type, physicalType], index) => ({
        id: role === "A" ? a : b, label: number, type, connectorType: type, physicalType,
        gender: "female", mediaFamily: family, mediaSpec: spec, signalDirection: "bidirectional",
        displaySide: role === "A" ? "right" : "left", faceId: "front", x: role === "A" ? 240 : 0, y: 54 * (index + 1),
        pinout: null, polarity: "unknown", physicalNotes: "Mating and polarity must be verified separately."
      })) };
  }
  return normalizeMultiCoreDefinition({ schemaVersion: 1, kind: "multi-core", id: "mc-def-7e2", revision: "hybrid-14-r1",
    name: "Hybrid Multi-Core", brand: "Example", model: "Hybrid 14", category: "Multi-Cores", description: "8 SDI / 4 Cat6A / 2 OM4 duplex",
    libraryProvenance: { version: 1, catalogueId: "mc-def-7e2", revision: "hybrid-14-r1" },
    trunk: { length: 75, lengthUnit: "m", manufacturer: "Example", model: "Hybrid 14", jacket: "Touring jacket",
      routeStyle: "bezier", routePoints: [], physical: { assemblyType: "hybrid" } }, ends,
    circuits: channels.map(([id, displayNumber, endAPortId, endBPortId, mediaFamily, mediaSpec]) => ({
      id, displayNumber, endAPortId, endBPortId, mediaFamily, mediaSpec, administrativeState: "available",
      ...(mediaFamily === "coax" ? { physical: { impedanceOhms: 75, construction: "coax-core-and-shield" } } : {}),
      ...(mediaFamily === "twisted-pair" ? { physical: { pairCount: 4, construction: "twisted-pair" } } : {}),
      ...(mediaFamily === "optical-fibre" ? { physical: { topology: "duplex", fibreType: "multimode" },
        strands: [{ id: "strand-a", label: "A" }, { id: "strand-b", label: "B" }] } : {})
    })) }).value;
}
