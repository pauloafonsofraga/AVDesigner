import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync} from 'node:fs';
import {cableTypeSelectionFixture} from '../fixtures/cable-type-selection.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const base=process.env.AVDESIGNER_BASE_URL||'http://127.0.0.1:8790';
const dir=process.env.AVDESIGNER_SCREENSHOT_DIR||'/tmp/wirenexus-toolbar-icons';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],checks=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{window.showSaveFilePicker=undefined;window.showOpenFilePicker=undefined;});
  await page.goto(base);await page.waitForFunction(()=>activeEngineBridge()?.ready&&localUserSettingsLoaded);
  const click=async id=>{const button=page.locator('#'+id);await button.scrollIntoViewIfNeeded();await button.locator('svg').click();};
  const quiet=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  for(const width of [1366,1440,1920,2560]){
    await page.setViewportSize({width,height:1080});await quiet();
    const result=await page.evaluate(()=>{
      const toolbar=document.querySelector('.topbar .toolbar'),r=toolbar.getBoundingClientRect();
      return {wrap:getComputedStyle(toolbar).flexWrap,overflow:getComputedStyle(toolbar).overflowX,width:r.width,content:toolbar.scrollWidth,
        controls:toolbar.querySelectorAll('button,select').length,icons:[...toolbar.querySelectorAll('svg.toolbar-icon')].map(svg=>{
          const s=svg.getBoundingClientRect(),b=svg.closest('button').getBoundingClientRect();
          return {w:s.width,h:s.height,left:s.left-b.left,right:b.right-s.right,top:s.top-b.top,bottom:b.bottom-s.bottom,y:b.y};
        })};
    });
    assert.equal(result.controls,31);assert.equal(result.icons.length,29);assert.equal(result.wrap,'nowrap');assert.equal(result.overflow,'auto');
    result.icons.forEach(i=>{assert.equal(i.w,22);assert.equal(i.h,22);assert.ok(Math.min(i.left,i.right)>=6);assert.ok(Math.min(i.top,i.bottom)>=5);assert.equal(i.y,result.icons[0].y);});
    if(width<=1440)assert.ok(result.content>result.width);else assert.ok(result.content<=result.width+1,JSON.stringify({viewport:width,...result}));
    await page.locator('#exportPdf').scrollIntoViewIfNeeded();assert.ok(await page.locator('#exportPdf').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}));
    await page.evaluate(()=>document.querySelector('.topbar .toolbar').scrollLeft=0);
    await page.screenshot({path:`${dir}/toolbar-${width}.png`});
  }
  checks.push('31 controls; 29 fixed 22px glyphs; padding, alignment and horizontal scrolling at four desktop widths');
  await page.setViewportSize({width:1920,height:1080});
  const zoom=await page.evaluate(()=>activeEngineBridge().getZoom());await click('zoomIn');assert.ok(await page.evaluate(()=>activeEngineBridge().getZoom())>zoom);await click('zoomOut');
  await click('zoomFit');
  for(const [id,key] of [['darkModeToggle','darkMode'],['gridToggle','gridVisible'],['objectSnappingToggle','objectSnapping'],['cableHopsToggle','cableHops']]){
    const before=await page.evaluate(key=>state[key],key);await click(id);assert.equal(await page.evaluate(key=>state[key],key),!before);await click(id);
  }
  assert.equal(await page.locator('#objectSnappingToggle').evaluate(e=>getComputedStyle(e).color),'rgb(50, 182, 255)');
  await click('wireModeToggle');assert.equal(await page.locator('#wireModeToggle svg').getAttribute('data-toolbar-icon'),'orthogonal');await click('wireModeToggle');
  await page.locator('#wirePlacementSelect').selectOption('manual');assert.equal(await page.evaluate(()=>state.wirePlacement),'manual');await page.locator('#wirePlacementSelect').selectOption('auto');
  const voltage=await page.locator('#voltageToggle span').textContent();await page.locator('#voltageToggle').click();assert.notEqual(await page.locator('#voltageToggle span').textContent(),voltage);await page.locator('#voltageToggle').click();
  for(let i=0;i<2;i++){await click('createCableLoom');assert.equal(await page.locator('#createCableLoom').getAttribute('aria-pressed'),'true');await page.keyboard.press('Escape');}
  for(const id of ['commentTool','areaTool','jumpNodeTool']){await click(id);assert.ok(await page.locator('#'+id).evaluate(e=>e.classList.contains('active')));await page.keyboard.press('Escape');}
  await click('createMultiCore');await page.locator('dialog.multi-core-picker').waitFor({state:'visible'});await page.keyboard.press('Escape');
  checks.push('zoom, theme/grid/snap/hops, both routing modes, Auto/Manual, voltage and insertion tools preserve their handlers and states');
  for(const [button,modal,close] of [['deviceEditorButton','deviceEditorModal','closeDeviceEditor'],['nodeBuilderButton','nodeBuilderModal','closeNodeBuilder'],['rackBuilderButton','rackBuilderModal','closeRackBuilder'],['publishProjectButton','publishProjectModal','closePublishProject']]){
    await click(button);await page.locator('#'+modal).waitFor({state:'visible'});await page.locator('#'+close).click();await page.locator('#'+modal).waitFor({state:'hidden'});
  }
  const chooser=page.waitForEvent('filechooser');await click('importLedGrid');await(await chooser).setFiles([]);
  await page.evaluate(data=>{restoreSnapshot(data);const b=activeEngineBridge();b.scene.selectMany(['source']);b.updateSelectionHud();document.activeElement?.blur();},cableTypeSelectionFixture());
  const x=await page.evaluate(()=>activeEngineBridge().scene.getDevice('source').x);await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(()=>activeEngineBridge().scene.getDevice('source').x),x+1);
  await click('undoAction');assert.equal(await page.evaluate(()=>activeEngineBridge().scene.getDevice('source').x),x);
  await click('redoAction');assert.equal(await page.evaluate(()=>activeEngineBridge().scene.getDevice('source').x),x+1);
  await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press('Control+z');assert.equal(await page.evaluate(()=>activeEngineBridge().scene.getDevice('source').x),x);
  await click('titleBlockButton');await page.locator('#titleBlockModal').waitFor({state:'visible'});await page.locator('#closeTitleBlockEditor').click();
  for(const id of ['saveProject','saveProjectAs','exportHtml']){
    const download=page.waitForEvent('download');await click(id);await(await download).saveAs(`${dir}/${id}${id==='exportHtml'?'.html':'.avd'}`);
  }
  const popup=page.waitForEvent('popup');await click('projectReportButton');const report=await popup;await report.waitForLoadState();await report.close();
  await click('cableScheduleButton');await page.locator('#cableScheduleDialog').waitFor({state:'visible'});await page.locator('#closeCableSchedule').click();
  await click('exportPdf');const pdf=page.waitForEvent('download');await page.locator('#confirmPdfExport').click();await(await pdf).saveAs(`${dir}/toolbar.pdf`);
  await click('newProject');assert.equal(await page.evaluate(()=>state.devices.length),0);
  const load=page.waitForEvent('filechooser');await click('loadProject');await(await load).setFiles(`${dir}/saveProjectAs.avd`);await page.waitForFunction(()=>state.devices.length===2);
  checks.push('editors, LED file picker, publish dialog (no publish), title block, Undo/Redo and keyboard Undo, New/Load/Save/Save As, HTML, report, schedule and PDF');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',checks,errors},null,2));
}finally{await browser.close();}
