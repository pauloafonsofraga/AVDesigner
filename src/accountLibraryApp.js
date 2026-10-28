import { createAccountLibraryStore, reviewBrowserImport, importBrowserLibrary } from './accountLibrary.js';
import {mountPlansPanel} from './plansUi.js';
import {mountOrganizationsPanel} from './organizationsUi.js';

// The UI capability is display-only. Every storage operation reauthorizes at the
// RPC boundary using auth.uid(), including promotion receipt writes/removals.
export async function mountAccountLibrary({ container, recoveryStore, createOwner, onOwner, recoveryOwner,
  recoveryPreferences, onStatus = () => {}, configUrl = './account-config.json', createClient }) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'tool-button'; button.id = 'ownerAccount'; button.textContent = 'Account';
  const dialog = document.createElement('dialog'); dialog.id = 'ownerAccountDialog';
  const style=document.createElement('style');style.textContent='#ownerAccountDialog [hidden]{display:none!important} #ownerAccountDialog input{width:100%;min-width:0} #ownerAccountDialog ul{padding-left:20px;overflow-wrap:anywhere}';dialog.append(style);
  dialog.style.cssText = 'width:min(480px,calc(100vw - 32px));max-height:85vh;overflow:auto;background:var(--panel,#20272d);color:var(--text,#fff);border:1px solid var(--line,#566);border-radius:6px;padding:20px';
  const heading = document.createElement('h2'); heading.textContent = 'WireNexus Account';
  const status = document.createElement('p'); status.id = 'accountSyncStatus'; status.setAttribute('role', 'status');
  const fields = document.createElement('div'), actions = document.createElement('div'), review = document.createElement('div');
  actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:12px';
  fields.style.cssText='display:grid;gap:8px';
  const email = document.createElement('input'); email.type = 'email'; email.id = 'ownerEmail'; email.placeholder = 'Email'; email.setAttribute('aria-label', 'Email'); email.autocomplete = 'email';
  const code = document.createElement('input'); code.id = 'ownerCode'; code.placeholder = 'Email code'; code.setAttribute('aria-label', 'Email code'); code.autocomplete = 'one-time-code'; code.inputMode = 'numeric';
  const password=document.createElement('input');password.type='password';password.autocomplete='current-password';password.placeholder='Password';password.setAttribute('aria-label','Password');
  const confirmPassword=document.createElement('input');confirmPassword.type='password';confirmPassword.autocomplete='new-password';confirmPassword.placeholder='Confirm new password';confirmPassword.setAttribute('aria-label','Confirm new password');
  fields.append(email, code, password, confirmPassword);
  const workspaces=document.createElement('ul');workspaces.setAttribute('aria-label','Your workspaces');
  const privileges=document.createElement('p');privileges.setAttribute('role','status');
  const mfa=document.createElement('div'),qr=document.createElement('img'),secret=document.createElement('p'),mfaCode=document.createElement('input');
  qr.alt='Authenticator setup QR code';qr.style.cssText='width:180px;height:180px;background:white';qr.hidden=true;
  mfaCode.inputMode='numeric';mfaCode.autocomplete='one-time-code';mfaCode.placeholder='Authenticator code';mfaCode.setAttribute('aria-label','Authenticator code');
  mfa.append(qr,secret,mfaCode);mfa.hidden=true;
  let client, store, owner, identity=null, configured = false, registrationEnabled=false,
    recoveryRequested=false,passwordRecovery=false,factorId='',pendingFactor='',
    state = 'Browser recovery only - account service not configured', detail = '', epoch = 0, activeId = null, busy = false, selectedWorkspaceId=null;
  const clearSecrets=()=>{password.value=confirmPassword.value=code.value=mfaCode.value='';qr.hidden=true;qr.removeAttribute('src');secret.textContent='';factorId='';};
  const platformAdmin=()=>identity?.admin===true && identity?.entitlements?.fullProductAccess===true && identity?.mfaRequired===false;
  const paint = () => {
    status.textContent = `${state}${detail ? ': ' + detail : ''}`;
    button.textContent = activeId ? 'Account' : 'Account Sign In';
    fields.hidden = (!!activeId && !passwordRecovery) || !configured;
    email.disabled=!!activeId;code.hidden=!!activeId;
    confirmPassword.hidden=!passwordRecovery && (!registrationEnabled || recoveryRequested);
    send.hidden = verify.hidden = fields.hidden || recoveryRequested;
    passwordSignIn.hidden=fields.hidden || recoveryRequested;
    register.hidden=fields.hidden || !registrationEnabled || recoveryRequested;
    recoverAccount.hidden=!!activeId || !configured;verifyRecovery.hidden=!recoveryRequested || !!activeId;
    setPassword.hidden=!passwordRecovery;cancelRecovery.hidden=!recoveryRequested && !passwordRecovery;
    signOut.hidden = !activeId; refresh.hidden = !activeId; recover.hidden = !owner || identity?.workspaceRole==='viewer';
    const adminMfa=!!activeId && (identity?.mfaRequired===true || platformAdmin());
    mfaStart.hidden=mfaRemove.hidden=!adminMfa;mfaVerify.hidden=!adminMfa || !factorId;mfa.hidden=!adminMfa || !factorId;
    workspaces.replaceChildren();
    for(const ws of identity?.workspaces || []){const row=document.createElement('li');row.textContent=`${ws.name} (${ws.kind}) - ${ws.role[0].toUpperCase()+ws.role.slice(1)}`;workspaces.append(row);}
    privileges.textContent=platformAdmin()?'Platform Admin - Full product access':identity?.mfaRequired?'Platform Admin requires authenticator verification':'';
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
    if (error) throw error; setState('Pending sync', 'Check your email for the sign-in code.');
  });
  const verify = action('ownerVerifyCode', 'Sign In', async () => {
    const { data, error } = await client.auth.verifyOtp({ email: email.value.trim(), token: code.value.trim(), type: 'email' });
    if (error) throw error; code.value = ''; await activate(data.session);
  });
  const newPassword=()=>{if(password.value.length<12 || password.value!==confirmPassword.value)throw new Error('Use a password of at least 12 characters and matching confirmation.');return password.value;};
  const passwordSignIn=action('accountPasswordSignIn','Sign In With Password',async()=>{
    const {data,error}=await client.auth.signInWithPassword({email:email.value.trim(),password:password.value});
    if(error)throw error;clearSecrets();await activate(data.session);
  });
  const register=action('accountRegister','Create Account',async()=>{
    if(!registrationEnabled)throw new Error('Registration is disabled.');
    const {data,error}=await client.auth.signUp({email:email.value.trim(),password:newPassword()});
    if(error)throw error;clearSecrets();
    if(data.session)await activate(data.session);else setState('Pending sync','Check your email for the confirmation code, then Sign In.');
  });
  const recoverAccount=action('accountRecover','Recover Account',async()=>{
    clearSecrets();
    const {error}=await client.auth.resetPasswordForEmail(email.value.trim());if(error)throw error;
    recoveryRequested=true;setState('Pending sync','If the account exists, a recovery code has been sent.');
  });
  const verifyRecovery=action('accountVerifyRecovery','Verify Recovery Code',async()=>{
    const {data,error}=await client.auth.verifyOtp({email:email.value.trim(),token:code.value.trim(),type:'recovery'});
    if(error)throw error;passwordRecovery=true;clearSecrets();await activate(data.session);
  });
  const setPassword=action('accountSetPassword','Set New Password',async()=>{
    if((await currentSession())?.user.id!==activeId)throw new Error('Account changed. Start recovery again.');
    const {error}=await client.auth.updateUser({password:newPassword()});if(error)throw error;
    passwordRecovery=recoveryRequested=false;clearSecrets();setState('Synced','Password updated.');
  });
  const cancelRecovery=action('accountCancelRecovery','Cancel Recovery',()=>{passwordRecovery=recoveryRequested=false;clearSecrets();paint();});
  const currentSession=async()=>{const {data,error}=await client.auth.getSession();if(error)throw error;return data.session;};
  const mfaStart=action('accountMfaStart','Set Up / Verify Admin MFA',async()=>{
    const ticket=epoch;
    const {data,error}=await client.auth.mfa.listFactors();if(error)throw error;
    if(ticket!==epoch)return;
    const verified=data.totp?.find(f=>f.status==='verified');
    if(verified){factorId=verified.id;setState('Pending sync','Enter your authenticator code.');return;}
    const stale=(data.all || data.totp || []).filter(f=>f.status==='unverified' && f.friendly_name==='WireNexus Authenticator');
    for(const factor of stale){const removed=await client.auth.mfa.unenroll({factorId:factor.id});if(removed.error)throw removed.error;}
    pendingFactor='';
    const result=await client.auth.mfa.enroll({factorType:'totp',friendlyName:'WireNexus Authenticator'});if(result.error)throw result.error;
    if(ticket!==epoch || !dialog.open){await client.auth.mfa.unenroll({factorId:result.data.id});return;}
    factorId=pendingFactor=result.data.id;qr.src=result.data.totp.qr_code;qr.hidden=false;secret.textContent='Setup key: '+result.data.totp.secret;
    setState('Pending sync','Scan the QR code and verify your authenticator code.');
  });
  const mfaVerify=action('accountMfaVerify','Verify Authenticator',async()=>{
    const {error}=await client.auth.mfa.challengeAndVerify({factorId,code:mfaCode.value.trim()});if(error)throw error;
    pendingFactor='';clearSecrets();await activate(await currentSession());
  });
  const mfaRemove=action('accountMfaRemove','Remove Authenticator',async()=>{
    if(!confirm('Remove your authenticator? Platform Admin access will require MFA setup again.'))return;
    const {data,error}=await client.auth.mfa.listFactors();if(error)throw error;
    const verified=data.totp?.find(f=>f.status==='verified');if(!verified)throw new Error('No verified authenticator is installed.');
    const result=await client.auth.mfa.unenroll({factorId:verified.id});if(result.error)throw result.error;
    const refreshed=await client.auth.refreshSession();if(refreshed.error)throw refreshed.error;
    clearSecrets();await activate(refreshed.data.session);
  });
  const signOut = action('ownerSignOut', 'Sign Out', async () => {
    const { error } = await client.auth.signOut({ scope: 'local' }); if (error) throw error;
    pendingFactor='';passwordRecovery=recoveryRequested=false;clearSecrets();
    await activate(null);
  });
  const refresh = action('ownerRefresh', 'Refresh Account', async () => {
    await activate(await currentSession());
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
  dialog.append(heading, status, privileges, workspaces, fields, mfa, actions, review, close); document.body.append(dialog); container.append(button);
  const plansPanel=mountPlansPanel({container:dialog,identity:()=>owner && identity,rpc:(...args)=>client.rpc(...args)});
  const teamsPanel=mountOrganizationsPanel({container:dialog,identity:()=>owner && identity,rpc:(...args)=>client.rpc(...args),
    refreshAccount:async()=>activate(await currentSession()),
    selectLibrary:async wid=>{
      const member=identity?.workspaces.find(w=>w.id===wid);if(!member)throw new Error('Workspace access unavailable. Refresh Account.');
      selectedWorkspaceId=member.kind==='enterprise'?wid:null;await activate(await currentSession());
      if(!owner || identity.workspaceId!==wid)throw new Error('Shared access changed. Refresh Account.');
    },
    invite:async body=>{
      const session=await currentSession();if(!session || session.user.id!==activeId)throw new Error('Account changed. Refresh.');
      const response=await fetch('./api/organization-invite',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(body)});
      const result=await response.json();if(!response.ok)throw new Error(result.error || 'Invitation could not be sent.');return result;
    }});
  dialog.addEventListener('close',()=>{const pending=pendingFactor;pendingFactor='';clearSecrets();if(pending)client.auth.mfa.unenroll({factorId:pending}).catch(()=>{});});
  button.addEventListener('click', () => {dialog.showModal();plansPanel.refresh();teamsPanel.refresh();});
  async function activate(session) {
    const ticket = ++epoch;
    plansPanel.clear();
    teamsPanel.clear();
    if (!session) {
      activeId = null; owner = null; store = null; identity=null;selectedWorkspaceId=null;pendingFactor='';passwordRecovery=recoveryRequested=false;review.replaceChildren();clearSecrets();teamsPanel.refresh();
      await onOwner(recoveryOwner, false, null); setState(configured ? 'Pending sync' : state, configured ? 'Sign in to save to your account. Browser recovery is retained.' : ''); return;
    }
    if(activeId && activeId!==session.user.id){owner=store=identity=null;selectedWorkspaceId=null;pendingFactor='';passwordRecovery=recoveryRequested=false;clearSecrets();await onOwner(recoveryOwner,false,null);}
    setState('Pending sync', 'Verifying account and loading personal workspace');
    try {
      if(selectedWorkspaceId){
        const membership=await client.rpc('wirenexus_library',{operation:'identity',payload:{expectedAccountId:session.user.id}});
        if(ticket!==epoch)return;
        if(membership.error)throw new Error(membership.error.message);
        if(!membership.data.workspaces?.some(w=>w.id===selectedWorkspaceId && w.kind==='enterprise'))selectedWorkspaceId=null;
      }
      const candidate = createAccountLibraryStore({ rpc: (...args) => client.rpc(...args),workspaceId:selectedWorkspaceId,
        onState: (s, d) => { if (ticket === epoch) setState(s, d); } });
      const next = await createOwner(candidate);
      if (ticket !== epoch) return;
      identity=candidate.identity();
      if(identity.accountId!==session.user.id)throw new Error('Account changed while loading. Refresh Account.');
      store = candidate; owner = next; activeId = identity.accountId;
      await onOwner(next,platformAdmin(),identity); setState('Synced'); plansPanel.refresh();teamsPanel.refresh();
    } catch (error) {
      if (ticket === epoch) {
        owner = null; store = null;identity=null; activeId = session.user.id;
        await onOwner(recoveryOwner, false, null); setState('Sync failed', error.message);
      }
    }
  }
  paint();
  try {
    const response = await fetch(configUrl, { cache: 'no-store' });
    const config = response.ok ? await response.json() : { configured: false };
    configured = config.configured === true;
    registrationEnabled=config.registrationEnabled===true;
    if (configured) {
      const factory = createClient || (await import('./generated/accountAuth.js')).createClient;
      client = factory(config.url, config.publishableKey, { auth: { storageKey: 'wirenexus-owner-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
      const { data, error } = await client.auth.getSession(); if (error) throw error;
      await activate(data.session);
      client.auth.onAuthStateChange((event, session) => {
        // Never await authenticated requests while the SDK's session lock is held.
        if (event === 'SIGNED_OUT' || ['TOKEN_REFRESHED','MFA_CHALLENGE_VERIFIED'].includes(event) || (event === 'SIGNED_IN' && session?.user.id !== activeId)) setTimeout(() => activate(session).catch(error => setState('Sync failed', error.message)), 0);
      });
    } else setState(state, config.error || 'See docs/owner-account-setup.md. Browser data is not account-synced.');
  } catch (error) { setState('Sync failed', `Account setup unavailable: ${error.message}`); }
  if(teamsPanel.hasInvitation()){teamsPanel.refresh();dialog.showModal();}
  return Object.freeze({ isAccount: () => !!owner, canSave: () => !configured || (!!owner && identity?.workspaceRole!=='viewer'), status: () => state,
    async refreshLibrary() {
      if(!owner)return recoveryOwner.refresh();const ticket=epoch,captured=store;
      try {
        await owner.refresh();if(ticket!==epoch)return;
        const next=captured.identity();
        if(next.workspaceRole!==identity.workspaceRole || JSON.stringify(next.workspaces)!==JSON.stringify(identity.workspaces))await activate(await currentSession());
      }catch(error){if(selectedWorkspaceId && ticket===epoch){selectedWorkspaceId=null;await activate(await currentSession());}else throw error;}
    },
    cloudIdentity: () => owner && identity ? structuredClone(identity) : null,
    async cloudRpc(name,args) {
      if(!owner || !client || name!=='wirenexus_cloud')throw new Error('Sign in through Account before opening cloud projects.');
      return client.rpc(name,args);
    },
    async publishingToken() {
      if (!client) throw new Error('Publishing requires the account service to be configured.');
      const {data,error} = await client.auth.getSession();
      if (error || !data.session?.access_token) throw new Error('Sign in through Account before publishing.');
      return data.session.access_token;
    },
    async savePreferences(value) { if (!owner) throw new Error('Sign in to save account preferences.'); await owner.savePreferences(value); },
    preferences: () => owner?.preferences() || null });
}
