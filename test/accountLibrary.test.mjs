import test from 'node:test';
import assert from 'node:assert/strict';
import { accountDatabase, OWNER, STRANGER } from './fixtures/accountDatabase.mjs';
import { createAccountLibraryStore, reviewBrowserImport, importBrowserLibrary } from '../src/accountLibrary.js';
import { createPersonalDefinitions, contentRevision } from '../src/personalDefinitions.js';
import { accountConfiguration } from '../api/account-config.js';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
const definition = { id: 'personal', name: 'Saved device', width: 100, height: 200, faceImage: png,
  connectors: [{ id: 'out', type: 'custom', x: 100, y: 40 }] };
const node = { id: 'custom', label: 'Private node', thumbnail: png };
const owner = store => createPersonalDefinitions({ store, factory: [], nodes: [node], resolveImage: source => source }).initialize();

test('public config exposes only publishable keys, never privileged keys', () => {
  assert.deepEqual(accountConfiguration({}), { configured: false });
  assert.throws(() => accountConfiguration({ WIRENEXUS_SUPABASE_URL: 'https://project.supabase.co', WIRENEXUS_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_private' }));
  assert.equal(accountConfiguration({ WIRENEXUS_SUPABASE_URL: 'https://project.supabase.co', WIRENEXUS_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public' }).configured, true);
});
test('SQL owner authorization, durable artwork, CAS and explicit recovery import', async t => {
  const { db, rpc } = await accountDatabase(); t.after(() => db.close());
  await t.test('anonymous and other authenticated identities are rejected by SQL', async () => {
    for (const id of [null, STRANGER]) for (const operation of ['identity','read','upload','commit','asset']) {
      assert.ok((await rpc(id)('wirenexus_library', { operation, payload: { accountId: OWNER } })).error);
    }
    await db.transaction(async tx => {
      await tx.exec('set local role authenticated');
      await assert.rejects(tx.query('select * from wirenexus_private.library'), /permission denied/);
    }).catch(() => {});
  });
  const states = [], aStore = createAccountLibraryStore({ rpc: rpc(), onState: state => states.push(state) });
  const bStore = createAccountLibraryStore({ rpc: rpc() });
  const a = await owner(aStore), b = await owner(bStore);
  await t.test('independent clients retrieve complete definitions, dependency artwork and preferences', async () => {
    await a.save(definition);
    await a.savePreferences({ order: ['personal'], favorites: ['personal'] });
    await b.refresh();
    assert.deepEqual(b.entry('personal'), a.entry('personal'));
    assert.equal(b.entry('personal').definition.faceImage, png);
    assert.equal(b.nodes('personal')[0].thumbnail, png);
    assert.deepEqual(b.preferences(), a.preferences());
    assert.deepEqual(states.slice(-2), ['Saving','Synced']);
  });
  await t.test('stale updates/removals cannot overwrite or resurrect a removed default', async () => {
    const stale = b.entry('personal').revision;
    await a.save({ ...definition, name: 'New revision' }, { expectedRevision: stale });
    await assert.rejects(b.save(definition, { expectedRevision: stale }), /another tab/);
    await assert.rejects(b.remove('personal', stale), /another tab/);
    await a.remove('personal', a.entry('personal').revision);
    await assert.rejects(b.save(definition, { expectedRevision: stale }), /another tab/);
    assert.equal((await bStore.read()).registry.entries.personal, undefined);
  });
  await t.test('SQL rejects stale generation and missing artwork without activating definitions', async () => {
    const call = async (operation, payload) => rpc()('wirenexus_library', { operation, payload });
    const { data: current } = await call('read');
    const document = structuredClone(current); document.generation++;
    document.entries.bad = { revision:'new', definition:{id:'bad',faceImage:'wirenexus-artwork:'+'0'.repeat(64)},dependencies:{nodes:[],devices:[]} };
    assert.match((await call('commit', { document, expectedGeneration:current.generation, expectedRevisions:{bad:null} })).error.message, /artwork missing/);
    document.entries = {};
    assert.match((await call('commit',{document,expectedGeneration:-1,expectedRevisions:{}})).error.message,/another computer/);
    assert.deepEqual((await call('read')).data, current);
  });
  await t.test('upload failure keeps old active version and reports failure', async () => {
    const initial = await a.save(definition);
    const failStore = createAccountLibraryStore({ rpc: async (name, args) => args.operation === 'upload' ? {error:{message:'Upload unavailable'}} : rpc()(name,args), onState: s => states.push(s) });
    const failing = await owner(failStore);
    const bytes = new Uint8Array(await (await fetch(png)).arrayBuffer()); bytes[bytes.length - 1] ^= 1;
    const changed = { ...definition, faceImage:'data:image/png;base64,'+Buffer.from(bytes).toString('base64') };
    await assert.rejects(failing.save(changed,{expectedRevision:initial.revision}), /Upload unavailable/);
    assert.equal(states.at(-1),'Sync failed'); assert.deepEqual((await aStore.read()).registry.entries, (await bStore.read()).registry.entries);
    await a.refresh(); assert.equal(a.entry('personal').revision,initial.revision);
  });
  await t.test('interrupted import retains recovery, retries idempotently, surfaces conflicts and preserves receipts', async () => {
    const source = await aStore.read();
    source.registry.entries.copy = structuredClone(source.registry.entries.personal);
    source.registry.entries.copy.definition.id = 'copy'; source.registry.entries.copy.revision = 'copied';
    source.registry.entries.personal.definition.name = 'Conflicting browser version';
    source.registry.promotionReceipts = { receipt:{ id:'receipt', sourceId:'personal', personalRevision:'older',personalMatches:true } };
    const before = structuredClone(source), plan = await reviewBrowserImport(source,await bStore.read());
    assert.deepEqual(plan.conflicts,['personal']);
    await assert.rejects(importBrowserLibrary(bStore,plan),/Resolve every conflict/);
    const failing = createAccountLibraryStore({rpc:async (name,args) => args.operation === 'commit' ? {error:{message:'Commit interrupted'}} : rpc()(name,args)});
    await assert.rejects(importBrowserLibrary(failing,plan,{keepRemote:['personal']}),/interrupted/);
    assert.equal((await bStore.read()).registry.entries.copy,undefined);
    await importBrowserLibrary(bStore,plan,{keepRemote:['personal']});
    const committed = await bStore.read();
    await importBrowserLibrary(bStore,plan,{keepRemote:['personal']});
    assert.deepEqual(await bStore.read(),committed); assert.deepEqual(source,before);
    assert.equal(committed.registry.promotionReceipts.receipt.personalMatches,false);
    assert.equal(committed.registry.entries.copy.definition.faceImage,source.registry.entries.copy.definition.faceImage);
  });
  await t.test('promotion cleanup cannot remove edits committed from the other computer', async () => {
    await a.refresh(); const revision = a.entry('personal').revision;
    await a.recordPromotionReceipts([{id:'export',packageId:'package',sourceId:'personal',personalRevision:revision,personalMatches:true,status:'Awaiting deployment'}]);
    await b.refresh(); await b.save({...definition,name:'Edited on second computer'},{expectedRevision:revision});
    await a.reconcilePromotions([{id:'export',packageId:'package',cleanup:true,status:'Factory version active'}]);
    assert.equal(a.entry('personal').definition.name,'Edited on second computer');
    assert.match(a.promotionReceipts().find(r=>r.id==='export').status,/further personal changes/);
  });
  await t.test('server verifies artwork identity independently of client', async () => {
    const bytes = new Uint8Array(await (await fetch(png)).arrayBuffer());
    assert.ok((await rpc()('wirenexus_library',{operation:'upload',payload:{hash:'0'.repeat(64),base64:Buffer.from(bytes).toString('base64')}})).error);
    assert.equal((await rpc()('wirenexus_library',{operation:'upload',payload:{hash:await contentRevision(bytes),base64:Buffer.from(bytes).toString('base64')}})).error,null);
  });
});
