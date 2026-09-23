// Rebatify Production Admin Console — Website Build 98
// Uses the signed-in Beta Admin Firebase session only as the administrator identity.
// All privileged production reads/writes go through the Production Admin Worker.
// No production service-account secret is ever present in browser code.

import { auth, isAdminUser } from './firebase-core.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const WORKER_KEY = 'rebatify.productionAdmin.workerUrl';
const state = {
  scope: 'beta',
  view: 'overview',
  connected: false,
  initialized: false,
  endpoint: '',
  overview: null,
  users: [],
  devices: [],
  identities: [],
  access: { premiumGrants: [], trialOverrides: [], reviewAccess: [] },
  audit: [],
  selectedUser: null,
  selectedUserDetail: null,
  action: null,
  durationPreset: '14d'
};

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const asDate = value => {
  if (!value) return null;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};
const fmtDate = value => {
  const d = asDate(value); if (!d) return '—';
  try { return d.toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'}); } catch (_) { return d.toISOString().slice(0,10); }
};
const fmtDateTime = value => {
  const d = asDate(value); if (!d) return '—';
  try { return d.toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}); } catch (_) { return d.toISOString(); }
};
const shortId = value => { const s=String(value||''); return s.length>20 ? `${s.slice(0,9)}…${s.slice(-7)}` : (s||'—'); };

function endpoint(){
  return (state.endpoint || localStorage.getItem(WORKER_KEY) || window.REBATIFY_PRODUCTION_ADMIN_WORKER_URL || '').trim().replace(/\/$/,'');
}

function productionMessage(message, type=''){
  const el=$('productionConnectionMessage'); if(!el)return;
  el.textContent=message||''; el.className='production-connection-message'+(type?` ${type}`:'');
}

function setConnectionUI(connected, label=''){
  state.connected=!!connected;
  const chips=[$('productionConnectionChip'),$('productionSettingsConnectionChip')].filter(Boolean);
  chips.forEach(chip=>{
    chip.textContent=connected ? (label||'Connected') : 'Not connected';
    chip.classList.toggle('admin-service-disconnected',!connected);
    chip.classList.toggle('admin-service-connected',connected);
  });
  const live=$('adminLiveChip');
  if(state.scope==='production'&&live){
    live.innerHTML=connected?'<span></span> Production connected':'<span></span> Production offline';
    live.classList.toggle('admin-live-online',!!connected);
    live.classList.toggle('admin-live-offline',!connected);
  }
}

async function callProduction(action, payload={}){
  const url=endpoint();
  if(!url) throw new Error('Connect the Production Admin Worker in Production → Settings first.');
  const user=auth.currentUser;
  if(!user||!isAdminUser(user)) throw new Error('Administrator authentication is required.');
  const token=await user.getIdToken();
  const response=await fetch(url,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
    body:JSON.stringify({action,...payload})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.ok===false) throw new Error(data.error||data.message||`Production Admin request failed (${response.status}).`);
  return data;
}

function showProdToast(message,type='success'){
  const toast=$('adminToast'); if(!toast)return;
  toast.textContent=message; toast.hidden=false; toast.className=`admin-toast ${type==='error'?'error':''}`;
  clearTimeout(showProdToast.timer); showProdToast.timer=setTimeout(()=>{toast.hidden=true;},4200);
}

function setScope(scope){
  if(scope!=='beta'&&scope!=='production')return;
  state.scope=scope;
  document.querySelectorAll('[data-admin-scope]').forEach(b=>b.classList.toggle('is-active',b.dataset.adminScope===scope));
  const beta=scope==='beta';
  $('betaAdminNav').hidden=!beta;
  $('productionAdminNav').hidden=beta;
  $('adminPortalContent').hidden=!beta;
  $('productionAdminContent').hidden=beta;
  $('adminNotificationWrap').hidden=!beta;
  $('adminRefresh').hidden=!beta;
  $('productionAdminRefresh').hidden=beta;
  if($('adminBrandScope'))$('adminBrandScope').textContent=beta?'Beta Admin':'Production Admin';
  if($('adminTopbarEyebrow'))$('adminTopbarEyebrow').textContent=beta?'Rebatify Beta Program':'Rebatify Production';
  if(beta){
    const active=document.querySelector('[data-admin-view].is-active');
    if($('adminViewTitle'))$('adminViewTitle').textContent=active?.innerText?.trim()||'Overview';
    if($('adminLiveChip')){
      $('adminLiveChip').innerHTML='<span></span> Live updates';
      $('adminLiveChip').classList.add('admin-live-online');
      $('adminLiveChip').classList.remove('admin-live-offline');
    }
  }else{
    const label=document.querySelector(`[data-production-view="${state.view}"] span:nth-child(2)`)?.textContent||'Overview';
    if($('adminViewTitle'))$('adminViewTitle').textContent=label;
    setConnectionUI(state.connected);
    initializeProduction().catch(err=>showProdToast(err.message,'error'));
  }
}

function focusProductionAccessTarget(kind){
  const ids={premium:'productionAccessPremium',trial:'productionAccessTrial',review:'productionAccessReview'};
  document.querySelectorAll('.production-access-target').forEach(x=>x.classList.remove('is-focused'));
  const target=$(ids[kind]);
  if(!target)return;
  requestAnimationFrame(()=>{
    target.classList.add('is-focused');
    target.scrollIntoView({behavior:'smooth',block:'center'});
    window.setTimeout(()=>target.classList.remove('is-focused'),1800);
  });
}
function switchProductionView(view,focus=''){
  state.view=view||'overview';
  document.querySelectorAll('[data-production-view]').forEach(b=>b.classList.toggle('is-active',b.dataset.productionView===state.view));
  document.querySelectorAll('[data-production-panel]').forEach(p=>p.classList.toggle('is-active',p.dataset.productionPanel===state.view));
  const label=document.querySelector(`[data-production-view="${state.view}"] span:nth-child(2)`)?.textContent||'Production';
  if($('adminViewTitle'))$('adminViewTitle').textContent=label;
  document.querySelector('.admin-main')?.scrollTo?.({top:0,behavior:'smooth'});
  if(state.view==='users') loadUsers().catch(err=>showProdToast(err.message,'error'));
  if(state.view==='devices') loadDevices().catch(err=>showProdToast(err.message,'error'));
  if(state.view==='identities') loadIdentities().catch(err=>showProdToast(err.message,'error'));
  if(state.view==='access') loadAccess().then(()=>{if(focus)focusProductionAccessTarget(focus);}).catch(err=>showProdToast(err.message,'error'));
  if(state.view==='audit') loadAudit().catch(err=>showProdToast(err.message,'error'));
  if(state.view==='settings') fillSettings();
}

