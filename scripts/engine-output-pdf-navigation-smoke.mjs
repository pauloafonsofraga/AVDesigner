import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

// Run the PDF smoke and structural inspector first. This clicks the real PDFium
// plugin; it does not substitute SVG links or invoke the target navigation API.
const dir=resolve(process.argv[2]);
const verified=JSON.parse(readFileSync(join(dir,"verified-navigation.json"),"utf8"));
const { chromium }=createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser=await chromium.launch({headless:true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? {executablePath:process.env.AVDESIGNER_CHROME_PATH} : {})});
let clicks=0;
try {
  for(const name of ["jumps-wide","jumps-tall","jumps-cross-page"]) {
    const context=await browser.newContext({viewport:{width:1500,height:1000},offline:true});
    const page=await context.newPage();
    await page.goto(pathToFileURL(join(dir,`${name}.pdf`)).href);
    const viewer=await page.waitForEvent("frameattached",{predicate:f=>f.url().startsWith("chrome-extension://"),timeout:2000})
      .catch(()=>page.frames().find(f=>f.url().startsWith("chrome-extension://")));
    assert.ok(viewer,"Chrome PDF viewer required; no silent interaction skip");
    await viewer.waitForFunction(()=>document.querySelector("pdf-viewer")?.loadState_ === "success");
    const zoom=viewer.getByRole("textbox",{name:"Zoom level"});
    await zoom.fill("300%");await zoom.press("Enter");
    await viewer.waitForFunction(()=>document.querySelector("pdf-viewer").viewport.getZoom()===3);
    const {nodes,pageHeights}=verified[name];
    const screenPoint=async node=>viewer.evaluate(({node,height})=>{
      const v=document.querySelector("pdf-viewer"), vp=v.viewport;
      const main=v.shadowRoot.querySelector("#main").getBoundingClientRect();
      const page=vp.getPageScreenRect(node.page), scale=vp.getZoom()*96/72;
      return {x:main.x+page.x+(node.rect[0]+node.rect[2])/2*scale,
        y:main.y+page.y+(height-(node.rect[1]+node.rect[3])/2)*scale,
        visiblePage:vp.getMostVisiblePage(),zoom:vp.getZoom(),position:vp.position,
        main:{left:main.left,top:main.top,right:main.right,bottom:main.bottom}};
    },{node,height:pageHeights[node.page]});
    for(const id of ["strict-a","bidi-a"]) {
      const a=nodes.find(n=>n.source===id), b=nodes.find(n=>n.source===a.target);
      // Initial framing only. Both subsequent navigations must come from clicks.
      await viewer.evaluate(({node,height})=>{
        const vp=document.querySelector("pdf-viewer").viewport;
        vp.goToPageAndXy(node.page,(node.rect[0]+node.rect[2])/2*96/72-100,
          (height-(node.rect[1]+node.rect[3])/2)*96/72-100);
      },{node:a,height:pageHeights[a.page]});
      for(const [source,target]of [[a,b],[b,a]]) {
        const before=await screenPoint(source);
        await page.screenshot({path:join(dir,`${name}-${source.source}-before.png`)});
        assert.ok(before.x>before.main.left && before.x<before.main.right && before.y>before.main.top && before.y<before.main.bottom,
          `${name}/${source.source}: source must be onscreen ${JSON.stringify(before)}`);
        await page.mouse.click(before.x,before.y);
        await viewer.waitForFunction(position=>{
          const p=document.querySelector("pdf-viewer").viewport.position;
          return Math.abs(p.x-position.x)+Math.abs(p.y-position.y)>50;
        },before.position);
        const after=await screenPoint(target);
        assert.equal(after.zoom,3,"PDF link preserves zoom");
        // A destination near a page bottom can leave more of the following page
        // onscreen. Check the actual target on its page, not "most visible page".
        assert.ok(after.x>=after.main.left && after.x<after.main.right && after.y>=after.main.top && after.y<after.main.bottom,
          `${name}/${target.source}: paired node must be visible ${JSON.stringify(after)}`);
        assert.equal(context.pages().length,1,"internal navigation must not open a browser URL");
        clicks++;
        await page.screenshot({path:join(dir,`${name}-${source.source}-to-${target.source}.png`)});
      }
    }
    await context.close();
    console.log(`PASS ${name}: strict and bidirectional A -> B -> A at 300%, offline`);
  }
  console.log(JSON.stringify({passed:clicks,failed:0,skipped:0}));
} finally {await browser.close();}
