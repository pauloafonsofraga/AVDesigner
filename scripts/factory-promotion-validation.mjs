import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FACTORY_AUTHORING } from "../src/buildCapabilities.js";
import { imageDataUrl } from "../src/imageAssets.js";
import { freezeFactoryCatalogue } from "../src/factoryCatalogue.js";
import { reviewFactoryPromotion, createPromotionPackage, validatePromotionPackage, factoryPromotionNodes } from "../src/factoryPromotion.js";

assert.equal(FACTORY_AUTHORING, false, "Public capability must be disabled in the repository");
const catalogue = freezeFactoryCatalogue(JSON.parse(await readFile(new URL("../data/factory-catalogue.json", import.meta.url), "utf8")));
const before = JSON.stringify(catalogue), definition = structuredClone(catalogue.devices.find(d => d.id === "barco-e2-gen2"));
definition.description += " (promotion validation fixture)";
const review = await reviewFactoryPromotion({ definition, library: catalogue.devices, nodes: factoryPromotionNodes(catalogue), catalogue,
  resolveImage: async path => imageDataUrl(await readFile(new URL(`../${path}`, import.meta.url))) });
const first = await createPromotionPackage([review]), second = await createPromotionPackage([review]);
assert.deepEqual(first, second);
const { actions } = await validatePromotionPackage(first, catalogue);
assert.deepEqual(actions.filter(a => a.action !== "unchanged"), [{ kind: "device", id: definition.id, action: "update" }]);
assert.equal(JSON.stringify(catalogue), before);
for (const file of ["factoryPromotion.js", "factoryAuthoringApp.js"]) {
  const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
  assert.doesNotMatch(source, /api\.github|github_pat|\/api\/.*promot|git push|ProductionBridge/);
}
console.log(`Factory promotion PASS: public gate disabled; deterministic immutable E2 review; ${actions.length} validated definitions; no catalogue writes`);
