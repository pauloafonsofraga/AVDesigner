import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import "../src/companyLogoCore.js";
import {createProjectHandler} from '../api/project.js';
import {createPublishHandler} from '../api/publish.js';

const logos = globalThis.AVDesignerCompanyLogo;
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG3sAAAAASUVORK5CYII=";
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

test("company logo remembers image bytes and filename across reads, without a filesystem dependency", () => {
  const store = storage(), value = { source: png, name: "My Company.png" };
  assert.equal(logos.rememberCompanyLogo(value, store), true);
  assert.deepEqual(logos.readCompanyLogo(store), value);
  value.name = "changed";
  assert.equal(logos.readCompanyLogo(store).name, "My Company.png");
  assert.equal(logos.rememberCompanyLogo(null, store), true);
  assert.equal(logos.readCompanyLogo(store), null);
});

test("unavailable, full and malformed browser storage do not break title block editing", () => {
  const denied = { getItem() { throw Error("denied"); }, setItem() { throw Error("quota"); } };
  assert.equal(logos.readCompanyLogo(denied), null);
  assert.equal(logos.rememberCompanyLogo({ source: png, name: "Logo" }, denied), false);
  const store = storage();
  for (const value of ["{broken", "null", JSON.stringify({ source: "file:///logo.png" }), JSON.stringify({ source: "javascript:alert(1)" })]) {
    store.setItem(logos.STORAGE_KEY, value);
    assert.equal(logos.readCompanyLogo(store), null);
  }
});

test("project branding uses the first populated title block and matches Engine logo precedence", () => {
  const blocks = [{ fields: {} }, { logo: "a", companyLogo: "b", fields: { companyLogo: "c" } }, { fields: { companyLogo: "d" } }];
  const before = structuredClone(blocks);
  assert.equal(logos.projectCompanyLogo(blocks), "a");
  assert.equal(logos.titleBlockLogo({ companyLogo: "b", fields: { companyLogo: "c" } }), "b");
  assert.equal(logos.projectCompanyLogo([{ fields: { companyLogo: png } }]), png);
  assert.equal(logos.projectCompanyLogo([]), "");
  assert.deepEqual(blocks, before);
});

test("public branding accepts bounded inline PNGs only", () => {
  assert.equal(logos.publishedCompanyLogo(png), png);
  for (const source of [null, {}, "https://example.com/logo.png", "data:image/svg+xml,<svg onload='alert(1)'/>", "data:text/html,x", png + '" onerror="x', png + "a".repeat(logos.MAX_PUBLISHED_LOGO_LENGTH)]) {
    assert.equal(logos.publishedCompanyLogo(source), "");
  }
});

async function call(handler, request) {
  const response = { headers: {}, status(code) { this.code = code; return this; },
    setHeader(key, value) { this.headers[key] = value; }, end(value) { this.body = JSON.parse(value); } };
  await handler(request, response);
  return response;
}
function projectApi(companyLogo = png, overrides = {}) {
  const paths = [], metadata = { companyLogo, title: "Published title", projectName: "Test project", htmlPath: "private/viewer.html", projectPath: "private/project.json",
    password: { salt: "a".repeat(32), iterations: 120000, digest: "sha256", hash: crypto.pbkdf2Sync("secret", "a".repeat(32), 120000, 32, "sha256").toString("hex") }, ...overrides };
  const handler = createProjectHandler({security:()=>({throttle:async()=>{},call:async()=>null}),blobGet: async path => {
    paths.push(path);
    return { statusCode: 200, stream: new Response(path.endsWith("meta.json") ? JSON.stringify(metadata) : "<html>private viewer</html>").body };
  } });
  return { handler, paths };
}

test("public branding endpoint exposes project name and logo, never password, paths or private drawing", async () => {
  const { handler, paths } = projectApi();
  const response = await call(handler, { method: "GET", query: { id: "test-project" } });
  assert.equal(response.code, 200);
  assert.deepEqual(response.body, { projectName: "Test project", companyLogo: png });
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.deepEqual(paths, ["avdesigner/projects/test-project/meta.json"]);
});

test("public branding rejects invalid IDs before storage access and unsafe stored logo sources", async () => {
  const { handler, paths } = projectApi("https://private.example/logo.png");
  for (const id of ["../secret", "", "a/b", ["test-project", "other"]]) {
    assert.equal((await call(handler, { method: "GET", query: { id } })).code, 400);
  }
  assert.deepEqual(paths, []);
  assert.deepEqual((await call(handler, { method: "GET", query: { id: "test-project" } })).body, { projectName: "Test project", companyLogo: "" });
});

test("public project name uses saved metadata, bounds length and falls back without exposing other fields", async () => {
  for (const [overrides, expected] of [
    [{ projectName: "  Client <Event> & Show  " }, "Client <Event> & Show"],
    [{ projectName: "", title: "Publish title" }, "Publish title"],
    [{ projectName: null, title: null }, "Untitled WireNexus Project"],
    [{ projectName: { secret: "not text" }, title: "" }, "Untitled WireNexus Project"],
    [{ projectName: "X".repeat(200) }, "X".repeat(120)]
  ]) {
    const { handler, paths } = projectApi("", overrides);
    const response = await call(handler, { method: "GET", query: { id: "test-project" } });
    assert.deepEqual(response.body, { companyLogo: "", projectName: expected });
    assert.deepEqual(paths, ["avdesigner/projects/test-project/meta.json"]);
  }
});

test("private viewer remains password protected after public branding fetch", async () => {
  const { handler, paths } = projectApi();
  assert.equal((await call(handler, { method: "POST", body: { id: "test-project" } })).code, 400);
  assert.equal((await call(handler, { method: "POST", body: { id: "test-project", password: "wrong" } })).code, 401);
  assert.ok(!paths.includes("private/viewer.html"));
  const response = await call(handler, { method: "POST", body: { id: "test-project", password: "secret" } });
  assert.equal(response.code, 200);
  assert.equal(response.body.html, "<html>private viewer</html>");
  assert.equal(paths.at(-1), "private/viewer.html");
});

test("Publish stores branding beside protected metadata without changing viewer HTML", async () => {
  const commits = [], heads = [],reservation={id:'test-project',projectPath:'reserved/project.json',htmlPath:'reserved/viewer.html',projectBytes:12,htmlBytes:20};
  const handler = createPublishHandler({security:()=>({authenticate:async()=>'owner',call:async(op,payload)=>{
    if(op==='finalize')commits.push(payload.metadata);return reservation;
  }}),blobHead:async path=>{heads.push(path);return {pathname:path,size:path.endsWith('.json')?12:20,contentType:path.endsWith('.json')?'application/json':'text/html'};}});
  const body = { action:'finalize',id: "test-project", title: "Test", password: "secret", companyLogo: png };
  const response = await call(handler, { method: "POST", body });
  assert.equal(response.code, 200);
  assert.deepEqual(heads, [reservation.projectPath, reservation.htmlPath]);
  assert.equal(commits.length, 1);
  const metadata = commits[0];
  assert.equal(metadata.companyLogo, png);
  assert.equal(metadata.schema, 2);
  assert.notEqual(metadata.password.hash, body.password);
  assert.equal((await call(handler, { method: "POST", body: { ...body, companyLogo: "https://example.org/logo" } })).code, 400);
  assert.equal(commits.length, 1);
});