async function initializeProduction(force=false){
  if(state.initialized&&!force)return;
  state.endpoint=endpoint();
  fillSettings();
  if(!state.endpoint){setConnectionUI(false);renderDisconnected();state.initialized=true;return;}
  try{
    const health=await callProduction('health');
    setConnectionUI(true,health.projectLabel||'Production connected');
    productionMessage(`Connected securely${health.projectId?` to ${health.projectId}`:''}.`,'success');
    await Promise.all([loadOverview(true),loadUsers(true),loadAccess(true)]);
  }catch(error){setConnectionUI(false);productionMessage(error.message,'error');renderDisconnected();}
  state.initialized=true;
}

function renderDisconnected(){
  ['productionMetricUsers','productionMetricDevices','productionMetricPlus','productionMetricTrials'].forEach(id=>{if($(id))$(id).textContent='—';});
  if($('productionRecentUsers'))$('productionRecentUsers').innerHTML='<div class="admin-empty-inline">Connect the Production Admin service in Settings to load live data.</div>';
  if($('productionUsersTableBody'))$('productionUsersTableBody').innerHTML='';
  if($('productionUsersEmpty')){$('productionUsersEmpty').hidden=false;$('productionUsersEmpty').textContent='Connect the Production Admin service to load users.';}
}

function fillSettings(){ if($('productionWorkerUrl'))$('productionWorkerUrl').value=endpoint(); }

async function loadOverview(force=false){
  if(state.overview&&!force){renderOverview();return;}
  const data=await callProduction('overview'); state.overview=data; setConnectionUI(true,data.projectLabel||'Production connected'); renderOverview();
}
function renderOverview(){
  const o=state.overview||{}; const m=o.metrics||{};
  if($('productionMetricUsers'))$('productionMetricUsers').textContent=m.users ?? '0';
  if($('productionMetricDevices'))$('productionMetricDevices').textContent=m.devices ?? '0';
  if($('productionMetricPlus'))$('productionMetricPlus').textContent=m.plusAccess ?? '0';
  if($('productionMetricTrials'))$('productionMetricTrials').textContent=m.activeTrials ?? '0';
  const users=o.recentUsers||[];
  if($('productionRecentUsers'))$('productionRecentUsers').innerHTML=users.length?users.map(u=>`<button class="production-recent-user" data-production-user="${esc(u.uid)}" type="button"><div><strong>${esc(u.name||u.email||'Rebatify user')}</strong><span>${esc(u.email||u.uid)}</span></div><time>${esc(fmtDate(u.createdAt))}</time></button>`).join(''):'<div class="admin-empty-inline">No production users found.</div>';
  if($('productionUsersBadge')){$('productionUsersBadge').hidden=!(Number(m.users)>0);$('productionUsersBadge').textContent=Number(m.users)>999?'999+':String(m.users||0);}
}

async function loadUsers(force=false){
  if(state.users.length&&!force){renderUsers();return;}
  const data=await callProduction('users-list',{limit:500}); state.users=data.users||[]; renderUsers();
}
function userTrialState(u){
  if(u.trialOverrideActive)return 'trial';
  if(u.trialActive)return 'trial';
  return 'expired';
}
function userPlusState(u){
  if(u.adminPremiumGrantActive)return 'grant';
  if(u.premiumActive)return 'plus';
  return '';
}
function userMatchesFilter(u,filter){
  if(!filter)return true;
  if(filter==='plus')return !!u.premiumActive||!!u.adminPremiumGrantActive||!!u.reviewAccessActive;
  if(filter==='grant')return !!u.adminPremiumGrantActive;
  if(filter==='trial')return !!u.trialActive||!!u.trialOverrideActive;
  if(filter==='review')return !!u.reviewAccessActive;
  if(filter==='expired')return !u.premiumActive&&!u.adminPremiumGrantActive&&!u.reviewAccessActive&&!u.trialActive&&!u.trialOverrideActive;
  return true;
}
function renderUsers(){
  const q=String($('productionUserSearch')?.value||'').trim().toLowerCase(); const filter=$('productionUserFilter')?.value||'';
  const rows=state.users.filter(u=>{const hay=[u.name,u.email,u.uid].join(' ').toLowerCase();return (!q||hay.includes(q))&&userMatchesFilter(u,filter);});
  if($('productionUsersTableBody'))$('productionUsersTableBody').innerHTML=rows.map(u=>{
    const trial=userTrialState(u)==='trial'?'<span class="production-status blue">Active</span>':'<span class="production-status">Expired / none</span>';
    const plus=u.adminPremiumGrantActive?'<span class="production-status green">Admin grant</span>':u.premiumActive?`<span class="production-status green">${esc(u.premiumSource||'Store entitlement')}</span>`:u.reviewAccessActive?'<span class="production-status blue">App Review access</span>':'<span class="production-status">None</span>';
    const review=u.reviewAccessActive?`<span class="production-status blue" title="${esc(u.reviewAccessSource||'App Review access')}">${esc(u.reviewAccessSource==='Admin grant'?'Admin grant':'Active')}</span>`:'<span class="production-status">None</span>';
    const linked=Number(u.deviceLinkedAccountCount||1)>1?`<span class="production-status blue">${esc(String(u.deviceLinkedAccountCount))} same-device</span>`:Number(u.manualLinkedAccountCount||1)>1?`<span class="production-status blue">${esc(String(u.manualLinkedAccountCount))} admin-linked</span>`:'<span class="production-status">None</span>';
    return `<tr><td><div class="production-user-cell"><strong>${esc(u.name||'Rebatify user')}</strong><span>${esc(u.email||'')}</span><span title="${esc(u.uid)}">${esc(shortId(u.uid))}</span></div></td><td>${esc(fmtDate(u.createdAt))}</td><td>${trial}</td><td>${plus}</td><td>${review}</td><td>${linked}</td><td>${esc(String(u.deviceCount??0))}</td><td><button class="admin-action-button" data-production-user="${esc(u.uid)}" type="button">Open</button></td></tr>`;
  }).join('');
  if($('productionUsersEmpty')){$('productionUsersEmpty').hidden=rows.length>0;$('productionUsersEmpty').textContent=state.users.length?'No production users match these filters.':'No production users found.';}
}

