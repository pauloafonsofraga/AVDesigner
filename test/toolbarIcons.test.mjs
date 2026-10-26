import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DOMImplementation} from '@xmldom/xmldom';
const source=readFileSync(new URL('../src/toolbarIcons.js',import.meta.url),'utf8');
const context={window:{},document:{getElementById:()=>null}};
vm.runInNewContext(source,context);
const api=context.window.WireNexusToolbarIcons;
const document=new DOMImplementation().createDocument(null,null);

test('toolbar icons cover every icon action, leaving voltage and placement as explicit values',()=>{
  assert.equal(Object.keys(api.buttons).length,29);
  assert.equal(api.buttons.deviceEditorButton,'chassis');
  assert.equal(api.buttons.createCableLoom,'loom');assert.equal(api.buttons.createMultiCore,'multi-core');
  assert.equal(api.buttons.jumpNodeTool,'jump');
  assert.ok(!api.buttons.voltageToggle&&!api.buttons.wirePlacementSelect);
});
test('all standard and custom icons share one 22px, currentColor, rounded-stroke system',()=>{
  for(const name of new Set([...Object.values(api.buttons),'sun','hops-off','orthogonal'])){
    const icon=api.create(document,name);
    for(const [key,value] of Object.entries({width:'22',height:'22',viewBox:'0 0 24 24',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))assert.equal(icon.getAttribute(key),value,name);
    assert.ok(icon.childNodes.length);assert.equal(icon.getElementsByTagName('image').length,0);
    assert.equal(icon.getElementsByTagName('script').length,0);
  }
});
test('state swaps are local, idempotent, and do not replace the button or its label',()=>{
  let icon=api.create(document,'moon'),replacements=0;
  const button={ownerDocument:document,querySelector:()=>icon};
  const attach=()=>{icon.replaceWith=next=>{icon=next;replacements++;attach();};};attach();
  assert.equal(api.set(button,'icons/darkmode.png'),true);assert.equal(replacements,0);
  assert.equal(api.set(button,'icons/lightmode.png'),true);assert.equal(icon.getAttribute('data-toolbar-icon'),'sun');
  assert.equal(api.set(button,'icons/wires_90degree.png'),true);assert.equal(icon.getAttribute('data-toolbar-icon'),'orthogonal');
  assert.equal(api.set(button,'icons/cable_hop_off.png'),true);assert.equal(icon.getAttribute('data-toolbar-icon'),'hops-off');
  assert.equal(api.set(button,'icons/220.png'),false);assert.equal(replacements,3);
  assert.throws(()=>api.create(document,'missing'),/Unknown toolbar icon/);
});
test('toolbar controls retain their original order and the original SVG-independent action wiring',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const toolbar=html.slice(html.indexOf('<div class="toolbar" aria-label="Project actions">'),html.indexOf('</header>'));
  const ids=[...toolbar.matchAll(/<(?:button|select)[^>]*\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(ids,['zoomOut','zoomIn','zoomFit','undoAction','redoAction','darkModeToggle','gridToggle','objectSnappingToggle','wireModeToggle','wirePlacementSelect','createCableLoom','createMultiCore','cableHopsToggle','voltageToggle','deviceEditorButton','nodeBuilderButton','rackBuilderButton','importLedGrid','commentTool','areaTool','jumpNodeTool','titleBlockButton','newProject','loadProject','saveProject','saveProjectAs','exportHtml','publishProjectButton','projectReportButton','cableScheduleButton','exportPdf']);
  assert.match(source,/old\.replaceWith\(svg\)/);
  assert.doesNotMatch(source,/addEventListener|preventDefault|keydown|fetch\(/);
});
