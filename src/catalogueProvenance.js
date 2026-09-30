import { collectDefinitionDependencies, contentRevision, definitionContent } from './personalDefinitions.js';
import { factoryPromotionNodes, promotionFingerprint, freezePromotion } from './factoryPromotion.js';

export const LIBRARY_UPDATE_NOTICE = 'There is a new WireNexus device library update for this device';
export async function catalogueProvenance(catalogue) {
  const nodes = factoryPromotionNodes(catalogue), revisions = {};
  for (const device of catalogue.devices) {
    const dependencies = collectDefinitionDependencies(device, catalogue.devices, nodes);
    const members = [await promotionFingerprint(device, catalogue)];
    for (const value of [...dependencies.devices, ...dependencies.nodes].sort((a, b) => a.id.localeCompare(b.id))) members.push([value.id, await promotionFingerprint(value, catalogue)]);
    revisions[device.id] = { version: 1, catalogueId: device.id, revision: await contentRevision(definitionContent({ members })) };
  }
  return freezePromotion(revisions);
}
export function libraryUpdateFor(definition, revisions) {
  const previous = definition?.libraryProvenance;
  if (previous?.version !== 1 || !previous.revision || !previous.catalogueId) return null;
  const current = revisions[previous.catalogueId];
  return current && current.revision !== previous.revision ? { previous, current } : null;
}