async function loadDevices(force=false){
  if(state.devices.length&&!force){renderDevices();return;}
  const data=await callProduction('devices-list',{limit:1000}); state.devices=data.devices||[]; renderDevices();
}
function renderDevices(){
  const q=String($('productionDeviceSearch')?.value||'').trim().toLowerCase();
  const rows=state.devices.filter(d=>!q||[d.deviceName,d.deviceModel,d.platform,d.deviceId,d.userEmail,d.userName,d.uid].join(' ').toLowerCase().includes(q));
  if($('productionDevicesTableBody'))$('productionDevicesTableBody').innerHTML=rows.map(d=>`<tr><td><div class="production-user-cell"><strong>${esc(d.deviceName||d.deviceModel||'Device')}</strong><span title="${esc(d.deviceId)}">${esc(shortId(d.deviceId))}</span></div></td><td><div class="production-user-cell"><strong>${esc(d.userName||'User')}</strong><span>${esc(d.userEmail||d.uid||'')}</span>${Number(d.sameDeviceAccountCount||1)>1?`<span class="production-linked-note">Used by ${esc(String(d.sameDeviceAccountCount))} accounts</span>`:''}</div></td><td>${esc(d.platform||'Device')}</td><td><div class="production-device-tags">${d.isPrimary?'<span class="production-status green">Primary</span>':''}${d.isTrusted?'<span class="production-status blue">Trusted</span>':''}${d.isActive?'<span class="production-status">Active</span>':''}</div></td><td>${esc(fmtDate(d.firstSeenAt))}</td><td>${esc(fmtDate(d.lastSeenAt))}</td><td><button class="admin-action-button" data-production-user="${esc(d.uid)}" type="button">User</button></td></tr>`).join('');
  if($('productionDevicesEmpty')){$('productionDevicesEmpty').hidden=rows.length>0;$('productionDevicesEmpty').textContent=state.devices.length?'No devices match this search.':'No production devices found.';}
}

async function loadIdentities(force=false){
  if(state.identities.length&&!force){renderIdentities();return;}
  const data=await callProduction('identity-list',{limit:500}); state.identities=data.identities||[]; renderIdentities();
}
function renderIdentities(){
  const rows=state.identities||[];
  if($('productionIdentityTableBody'))$('productionIdentityTableBody').innerHTML=rows.map(group=>{
    const members=(group.members||[]).map(m=>`<button class="production-identity-member" data-production-user="${esc(m.uid)}" type="button"><strong>${esc(m.name||m.email||'Rebatify user')}</strong><span>${esc(m.email||shortId(m.uid))}</span></button>`).join('');
    const auto=group.type==='device';
    const detail=auto?`Secure device ${esc(shortId(group.deviceId))}${group.firstTrialStartedAt?` · Trial started ${esc(fmtDate(group.firstTrialStartedAt))}`:''}`:`${esc(shortId(group.id))}`;
    return `<tr><td><div class="production-user-cell"><strong>${esc(group.label||'Related production accounts')}</strong><span>${detail}</span><span class="production-linked-note">${auto?'Automatic · same device':'Manual Admin link'}</span></div></td><td><div class="production-identity-members">${members}</div></td><td>${esc(String(group.deviceCount||0))}</td><td>${esc(fmtDateTime(group.updatedAt))}</td><td>${group.members?.[0]?.uid?`<button class="admin-action-button" data-production-user="${esc(group.members[0].uid)}" type="button">Open</button>`:''}</td></tr>`;
  }).join('');
  if($('productionIdentityEmpty')){$('productionIdentityEmpty').hidden=rows.length>0;$('productionIdentityEmpty').textContent='No related production accounts detected yet.';}
}

