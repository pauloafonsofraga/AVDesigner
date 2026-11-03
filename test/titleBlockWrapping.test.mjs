import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { drawDeviceVisual } from "../src/engine/deviceVisualBuilder.js";
import { OutputSvgContext } from "../src/engine/outputSvgContext.js";
import { TITLE_BLOCK_BASE_HEIGHT, TITLE_BLOCK_BASE_WIDTH, titleBlockLayout } from "../src/engine/titleBlockLayout.js";

test("new title blocks have an empty Title without replacing authored or explicitly empty titles", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const start = html.indexOf("    function defaultTitleBlockData() {"), end = html.indexOf("    function openTitleBlockEditor(", start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({ nextId: () => "title-test", TITLE_BLOCK_WIDTH: 500, TITLE_BLOCK_HEIGHT: 300, titleBlockDraft: null });
  vm.runInContext(html.slice(start, end), context);
  assert.equal(vm.runInContext("defaultTitleBlockData().title", context), "");
  assert.equal(vm.runInContext("createTitleBlockFromDraft(0, 0).fields.title", context), "");
  for (const title of ["Authored title", "Video Wirechart", ""]) {
    context.titleBlockDraft = { title };
    const saved = JSON.parse(JSON.stringify(vm.runInContext("createTitleBlockFromDraft(0, 0)", context)));
    assert.equal(saved.fields.title, title);
  }
});

function drawFields(fields) {
  const ctx = new OutputSvgContext();
  const drawn = [];
  const fillText = ctx.fillText.bind(ctx);
  ctx.fillText = (text, x, y) => {
    drawn.push({ text, x, y, font: ctx.font, width: ctx.measureText(text).width });
    fillText(text, x, y);
  };
  drawDeviceVisual(ctx, { kind: "title-block", visual: { fields } }, TITLE_BLOCK_BASE_WIDTH, TITLE_BLOCK_BASE_HEIGHT);
  return { drawn, svg: ctx.elements.join("") };
}

test("title-block values wrap inside every field without crossing cell borders", () => {
  const fields = {
    client: "A very long client name with multiple departments and offices",
    revision: "Revision 1234567890 for the final construction release",
    project: "A Long Project Name Across Several Rooms",
    location: "Convention Centre Exhibition Hall Number Twelve",
    title: "Main Signal Distribution and Cable Schedule",
    jobId: "UNBROKENIDENTIFIERTHATNEEDSTOBESPLITACROSSLINES1234567890",
    eventDate: "September 30, 2026 through October 30, 2026 at the convention centre",
    drawingDate: "October 30, 2026 through November 30, 2026 at the convention centre",
    accountManager: "Alexandra Longlastname, Senior Manager",
    approvedBy: "Christopher Otherlonglastname, Director"
  };
  const { drawn, svg } = drawFields(fields);
  for (const [key, rect] of Object.entries(titleBlockLayout().fields)) {
    const valueX = rect.x + 62;
    const lines = drawn.filter(entry => entry.x === valueX && entry.y > rect.y && entry.y < rect.y + rect.height);
    assert.ok(lines.length >= 2, `${key} wraps onto multiple lines`);
    assert.ok(lines.length <= Math.floor((rect.height - 10) / 9), `${key} respects cell height`);
    for (const line of lines) {
      assert.ok(line.x + line.width <= rect.x + rect.width - 8 + 0.001, `${key} stays before right border`);
      assert.ok(line.y - 4.5 >= rect.y && line.y + 4.5 <= rect.y + rect.height, `${key} stays within row`);
    }
  }
  assert.match(svg, /<text/);
  assert.ok(drawn.some(entry => entry.text.includes("…")), "unavoidably long values are visibly truncated");
});

test("short title-block values stay on one line and repeated rendering is deterministic", () => {
  const fields = { client: "Acme", title: "Wirechart", eventDate: "2026-09-30" };
  const before = structuredClone(fields);
  const first = drawFields(fields);
  const second = drawFields(fields);
  assert.equal(first.svg, second.svg);
  assert.deepEqual(fields, before);
  assert.equal(first.drawn.filter(entry => entry.text === "Acme").length, 1);
  assert.equal(first.drawn.filter(entry => entry.text === "Wirechart").length, 1);
  assert.equal(first.drawn.filter(entry => entry.text === "2026-09-30").length, 1);
});
