import { outputViewerScaleFixture } from "./output-viewer.mjs";

export function pdfJumpPaddedAcceptanceFixture() {
  const project = outputViewerScaleFixture({ deviceCount: 100 });
  project.projectName = "PDF Jump Padded XYZ Acceptance";
  const template = project.deviceLibrary[0];
  project.devices.forEach(device => { device.templateOverride = template; });
  project.jumpNodes = [];
  project.jumpLinks = [];
  for (const [index, sourceIndex, targetIndex] of [
    [1, 11, 88], [2, 24, 75], [3, 42, 67], [4, 56, 33], [5, 81, 18]
  ]) {
    const source = project.devices[sourceIndex], target = project.devices[targetIndex];
    source.name = `Patch ${index} Source`;
    target.name = `Patch ${index} Destination`;
    const a = `patch-${index}-a`, b = `patch-${index}-b`;
    project.jumpNodes.push(
      { id: a, label: `Patch ${index} A`, x: source.x + 340, y: source.y + 200 },
      { id: b, label: `Patch ${index} B`, x: target.x - 80, y: target.y + 200 }
    );
    project.jumpLinks.push({ id: `patch-${index}`, outputJumpId: a, inputJumpId: b });
    project.connections.push(
      { id: `patch-${index}-source-wire`, cableType: "sdi",
        from: { deviceId: source.instanceId, connectorId: "output-0" }, to: { jumpNodeId: a } },
      { id: `patch-${index}-target-wire`, cableType: "sdi",
        from: { jumpNodeId: b }, to: { deviceId: target.instanceId, connectorId: "input-0" } }
    );
  }
  return project;
}