async function loadAccess(force=false){
  if((state.access.premiumGrants.length||state.access.trialOverrides.length||state.access.reviewAccess.length)&&!force){renderAccess();return;}
  const data=await callProduction('access-list',{limit:500}); state.access={premiumGrants:data.premiumGrants||[],trialOverrides:data.trialOverrides||[],reviewAccess:data.reviewAccess||[]}; renderAccess();
}
function accessItemHtml(item,type){
  const title=item.name||item.email||item.userEmail||item.uid||item.deviceId||'Access record';
  let detail='';
  if(type==='premium')detail=item.indefinite?'Indefinite complimentary Rebatify+':`Expires ${fmtDateTime(item.expiresAt)}`;
  if(type==='trial')detail=`Trial reissue expires ${fmtDateTime(item.expiresAt)} · ${shortId(item.deviceId)}`;
  if(type==='review')detail=item.indefinite?'Indefinite App Review access':`Expires ${fmtDateTime(item.expiresAt)}`;
  const source=type==='review'&&item.source?`<span class="production-access-source">Source: ${esc(item.source)}</span>`:'';
  return `<div class="production-access-item"><div><strong>${esc(title)}</strong><span>${esc(detail)}</span>${source}<span>${esc(item.reason||'')}</span></div>${item.uid?`<button class="admin-text-button" data-production-user="${esc(item.uid)}" type="button">Open</button>`:''}</div>`;
}
function renderAccess(){
  const p=state.access.premiumGrants.filter(x=>x.active),t=state.access.trialOverrides.filter(x=>x.active),r=state.access.reviewAccess.filter(x=>x.active);
  if($('productionGrantCount'))$('productionGrantCount').textContent=`${p.length} active`;
  if($('productionTrialOverrideCount'))$('productionTrialOverrideCount').textContent=`${t.length} active`;
  if($('productionReviewCount'))$('productionReviewCount').textContent=`${r.length} active`;
  if($('productionPremiumGrantList'))$('productionPremiumGrantList').innerHTML=p.length?p.map(x=>accessItemHtml(x,'premium')).join(''):'<div class="admin-empty-inline">No active complimentary Rebatify+ grants.</div>';
  if($('productionTrialOverrideList'))$('productionTrialOverrideList').innerHTML=t.length?t.map(x=>accessItemHtml(x,'trial')).join(''):'<div class="admin-empty-inline">No active admin trial reissues.</div>';
  if($('productionReviewAccessList'))$('productionReviewAccessList').innerHTML=r.length?r.map(x=>accessItemHtml(x,'review')).join(''):'<div class="admin-empty-inline">No active App Review grants.</div>';
}

async function loadAudit(force=false){
  if(state.audit.length&&!force){renderAudit();return;}
  const data=await callProduction('audit-list',{limit:200}); state.audit=data.audit||[]; renderAudit();
}
function renderAudit(){
  if($('productionAuditList'))$('productionAuditList').innerHTML=state.audit.length?state.audit.map(a=>`<article class="production-audit-item"><div class="production-audit-icon">${esc((a.action||'A').slice(0,1).toUpperCase())}</div><div><h3>${esc(a.actionLabel||a.action||'Admin action')}</h3><p>${esc(a.targetLabel||a.targetUid||a.deviceId||'')}</p><p>${esc(a.reason||'')}</p><small>${esc(a.adminEmail||'Administrator')}${a.requestId?` · ${esc(shortId(a.requestId))}`:''}</small></div><time>${esc(fmtDateTime(a.createdAt))}</time></article>`).join(''):'<div class="admin-empty admin-empty-card">No production admin actions have been recorded yet.</div>';
}

