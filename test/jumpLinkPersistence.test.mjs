import assert from "node:assert/strict";
import test from "node:test";
import { bidirectionalJumpFixture } from "../fixtures/bidirectional-jumps.mjs";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";

const link = { id: "new-pair", outputJumpId: "a", inputJumpId: "b" };

test("deleting a Jump Node keeps the production link array attached for later pairs", () => {
  const shell = bidirectionalJumpFixture();
  const savedLinks = shell.jumpLinks;
  const snapshot = { ...shell };
  const adapter = new ProjectMutationAdapter({ projectData: snapshot }, { cloneProjectData: false });
  assert.notEqual(adapter.root, shell, "the bridge writes through a separate snapshot wrapper");
  assert.equal(adapter.root.jumpLinks, savedLinks);

  adapter.removeJumpNode("neutral");
  assert.equal(adapter.root.jumpLinks, savedLinks, "removing an unpaired node must not detach the save array");
  const result = adapter.restoreJumpLink(link);
  assert.deepEqual(result.linkData, link);
  assert.deepEqual(shell.jumpLinks, [link], "the shell save path sees the newly paired nodes");

  const reloaded = new SceneGraph();
  reloaded.setData(normalizeAvDesignerProject(JSON.parse(JSON.stringify(shell))));
  assert.equal(reloaded.jumpLinkForNode("a")?.id, link.id);
  assert.equal(reloaded.jumpLinkForNode("b")?.id, link.id);
});

test("deleting a paired Jump Node removes its saved link without detaching the array", () => {
  const shell = bidirectionalJumpFixture();
  shell.jumpLinks = [{ ...link }];
  const savedLinks = shell.jumpLinks;
  const adapter = new ProjectMutationAdapter({ projectData: { ...shell } }, { cloneProjectData: false });
  adapter.removeJumpNode("a");
  assert.equal(adapter.root.jumpLinks, savedLinks);
  assert.deepEqual(shell.jumpLinks, []);
  assert.equal(adapter.jumpLinkById.size, 0);
  assert.equal(normalizeAvDesignerProject(JSON.parse(JSON.stringify(shell))).jumpLinks.length, 0);
});
