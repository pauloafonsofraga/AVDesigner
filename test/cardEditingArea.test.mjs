import test from 'node:test';
import assert from 'node:assert/strict';
import {cardEditingBounds, resizeCardEditingBounds} from '../src/engine/cardEditingArea.js';
import {cardBandGeometryForSlot, resolveInstalledCardConnectors, cardFitsPhysicalSlot} from '../src/engine/modularDeviceLayout.js';
import {cardSafetyFixture} from './helpers/cardSafetyFixture.mjs';
import {assertSafeModularCardChanges} from '../src/engine/modularCardSafety.js';
import {buildEngineOutputScene} from '../src/engine/outputSceneSnapshot.js';
import {renderEngineOutputSvg} from '../src/engine/outputSvgRenderer.js';
import {engineConnectorInfoFields} from '../src/engine/connectorCompatibility.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const fallback = {x: 10, y: 27, width: 174, height: 216};
for (const handle of ['e', 's', 'se']) test(`empty card ${handle} resize is finite and independently clamped`, () => {
  const start = cardEditingBounds({}, fallback);
  const enlarged = resizeCardEditingBounds(start, {x: 70, y: 40}, handle);
  assert.equal(enlarged.width, handle.includes('e') ? 244 : 174);
  assert.equal(enlarged.height, handle.includes('s') ? 256 : 216);
  const small = resizeCardEditingBounds(start, {x: -9999, y: -9999}, handle);
  assert.ok(small.width >= 96 && small.height >= 108);
  assert.throws(() => resizeCardEditingBounds(start, {x: NaN, y: 0}), /finite/);
});
for (const count of [1, 20, 100]) test(`${count} measured node/label bounds fit without moving anchors`, () => {
  const boxes = Array.from({length: count}, (_, i) => ({x: i % 2 ? -40 : 160, y: 100 + i * 54, width: i % 2 ? 150 : 32, height: 38}));
  const before = structuredClone(boxes);
  const start = cardEditingBounds({}, fallback, boxes);
  const smallest = resizeCardEditingBounds(start, {x: -99999, y: -99999});
  for (const b of boxes) {
    assert.ok(smallest.x <= b.x - 12 && smallest.y <= b.y - 12);
    assert.ok(smallest.x + smallest.width >= b.x + b.width + 12);
    assert.ok(smallest.y + smallest.height >= b.y + b.height + 12);
  }
  assert.deepEqual(boxes, before);
  assert.deepEqual(cardEditingBounds({editingBounds: smallest}, fallback, boxes), {...smallest, minimumWidth: smallest.width, minimumHeight: smallest.height});
});
test('historical geometry is not mutated; invalid saved bounds fall back safely', () => {
  for (const editingBounds of [undefined, {width: -1}, {x: 0, y: 0, width: Infinity, height: 2}]) {
    const card = {editingBounds, connectors: []}, copy = structuredClone(card);
    const bounds = cardEditingBounds(card, fallback);
    assert.equal(bounds.width, 174); assert.deepEqual(card, copy);
  }
});
test('authoring resize cannot resize a physical slot or alter installed connectors and cables', () => {
  const before = cardSafetyFixture(), after = structuredClone(before);
  const template = after.deviceLibrary[0], card = template.cardTypes[0], slot = template.cardSlots[0];
  const geometry = cardBandGeometryForSlot(slot, card);
  const ports = resolveInstalledCardConnectors({...template}).connectors;
  card.editingBounds = {x: -100, y: 0, width: 1000, height: 2000};
  assert.deepEqual(cardBandGeometryForSlot(slot, card), geometry);
  assert.deepEqual(resolveInstalledCardConnectors({...template}).connectors, ports);
  assert.deepEqual(after.connections, before.connections);
  assert.deepEqual(template.cardSlots, before.deviceLibrary[0].cardSlots);
  assert.doesNotThrow(() => assertSafeModularCardChanges(before, after));
  assert.deepEqual(buildEngineOutputScene(after), buildEngineOutputScene(before));
  assert.deepEqual(JSON.parse(JSON.stringify(after)).deviceLibrary[0].cardTypes[0].editingBounds, card.editingBounds);
  assert.equal(cardFitsPhysicalSlot({physicalLayout:{sideMask:'left', span:2}}, card), false);
});
test('authored names and aliases remain separate from capabilities through installed vector output', () => {
  const data = cardSafetyFixture('sdi', false), connector = data.deviceLibrary[0].cardTypes[0].connectors[0];
  connector.nameText = 'SDI OUT 1'; connector.customText = 'Local alias';
  const svg = renderEngineOutputSvg(buildEngineOutputScene(data)).svg;
  assert.ok(svg.includes('SDI OUT 1')); assert.ok(svg.includes('Local alias'));
  assert.equal(connector.type, 'sdi'); assert.equal(connector.id, 'p1');
});

test('the actual shared editor field resolver matches Engine naming for special and historical nodes', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const extract = name => html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, 'm'))[0];
  const context = vm.createContext({
    usesResolutionField: c => engineConnectorInfoFields(c).some(f => f.field === 'resolutionFrameRate'),
    isPairedNetworkConnector: () => false, isEditorNetworkStyleV2Connector: c => /rj45/.test(c.type)
  });
  vm.runInContext(extract('connectorFieldTitle') + '\n' + extract('connectorInfoFields'), context);
  for (const type of ['hdmi','sdi','display-port','1g-rj45','fiber-lc','sfp-plus-cage','xlr','iec','misc']) {
    for (const fields of [{}, {nameText:'SDI OUT 1',customText:'Alias'}, {nameText:'Long authored name '.repeat(10),nameTextCaption:'Port'},
      {label:'Historic label',alias:'Unrecognized old alias'}, {installedModuleType:'sfp-sdi-12g-rx', nameText:'Cage'}]) {
      const node = {type, ...fields}, before = structuredClone(node);
      const actual = JSON.parse(JSON.stringify(context.connectorInfoFields(node)));
      const expected = engineConnectorInfoFields(node).map(({field,title,text}) => ({field,title,text}));
      assert.deepEqual(actual, expected); assert.deepEqual(node, before);
    }
  }
});