async function openUser(uid){
  if(!uid)return;
  const drawer=$('productionAdminDrawer'),back=$('productionDrawerBackdrop'),content=$('productionDrawerContent');
  if(content)content.innerHTML='<div class="admin-empty-inline">Loading production user…</div>';
  if(drawer){drawer.classList.add('is-open');drawer.setAttribute('aria-hidden','false');} if(back)back.hidden=false;
  try{
    const data=await callProduction('user-detail',{uid}); state.selectedUser=uid; state.selectedUserDetail=data;
    renderUserDrawer(data);
  }catch(error){if(content)content.innerHTML=`<div class="admin-empty-inline">${esc(error.message)}</div>`;}
}
function closeUserDrawer(){ $('productionDrawerBackdrop').hidden=true; $('productionAdminDrawer')?.classList.remove('is-open'); $('productionAdminDrawer')?.setAttribute('aria-hidden','true'); state.selectedUser=null;state.selectedUserDetail=null; }
function renderUserDrawer(data){
  const u=data.user||{}; const devices=data.devices||[]; const pg=data.premiumGrant||null; const ro=data.reviewAccess||null; const re=data.reviewAccessEffective||null; const reviewSources=data.reviewAccessSources||[]; const trial=data.trial||{}; const identity=data.identity||{};
  if($('productionDrawerTitle'))$('productionDrawerTitle').textContent=u.name||u.email||'Production User';
  if($('productionDrawerKicker'))$('productionDrawerKicker').textContent='Production User';
  const plusText=pg?.active?(pg.indefinite?'Complimentary · Indefinite':`Complimentary · Until ${fmtDate(pg.expiresAt)}`):(u.premiumActive?`${u.premiumSource||'Store'} entitlement`:re?.active?`App Review access · ${re.source||'Active'}`:'No Rebatify+ access');
  const trialText=trial.override?.active?`Admin reissue until ${fmtDate(trial.override.expiresAt)}`:trial.active?`Active until ${fmtDate(trial.expiresAt)}`:'Expired / unavailable';
  const reviewText=reviewSources.length?`${reviewSources.length} active source${reviewSources.length===1?'':'s'} · ${reviewSources.map(x=>x.source).join(' + ')}`:'Not granted';
  const authEmail=data.auth?.email||u.email||'';
  const authStatus=data.auth?.disabled?'Disabled':'Active';
  const deviceHtml=devices.length?devices.map(d=>`<div class="production-device-card"><div><strong>${esc(d.deviceName||d.deviceModel||'Device')}</strong><span>${esc(d.platform||'Device')} · ${esc(shortId(d.deviceId))}</span></div><div class="production-device-tags">${d.isPrimary?'<span class="production-status green">Primary</span>':''}${d.isTrusted?'<span class="production-status blue">Trusted</span>':''}${d.isActive?'<span class="production-status">Active</span>':''}</div></div>`).join(''):'<div class="admin-empty-inline">No device records found.</div>';
  const linkedMembers=(identity.members||[]).filter(m=>m.uid!==u.uid);
  const linkedHtml=linkedMembers.length?linkedMembers.map(m=>`<div class="production-linked-account-row"><button class="production-linked-account-open" data-production-user="${esc(m.uid)}" type="button"><strong>${esc(m.name||m.email||'Rebatify user')}</strong><span>${esc(m.email||shortId(m.uid))} · Manual Admin relationship</span></button><button class="admin-text-button production-unlink-button" data-production-identity-unlink="${esc(m.uid)}" data-base-uid="${esc(u.uid)}" type="button">Unlink</button></div>`).join(''):'<div class="admin-empty-inline">No manual Admin links for this account.</div>';
  const deviceMatches=identity.deviceMatches||[];
  const automaticHtml=deviceMatches.length?`<div class="production-identity-suggestions"><strong>Automatically detected same-device accounts</strong><span>These relationships come from the secure registered device identifier and are read-only. They do not transfer App Review or complimentary Rebatify+ access between accounts.</span>${deviceMatches.map(m=>{const deviceInfo=(m.matchingDevices||[]).map(d=>`${shortId(d.deviceId)}${d.firstTrialStartedAt?` · trial ${fmtDate(d.firstTrialStartedAt)}`:''}`).join(', ');return `<button class="production-identity-suggestion" data-production-user="${esc(m.uid)}" type="button"><div><strong>${esc(m.name||m.email||'Rebatify user')}</strong><span>${esc(m.email||shortId(m.uid))} · Same secure device${m.manuallyLinked?' · also manually linked':''}</span><span>${esc(deviceInfo)}</span></div><span>Open →</span></button>`;}).join('')}</div>`:'<div class="admin-empty-inline">No other accounts have been detected on this account’s registered devices.</div>';
  $('productionDrawerContent').innerHTML=`<div class="production-user-summary"><div class="production-summary-card"><h3>Account</h3><div class="production-summary-grid"><div class="production-summary-field"><span>Email</span><strong>${esc(authEmail||'—')}</strong></div><div class="production-summary-field"><span>UID</span><strong title="${esc(u.uid||'')}">${esc(shortId(u.uid))}</strong></div><div class="production-summary-field"><span>Created</span><strong>${esc(fmtDateTime(u.createdAt))}</strong></div><div class="production-summary-field"><span>Auth Status</span><strong>${esc(authStatus)}</strong></div></div><div class="production-account-security-row"><div><strong>Password assistance</strong><span>Send the normal branded Rebatify password-reset email to this account.</span></div><button class="production-action-button blue" data-production-action="password-reset" data-uid="${esc(u.uid)}" type="button" ${data.auth?.disabled?'disabled':''}>Send Password Reset Email</button></div></div><div class="production-summary-card"><h3>Access</h3><div class="production-summary-grid"><div class="production-summary-field"><span>Trial</span><strong>${esc(trialText)}</strong></div><div class="production-summary-field"><span>Rebatify+</span><strong>${esc(plusText)}</strong></div><div class="production-summary-field"><span>App Review</span><strong>${esc(reviewText)}</strong></div><div class="production-summary-field"><span>Home Device</span><strong>${esc(shortId(u.homeDeviceID))}</strong></div></div><div class="production-integration-notice"><strong>Entitlement scope</strong><span>App Review and complimentary Rebatify+ access belong only to this Firebase UID and follow this account across authorized devices. They never transfer to another account because it uses the same device. Device identity remains the authority only for normal trial history.</span></div><div class="production-action-row three"><button class="production-action-button blue" data-production-action="trial" data-uid="${esc(u.uid)}" type="button">Reset Trial</button><button class="production-action-button green" data-production-action="premium" data-uid="${esc(u.uid)}" type="button">${pg?.active?'Manage Rebatify+':'Grant Rebatify+'}</button><button class="production-action-button" data-production-action="review" data-uid="${esc(u.uid)}" type="button">${reviewSources.length?'Manage App Review':'Grant App Review'}</button></div></div><div class="production-summary-card"><div class="production-summary-card-heading"><div><h3>Related Accounts</h3><p>Same-device relationships are detected automatically for trial/support visibility. Manual Admin links remain separate and optional.</p></div><button class="production-action-button blue" data-production-action="identity" data-uid="${esc(u.uid)}" type="button">Manual Link Account</button></div>${automaticHtml}${identity.group?.label?`<div class="production-linked-group-label"><span>Manual group</span><strong>${esc(identity.group.label)}</strong></div>`:''}<div class="production-linked-account-list">${linkedHtml}</div></div><div class="production-summary-card"><h3>Devices</h3><div class="production-device-list">${deviceHtml}</div></div><div class="production-action-note">Privileged actions are applied by the Production Admin Worker and recorded in the audit log. The browser never receives the production service-account credential.</div></div>`;
}

