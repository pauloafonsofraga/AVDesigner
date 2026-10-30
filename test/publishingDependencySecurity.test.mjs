import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import http from 'node:http';
import {readFile} from 'node:fs/promises';

const require=createRequire(import.meta.url);
const fromBlob=createRequire(require.resolve('@vercel/blob'));

test('Blob stays on the existing pinned release and resolves patched Undici',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(manifest.dependencies['@vercel/blob'],'2.8.0');
  assert.equal(manifest.overrides['@vercel/blob'].undici,'6.29.1');
  assert.equal(fromBlob('undici/package.json').version,'6.29.1');
  const sdk=await import('@vercel/blob');assert.equal(typeof sdk.head,'function');assert.equal(typeof sdk.put,'function');
});

test('patched Undici preserves function-valued TLS validation through Agent factory dispatch',async t=>{
  const {Agent,Pool,request}=fromBlob('undici');let seen;
  const checkServerIdentity=()=>Error('test pinning rejection');
  const server=http.createServer((req,res)=>res.end('loopback'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const agent=new Agent({tls:{checkServerIdentity},factory:(origin,options)=>{seen=options;return new Pool(origin,options);}});
  t.after(()=>agent.close());
  const response=await request(`http://127.0.0.1:${server.address().port}`,{dispatcher:agent});
  assert.equal(await response.body.text(),'loopback');assert.equal(seen.tls.checkServerIdentity,checkServerIdentity);
});
