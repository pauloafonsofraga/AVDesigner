import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.saveProbe={pickers:0,writes:[],cancel:true};
    window.showSaveFilePicker=async()=>{
      saveProbe.pickers++;
      if(saveProbe.cancel)throw new DOMException('Canceled','AbortError');
      return {name:'shortcut.avd',queryPermission:async()=>'granted',
        createWritable:async()=>({write:async blob=>saveProbe.writes.push(JSON.parse(await blob.text())),close:async()=>{}})};
    };
  });
  await page.goto(process.env.AVDESIGNER_BASE_URL || 'http://127.0.0.1:8790');
  await page.waitForFunction(()=>activeEngineBridge()?.ready && localUserSettingsLoaded);
  const name=page.getByRole('textbox',{name:'Project name',exact:true});
  await name.fill('Shortcut Save');
  await page.keyboard.press('Meta+s');
  await page.waitForFunction(()=>saveProbe.pickers===1 && !projectShortcutSavePending);
  assert.equal(await page.evaluate(()=>saveProbe.writes.length),0);
  await page.evaluate(()=>{saveProbe.cancel=false;});
  await page.keyboard.press('Meta+s');
  await page.waitForFunction(()=>saveProbe.writes.length===1 && !projectShortcutSavePending);
  assert.equal(await page.evaluate(()=>saveProbe.writes[0].projectName),'Shortcut Save');
  await name.fill('Control Save');await page.keyboard.press('Control+s');
  await page.waitForFunction(()=>saveProbe.writes.length===2 && !projectShortcutSavePending);
  assert.equal(await page.evaluate(()=>saveProbe.writes[1].projectName),'Control Save');
  assert.equal(await page.evaluate(()=>saveProbe.pickers),2,'subsequent saves reuse the project file');
  assert.equal(await page.evaluate(()=>projectUnsavedChanges.isDirty()),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: Cmd+S, Ctrl+S, focused text field, canceled picker retry, existing-file overwrite and saved-state checkpoint');
} finally {
  await browser.close();
}