function closeAction(){ $('productionActionBackdrop').hidden=true; state.action=null; if($('productionActionMessage')){$('productionActionMessage').textContent='';$('productionActionMessage').className='production-action-message';} }
function setActionMessage(message,type=''){const el=$('productionActionMessage');if(!el)return;el.textContent=message||'';el.className='production-action-message'+(type?` ${type}`:'');}
function durationButtons(){return [['1d','1 Day'],['1w','1 Week'],['14d','14 Days'],['1m','1 Month'],['3m','3 Months'],['6m','6 Months'],['1y','1 Year'],['custom','Custom'],['indefinite','Indefinite']].map(([v,l])=>`<button class="production-duration-option${state.durationPreset===v?' is-active':''}" data-duration-preset="${v}" type="button">${l}</button>`).join('');}
function openAccessAction(kind,uid){
  const detail=state.selectedUserDetail; if(!detail||detail.user?.uid!==uid)return;
  state.action={kind,uid}; state.durationPreset=kind==='trial'?'14d':'14d';
  $('productionActionBackdrop').hidden=false;
  if(kind==='premium')renderPremiumAction();
  if(kind==='trial')renderTrialAction();
  if(kind==='review')renderReviewAction();
  if(kind==='password-reset')renderPasswordResetAction();
  if(kind==='identity')renderIdentityAction();
}
function reasonField(placeholder){return `<div class="beta-field"><label for="productionActionReason">Reason <span class="admin-required-inline">*</span></label><textarea id="productionActionReason" maxlength="1000" required placeholder="${esc(placeholder)}"></textarea><small class="admin-email-change-help">Required for the production audit log.</small></div>`;}
function durationFields(){return `<div class="production-duration-grid">${durationButtons()}</div><div class="production-custom-duration" id="productionCustomDuration" ${state.durationPreset==='custom'?'':'hidden'}><div class="beta-field"><label for="productionCustomAmount">Custom amount</label><input id="productionCustomAmount" min="1" max="3650" inputmode="numeric" type="number" value="30"/></div><div class="beta-field"><label for="productionCustomUnit">Unit</label><select id="productionCustomUnit"><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option><option value="years">Years</option></select></div></div>`;}
function renderPremiumAction(){
  const d=state.selectedUserDetail, grant=d.premiumGrant||null;
  $('productionActionKicker').textContent='Complimentary Rebatify+';$('productionActionTitle').textContent=grant?.active?'Manage Rebatify+ Grant':'Grant Rebatify+ Access';
  $('productionActionBody').innerHTML=`<div class="production-action-note">This creates a server-issued complimentary-access record for this Firebase UID only. It follows this account across authorized devices, never transfers to another account on the same device, and does not forge or overwrite an App Store / Google Play subscription.</div>${durationFields()}${reasonField('Example: Beta reward, support goodwill, promotion, internal testing')}<div class="production-action-footer"><button class="admin-secondary-button" data-production-cancel-action type="button">Cancel</button>${grant?.active?'<button class="production-action-button red" data-production-revoke="premium" type="button">Revoke Current Grant</button>':''}<button class="admin-primary-button" data-production-submit="premium" type="button">${grant?.active?'Replace Grant':'Grant Rebatify+'}</button></div>`;
}
function renderReviewAction(){
  const d=state.selectedUserDetail, grant=d.reviewAccess||null, sources=d.reviewAccessSources||[];
  $('productionActionKicker').textContent='App Review Access';$('productionActionTitle').textContent=sources.length?'Manage App Review Access':'Grant App Review Access';
  const sourceRows=sources.length?`<div class="production-integration-notice"><strong>Active account-scoped sources</strong><span>${sources.map(source=>{let revoke='';if(source.sourceType==='admin')revoke='<button class="production-action-button red" data-production-revoke="review" data-review-source="admin" type="button">Revoke Admin Grant</button>';else if(source.sourceType==='legacy-user')revoke='<button class="production-action-button red" data-production-revoke="review" data-review-source="legacy-user" type="button">Revoke Legacy Firebase Access</button>';else if(source.sourceType==='legacy-collection')revoke=`<button class="production-action-button red" data-production-revoke="review" data-review-source="legacy-collection:${esc(source.collection||'')}" type="button">Revoke Legacy Record</button>`;else if(source.sourceType==='auth-claim')revoke='<button class="production-action-button red" data-production-revoke="review" data-review-source="auth-claim" type="button">Remove Review Claim</button>';return `<span><b>${esc(source.source||'App Review access')}</b>${source.key?` · ${esc(source.key)}`:''}${source.expiresAt?` · until ${esc(fmtDate(source.expiresAt))}`:''}</span>${revoke}`;}).join('')}</span></div>`:'';
  $('productionActionBody').innerHTML=`${sourceRows}<div class="production-action-note"><strong>Account scoped.</strong> Admin reviewer access is tied to this Firebase UID only. It follows this account across authorized devices and never transfers to another account because the accounts share a device.</div>${durationFields()}${reasonField('Example: Apple App Review, Google Play review, internal review validation')}<div class="production-action-footer"><button class="admin-secondary-button" data-production-cancel-action type="button">Cancel</button><button class="admin-primary-button" data-production-submit="review" type="button">${grant?.active?'Replace Admin Grant':sources.length?'Add Admin Grant':'Grant Access'}</button></div>`;
}
function renderIdentityAction(prefillUid=''){
  const d=state.selectedUserDetail||{}, u=d.user||{}, identity=d.identity||{};
  const linked=new Set((identity.members||[]).map(m=>m.uid)); linked.add(u.uid);
  const candidates=(state.users||[]).filter(x=>x.uid!==u.uid&&!linked.has(x.uid));
  const preferred=prefillUid||'';
  const options=candidates.map(x=>`<option value="${esc(x.uid)}" ${x.uid===preferred?'selected':''}>${esc(x.name||x.email||'Rebatify user')} · ${esc(x.email||shortId(x.uid))}</option>`).join('');
  $('productionActionKicker').textContent='Manual Account Link'; $('productionActionTitle').textContent='Link Production Accounts';
  $('productionActionBody').innerHTML=`<div class="production-action-note"><strong>No data is merged and no trial state is changed.</strong> Same-device relationships are already detected automatically. This optional Admin link records a confirmed human/account relationship only; authentication, orders, profiles, subscriptions, App Review access, complimentary Rebatify+, device trust, and deviceTrials remain independent.</div><div class="beta-field"><label for="productionIdentityOther">Account to link <span class="admin-required-inline">*</span></label><select id="productionIdentityOther" ${candidates.length?'':'disabled'}>${options||'<option value="">No unlinked accounts available</option>'}</select></div><div class="beta-field"><label for="productionIdentityLabel">Group label <span class="admin-optional-inline">Optional</span></label><input id="productionIdentityLabel" maxlength="120" type="text" value="${esc(identity.group?.label||'')}" placeholder="Example: Andrew Taylor accounts"/></div>${reasonField('Example: Customer confirmed both accounts belong to them')}<div class="production-action-footer"><button class="admin-secondary-button" data-production-cancel-action type="button">Cancel</button><button class="admin-primary-button" data-production-submit="identity" type="button" ${candidates.length?'':'disabled'}>Link Accounts</button></div>`;
}

