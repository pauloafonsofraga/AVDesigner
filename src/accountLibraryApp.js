import { createAccountLibraryStore, reviewBrowserImport, importBrowserLibrary } from './accountLibrary.js';

// The UI capability is display-only. Every storage operation reauthorizes at the
// RPC boundary using auth.uid(), including promotion receipt writes/removals.
export async function mountAccountLibrary({ container, recoveryStore, createOwner, onOwner, recoveryOwner,
  recoveryPreferences, onStatus = () => {}, configUrl = './account-config.json', createClient }) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'tool-button'; button.id = 'ownerAccount'; button.textContent = 'Owner Account';
  const dialog = document.createElement('dialog'); dialog.id = 'ownerAccountDialog';
  dialog.style.cssText = 'width:min(480px,calc(100vw - 32px));max-height:85vh;overflow:auto;background:var(--panel,#20272d);color:var(--text,#fff);border:1px solid var(--line,#566);border-radius:6px;padding:20px';
  const heading = document.createElement('h2'); heading.textContent = 'WireNexus Owner Account';
  const status = document.createElement('p'); status.id = 'accountSyncStatus'; status.setAttribute('role', 'status');
  const fields = document.createElement('div'), actions = document.createElement('div'), review = document.createElement('div');
  actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:12px';
  const email = document.createElement('input'); email.type = 'email'; email.id = 'ownerEmail'; email.placeholder = 'Owner email'; email.setAttribute('aria-label', 'Owner email'); email.autocomplete = 'email';
  const code = document.createElement('input'); code.id = 'ownerCode'; code.placeholder = 'Email code'; code.setAttribute('aria-label', 'Email code'); code.autocomplete = 'one-time-code'; code.inputMode = 'numeric';
  fields.append(email, code);
  let client, store, owner, configured = false, state = 'Browser recovery only - account service not configured', detail = '', epoch = 0, activeId = null, busy = false;
  const paint = () => {
    status.textContent = `${state}${detail ? ': ' + detail : ''}`;
    button.textContent = activeId ? 'Owner Account' : 'Owner Sign In';
    fields.hidden = !!activeId || !configured;
    send.hidden = verify.hidden = fields.hidden; signOut.hidden = !activeId; refresh.hidden = !activeId; recover.hidden = !activeId;
    for (const b of actions.querySelectorAll('button')) b.disabled = busy;
    onStatus(state, detail);
  };
  const setState = (value, message = '') => { state = value; detail = message; paint(); };
  const run = async fn => {
    if (busy) return; busy = true; paint();
    try { await fn(); } catch (error) { setState('Sync failed', error.message); }
    finally { busy = false; paint(); }
  };
  const action = (id, title, fn) => {
    const b = document.createElement('button'); b.id = id; b.type = 'button'; b.className = 'tool-button'; b.textContent = title;
    b.addEventListener('click', () => run(fn)); actions.append(b); return b;
  };
  const send = action('ownerSendCode', 'Send Sign-in Code', async () => {
    const { error } = await client.auth.signInWithOtp({ email: email.value.trim(), options: { shouldCreateUser: false } });
    if (error) throw error; setState('Pending sync', 'Check the owner email for the sign-in code.');
  });
  const verify = action('ownerVerifyCode', 'Sign In', async () => {
    const { data, error } = await client.auth.verifyOtp({ email: email.value.trim(), token: code.value.trim(), type: 'email' });
    if (error) throw error; code.value = ''; await activate(data.session);
  });
  const signOut = action('ownerSignOut', 'Sign Out', async () => {
    const { error } = await client.auth.signOut({ scope: 'local' }); if (error) throw error;
    await activate(null);
  });
  const refresh = action('ownerRefresh', 'Refresh Account', async () => {
    if (owner) await owner.refresh(); else { const { data } = await client.auth.getSession(); await activate(data.session); }
  });
  const recover = action('ownerImportBrowser', 'Import Browser Recovery', async () => {
    const source = await recoveryStore.read();
    source.registry.preferences ||= recoveryPreferences();
    const captureStore = store, captureOwner = owner, captureEpoch = epoch;
    const plan = await reviewBrowserImport(source, await store.read());
    review.replaceChildren();
    const summary = document.createElement('p'); summary.textContent = `${plan.additions.length} new, ${plan.duplicates.length} identical, ${plan.conflicts.length} conflicting definitions. Original browser recovery data will be retained.`;
    review.append(summary);
    const choices = [];
    for (const id of plan.conflicts) {
      const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox';
      label.append(check, ` Keep account version of ${id}; retain browser version in recovery`); label.style.display = 'block'; review.append(label); choices.push([id, check]);
    }
    const commit = document.createElement('button'); commit.id = 'confirmBrowserImport'; commit.className = 'tool-button'; commit.textContent = 'Confirm Import';
    commit.addEventListener('click', () => run(async () => {
      if (epoch !== captureEpoch || store !== captureStore) throw new Error('Account changed. Review the import again.');
      await importBrowserLibrary(captureStore, plan, { keepRemote: choices.filter(([, c]) => c.checked).map(([id]) => id) });
      await captureOwner.refresh(); review.replaceChildren(); setState('Synced', 'Browser import verified. Recovery copy retained.');
    })); review.append(commit);
  });
  const close = document.createElement('button'); close.type = 'button'; close.className = 'tool-button'; close.textContent = 'Close'; close.addEventListener('click', () => dialog.close());
  dialog.append(heading, status, fields, actions, review, close); document.body.append(dialog); container.append(button);
  button.addEventListener('click', () => dialog.showModal());
  async function activate(session) {
    const ticket = ++epoch;
    if (!session) {
      activeId = null; owner = null; store = null; review.replaceChildren();
      await onOwner(recoveryOwner, false); setState(configured ? 'Pending sync' : state, configured ? 'Sign in to save to your account. Browser recovery is retained.' : ''); return;
    }
    setState('Pending sync', 'Verifying owner and loading account library');
    const candidate = createAccountLibraryStore({ rpc: (...args) => client.rpc(...args), onState: (s, d) => { if (ticket === epoch) setState(s, d); } });
    try {
      const next = await createOwner(candidate);
      if (ticket !== epoch) return;
      store = candidate; owner = next; activeId = candidate.identity().accountId;
      await onOwner(next, true); setState('Synced');
    } catch (error) {
      if (ticket === epoch) {
        owner = null; store = null; activeId = session.user.id;
        await onOwner(recoveryOwner, false); setState('Sync failed', error.message);
      }
    }
  }
  paint();
  try {
    const response = await fetch(configUrl, { cache: 'no-store' });
    const config = response.ok ? await response.json() : { configured: false };
    configured = config.configured === true;
    if (configured) {
      const factory = createClient || (await import('./generated/accountAuth.js')).createClient;
      client = factory(config.url, config.publishableKey, { auth: { storageKey: 'wirenexus-owner-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
      const { data, error } = await client.auth.getSession(); if (error) throw error;
      await activate(data.session);
      client.auth.onAuthStateChange((event, session) => {
        // Never await authenticated requests while the SDK's session lock is held.
        if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && session?.user.id !== activeId)) setTimeout(() => activate(session).catch(error => setState('Sync failed', error.message)), 0);
      });
    } else setState(state, config.error || 'See docs/owner-account-setup.md. Browser data is not account-synced.');
  } catch (error) { setState('Sync failed', `Account setup unavailable: ${error.message}`); }
  return Object.freeze({ isAccount: () => !!owner, canSave: () => !configured || !!owner, status: () => state,
    async savePreferences(value) { if (!owner) throw new Error('Sign in to save account preferences.'); await owner.savePreferences(value); },
    preferences: () => owner?.preferences() || null });
}