function openIdentityUnlinkAction(baseUid,otherUid){
  const d=state.selectedUserDetail||{}; const member=(d.identity?.members||[]).find(m=>m.uid===otherUid)||{};
  state.action={kind:'identity-unlink',uid:baseUid,otherUid};
  $('productionActionBackdrop').hidden=false;
  $('productionActionKicker').textContent='Linked Accounts'; $('productionActionTitle').textContent='Unlink Production Account';
  $('productionActionBody').innerHTML=`<div class="production-warning"><strong>Remove only the Admin relationship?</strong>This does not delete either account, sign the customer out, move orders, change subscriptions, or modify device trust. It only removes the Admin link between these accounts.</div><div class="production-action-note"><strong>Account:</strong> ${esc(member.name||member.email||shortId(otherUid))}<br>${esc(member.email||'')}</div>${reasonField('Example: Customer confirmed these accounts belong to different people')}<div class="production-action-footer"><button class="admin-secondary-button" data-production-cancel-action type="button">Cancel</button><button class="production-action-button red" data-production-submit="identity-unlink" type="button">Unlink Account</button></div>`;
}

function renderTrialAction(){
  const d=state.selectedUserDetail, devices=d.devices||[], current=d.trial?.override||null;
  $('productionActionKicker').textContent='Trial Administration';$('productionActionTitle').textContent='Reset 14-Day Trial';
  const opts=devices.map(x=>`<option value="${esc(x.deviceId)}" ${x.isPrimary?'selected':''}>${esc(x.deviceName||x.deviceModel||x.platform||'Device')} · ${esc(shortId(x.deviceId))}${x.isPrimary?' · Primary':''}</option>`).join('');
  $('productionActionBody').innerHTML=`<div class="production-warning"><strong>Original trial history is preserved.</strong>This action does not delete or rewrite the device’s original anti-abuse trial record. It issues a separate 14-day admin reissue window that automatically expires.</div><div class="beta-field"><label for="productionTrialDevice">Device <span class="admin-required-inline">*</span></label><select id="productionTrialDevice">${opts}</select></div>${reasonField('Example: Support exception, review testing, verified trial reset request')}<div class="production-action-footer"><button class="admin-secondary-button" data-production-cancel-action type="button">Cancel</button>${current?.active?'<button class="production-action-button red" data-production-revoke="trial" type="button">End Current Reissue</button>':''}<button class="admin-primary-button" data-production-submit="trial" type="button">Issue New 14-Day Trial</button></div>`;
}
function renderPasswordResetAction(){
  const d=state.selectedUserDetail||{}, u=d.user||{}, authState=d.auth||{};
  const email=authState.email||u.email||'';
  $('productionActionKicker').textContent='Account Security';
  $('productionActionTitle').textContent='Send Password Reset Email';
  $('productionActionBody').innerHTML=`<div class="production-action-note"><strong>Recipient:</strong> ${esc(email||'No email available')}<br><br>This sends the same branded Rebatify password-reset email and secure reset page used by the normal customer password-reset flow. It does not set or reveal the customer’s password.</div>${authState.disabled?'<div class="production-warning"><strong>This Firebase Authentication account is disabled.</strong>A reset email cannot be sent until the account is enabled.</div>':''}${reasonField('Example: Customer requested password assistance through support')}<div class="production-action-footer"><button class="admin-secondary-button" data-production-cancel-action type="button">Cancel</button><button class="admin-primary-button" data-production-submit="password-reset" type="button" ${(!email||authState.disabled)?'disabled':''}>Send Reset Email</button></div>`;
}
function currentDurationPayload(){
  const preset=state.durationPreset;
  if(preset==='indefinite')return {duration:{mode:'indefinite'}};
  if(preset==='custom')return {duration:{mode:'custom',amount:Number($('productionCustomAmount')?.value||0),unit:$('productionCustomUnit')?.value||'days'}};
  return {duration:{mode:'preset',preset}};
}
async function submitAction(kind,button){
  const reason=String($('productionActionReason')?.value||'').trim(); if(!reason){setActionMessage('A reason is required for the audit log.','error');$('productionActionReason')?.focus();return;}
  button.disabled=true;const original=button.textContent;button.textContent='Saving…';
  try{
    let action='',payload={uid:state.action.uid,reason};
    if(kind==='premium'){action='premium-grant';Object.assign(payload,currentDurationPayload());}
    if(kind==='review'){action='review-grant';Object.assign(payload,currentDurationPayload());}
    if(kind==='trial'){action='trial-reissue';payload.deviceId=$('productionTrialDevice')?.value||'';}
    if(kind==='password-reset'){action='password-reset-send';}
    if(kind==='identity'){action='identity-link';payload.otherUid=$('productionIdentityOther')?.value||'';payload.label=String($('productionIdentityLabel')?.value||'').trim();if(!payload.otherUid){setActionMessage('Choose an account to link.','error');return;}}
    if(kind==='identity-unlink'){action='identity-unlink';payload.otherUid=state.action.otherUid||'';}
    await callProduction(action,payload);
    const reset=kind==='password-reset';
    setActionMessage(reset?'Password-reset email sent.':'Production access updated.','success');showProdToast(reset?'Password-reset email sent to the user.':'Production access updated.');
    const uid=state.action.uid;
    state.users=[];state.overview=null;
    if(kind!=='password-reset'&&kind!=='identity'&&kind!=='identity-unlink')state.access={premiumGrants:[],trialOverrides:[],reviewAccess:[]};
    if(kind==='identity'||kind==='identity-unlink'){state.identities=[];state.devices=[];}
    closeAction();
    const reloads=[loadOverview(true),loadUsers(true),loadAudit(true)];
    if(kind!=='password-reset'&&kind!=='identity'&&kind!=='identity-unlink')reloads.push(loadAccess(true));
    if(kind==='identity'||kind==='identity-unlink')reloads.push(loadIdentities(true),loadDevices(true));
    await Promise.all(reloads); await openUser(uid);
  }catch(error){setActionMessage(error.message,'error');}
  finally{button.disabled=false;button.textContent=original;}
}
async function revokeAction(kind,button){
  const reason=String($('productionActionReason')?.value||'').trim(); if(!reason){setActionMessage('Enter a reason before revoking access.','error');return;}
  button.disabled=true;const original=button.textContent;button.textContent='Revoking…';
  try{
    const map={premium:'premium-revoke',review:'review-revoke',trial:'trial-revoke'};
    const payload={uid:state.action.uid,reason};if(kind==='trial')payload.deviceId=$('productionTrialDevice')?.value||state.selectedUserDetail?.trial?.override?.deviceId||'';if(kind==='review')payload.source=button.dataset.reviewSource||'admin';
    await callProduction(map[kind],payload);showProdToast('Production access revoked.');
    const uid=state.action.uid; closeAction();state.users=[];state.overview=null;state.access={premiumGrants:[],trialOverrides:[],reviewAccess:[]};await Promise.all([loadOverview(true),loadUsers(true),loadAccess(true),loadAudit(true)]);await openUser(uid);
  }catch(error){setActionMessage(error.message,'error');}
  finally{button.disabled=false;button.textContent=original;}
}

async function refreshProduction(){
  const btn=$('productionAdminRefresh'); if(btn)btn.classList.add('is-spinning');
  try{state.overview=null;state.users=[];state.devices=[];state.identities=[];state.access={premiumGrants:[],trialOverrides:[],reviewAccess:[]};state.audit=[];await Promise.all([loadOverview(true),loadUsers(true),loadAccess(true)]);if(state.view==='devices')await loadDevices(true);if(state.view==='identities')await loadIdentities(true);if(state.view==='audit')await loadAudit(true);showProdToast('Production data refreshed.');}
  catch(error){showProdToast(error.message,'error');}
  finally{if(btn)btn.classList.remove('is-spinning');}
}

// Scope + production navigation
for(const b of document.querySelectorAll('[data-admin-scope]'))b.addEventListener('click',()=>setScope(b.dataset.adminScope));
for(const b of document.querySelectorAll('[data-production-view]'))b.addEventListener('click',()=>switchProductionView(b.dataset.productionView));
document.addEventListener('click',event=>{
  const jump=event.target.closest('[data-production-jump]');if(jump){switchProductionView(jump.dataset.productionJump,jump.dataset.productionFocus||'');return;}
  const user=event.target.closest('[data-production-user]');if(user){openUser(user.dataset.productionUser);return;}
  const quickLink=event.target.closest('[data-production-identity-quicklink]');if(quickLink){openAccessAction('identity',quickLink.dataset.baseUid);setTimeout(()=>renderIdentityAction(quickLink.dataset.productionIdentityQuicklink),0);return;}
  const unlink=event.target.closest('[data-production-identity-unlink]');if(unlink){openIdentityUnlinkAction(unlink.dataset.baseUid,unlink.dataset.productionIdentityUnlink);return;}
  const action=event.target.closest('[data-production-action]');if(action){openAccessAction(action.dataset.productionAction,action.dataset.uid);return;}
  const preset=event.target.closest('[data-duration-preset]');if(preset){state.durationPreset=preset.dataset.durationPreset;document.querySelectorAll('[data-duration-preset]').forEach(x=>x.classList.toggle('is-active',x.dataset.durationPreset===state.durationPreset));const custom=$('productionCustomDuration');if(custom)custom.hidden=state.durationPreset!=='custom';return;}
  if(event.target.closest('[data-production-cancel-action]')){closeAction();return;}
  const submit=event.target.closest('[data-production-submit]');if(submit){submitAction(submit.dataset.productionSubmit,submit);return;}
  const revoke=event.target.closest('[data-production-revoke]');if(revoke){revokeAction(revoke.dataset.productionRevoke,revoke);return;}
});
$('productionDrawerClose')?.addEventListener('click',closeUserDrawer);$('productionDrawerBackdrop')?.addEventListener('click',closeUserDrawer);
$('productionActionClose')?.addEventListener('click',closeAction);$('productionActionBackdrop')?.addEventListener('click',event=>{if(event.target===$('productionActionBackdrop'))closeAction();});
$('productionUserSearch')?.addEventListener('input',renderUsers);$('productionUserFilter')?.addEventListener('change',renderUsers);$('productionDeviceSearch')?.addEventListener('input',renderDevices);
$('productionAdminRefresh')?.addEventListener('click',refreshProduction);
$('productionWorkerSave')?.addEventListener('click',async()=>{
  const value=String($('productionWorkerUrl')?.value||'').trim().replace(/\/$/,'');
  if(!/^https:\/\//i.test(value)){productionMessage('Enter the HTTPS URL for the Production Admin Worker.','error');return;}
  localStorage.setItem(WORKER_KEY,value);state.endpoint=value;state.initialized=false;productionMessage('Checking secure production connection…');
  try{await initializeProduction(true);if(state.connected)showProdToast('Production Admin service connected.');}catch(error){productionMessage(error.message,'error');}
});

// Wait for the same authenticated Beta Admin identity already used by the existing admin portal.
onAuthStateChanged(auth,user=>{
  if(user&&isAdminUser(user)){
    state.endpoint=endpoint();fillSettings();
    // Beta remains the default on every fresh load to avoid accidental production actions.
    setScope('beta');
  }
});
