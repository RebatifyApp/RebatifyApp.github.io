import {
  firebaseConfigured,
  firebaseMissingFields,
  auth,
  db,
  isAdminUser,
  adminEmail,
  emailAutomationEnabled,
  timestampToDate,
  friendlyFirebaseError
} from './firebase-core.js';
import {
  onAuthStateChanged,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  collection,
  doc,
  getDocs,
  getDoc,
  getCountFromServer,
  query,
  where,
  orderBy,
  limit,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  deleteField
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

'use strict';

window.__REBATIFY_ADMIN_BOOT = window.__REBATIFY_ADMIN_BOOT || {};
window.__REBATIFY_ADMIN_BOOT.moduleLoaded = true;


const loading = document.getElementById('adminLoading');
const app = document.getElementById('adminApp');
const toast = document.getElementById('adminToast');
const portalContent = document.getElementById('adminPortalContent');
const passwordGate = document.getElementById('adminPasswordGate');
let activeView = 'overview';
let initialized = false;
const loadingStatus = document.getElementById('adminLoadingStatus');
function setLoadingStatus(message){ if(loadingStatus) loadingStatus.textContent = message; }
function withTimeout(promise, ms, label){
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error((label || 'Request') + ' timed out.');
      error.code = 'rebatify/timeout';
      reject(error);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
let emailWorkerEndpoint = '';

let state = {
  metrics: {},
  recentApplications: [],
  recentFeedback: [],
  applications: [],
  testers: [],
  feedback: [],
  loaded: { applications:false, testers:false, feedback:false }
};

function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function showFatal(message,detail=''){
  const safeMessage=esc(message||'The admin portal could not open.');
  const safeDetail=esc(detail||'');
  loading.innerHTML='<div class="admin-loading-mark"><img src="app-icon.png" alt=""></div><div style="max-width:620px;text-align:center;padding:0 24px"><h2 style="margin:10px 0 8px;color:#0b1831">Admin portal could not open</h2><p style="margin:0 0 8px;color:#5f6f86;font-weight:700">'+safeMessage+'</p>'+(safeDetail?'<p style="margin:0 0 18px;color:#7c8798;font-size:.92rem">'+safeDetail+'</p>':'')+'<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button type="button" onclick="location.reload()" class="admin-primary-button">Try Again</button><a href="admin-login.html" class="admin-secondary-button" style="text-decoration:none;display:inline-flex;align-items:center">Return to Sign In</a></div></div>';
}
function showToast(message,type='success'){
  toast.textContent=message;
  toast.className='admin-toast '+type;
  toast.hidden=false;
  clearTimeout(showToast.timer);
  showToast.timer=setTimeout(()=>{toast.hidden=true;},3800);
}
function formatDate(value){
  const d=timestampToDate(value); if(!d)return '—';
  return d.toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
}
function relativeDate(value){
  const d=timestampToDate(value); if(!d)return '—';
  const diff=Date.now()-d.getTime(); const m=Math.floor(diff/60000);
  if(m<1)return 'Just now'; if(m<60)return m+'m ago'; const h=Math.floor(m/60);
  if(h<24)return h+'h ago'; const days=Math.floor(h/24); if(days<8)return days+'d ago';
  return d.toLocaleDateString([], {month:'short',day:'numeric'});
}
function statusClass(status){return 'status-'+String(status||'').toLowerCase().replace(/[^a-z]+/g,'-');}
function iconSvg(name){
  const paths={
    feature:'<path d="m12 3 1.4 4.2L17.5 9l-4.1 1.8L12 15l-1.4-4.2L6.5 9l4.1-1.8L12 3ZM18.5 14.5l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    crash:'<path d="M13 2.8 5.7 13h5.2L10 21.2 18.3 10h-5.4L13 2.8Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>',
    confusing:'<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M9.7 9a2.5 2.5 0 0 1 4.8 1c0 2-2.5 2.2-2.5 4M12 17.5h.01" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
    general:'<path d="M5 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4.5 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M8 10h8M8 13h5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
    bug:'<rect x="7" y="7" width="10" height="11" rx="4" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M9.5 7V5.5a2.5 2.5 0 0 1 5 0V7M4 10h3M17 10h3M4 14h3M17 14h3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(paths[name]||paths.bug)+'</svg>';
}
function typeIcon(type){if(type==='Feature Request')return iconSvg('feature');if(type==='Crash / Performance')return iconSvg('crash');if(type==='Confusing Experience')return iconSvg('confusing');if(type==='General Feedback')return iconSvg('general');return iconSvg('bug');}
function normalizeDoc(snap){return { id:snap.id, row:snap.id, ...snap.data() };}
function isEnabledStatus(status){return ['Approved','Active'].includes(status);}

function confirmAction(message,tone){
  return new Promise(resolve=>{
    const back=document.getElementById('adminConfirmBackdrop');
    const msg=document.getElementById('adminConfirmMessage');
    const icon=document.getElementById('adminConfirmIcon');
    const ok=document.getElementById('adminConfirmOk');
    const cancel=document.getElementById('adminConfirmCancel');
    msg.textContent=message; icon.textContent=tone==='danger'?'!':'✓'; icon.className='admin-confirm-icon '+(tone==='danger'?'danger':'');
    ok.textContent=tone==='danger'?'Confirm':'Continue'; ok.className='admin-primary-button'+(tone==='danger'?' admin-confirm-danger':''); back.hidden=false;
    function done(v){back.hidden=true;ok.removeEventListener('click',yes);cancel.removeEventListener('click',no);back.removeEventListener('click',outside);resolve(v);}
    function yes(){done(true);} function no(){done(false);} function outside(e){if(e.target===back)done(false);}
    ok.addEventListener('click',yes);cancel.addEventListener('click',no);back.addEventListener('click',outside);
  });
}

async function countQuery(ref){const snap=await getCountFromServer(ref);return snap.data().count||0;}
async function loadMetrics(){
  const apps=collection(db,'betaApplications');
  const feedback=collection(db,'betaFeedback');
  const [total,applied,approved,active,waitlist,declined,inactive,ios,android,newFeedback]=await Promise.all([
    countQuery(apps),
    countQuery(query(apps,where('status','==','Applied'))),
    countQuery(query(apps,where('status','==','Approved'))),
    countQuery(query(apps,where('status','==','Active'))),
    countQuery(query(apps,where('status','==','Waitlist'))),
    countQuery(query(apps,where('status','==','Declined'))),
    countQuery(query(apps,where('status','==','Inactive'))),
    countQuery(query(apps,where('platform','==','iOS'))),
    countQuery(query(apps,where('platform','==','Android'))),
    countQuery(query(feedback,where('status','==','New')))
  ]);
  state.metrics={total,applied,approved,active,waitlist,declined,inactive,ios,android,newFeedback};
}
async function loadRecent(){
  const [appsSnap,fbSnap]=await Promise.all([
    getDocs(query(collection(db,'betaApplications'),orderBy('submittedAt','desc'),limit(5))),
    getDocs(query(collection(db,'betaFeedback'),orderBy('submittedAt','desc'),limit(5)))
  ]);
  state.recentApplications=appsSnap.docs.map(normalizeDoc);
  state.recentFeedback=fbSnap.docs.map(normalizeDoc);
}
async function loadOverview(){await Promise.all([loadMetrics(),loadRecent()]);renderMetrics();renderOverview();}
async function loadApplications(force=false){
  if(state.loaded.applications&&!force){renderApplications();return;}
  const snap=await getDocs(query(collection(db,'betaApplications'),orderBy('submittedAt','desc'),limit(100)));
  state.applications=snap.docs.map(normalizeDoc);state.loaded.applications=true;renderApplications();
}
async function loadTesters(force=false){
  if(state.loaded.testers&&!force){renderTesters();return;}
  const snap=await getDocs(query(collection(db,'betaUsers'),orderBy('createdAt','desc'),limit(100)));
  state.testers=snap.docs.map(s=>({uid:s.id,...s.data()}));state.loaded.testers=true;renderTesters();
}
async function loadFeedback(force=false){
  if(state.loaded.feedback&&!force){renderFeedback();return;}
  const snap=await getDocs(query(collection(db,'betaFeedback'),orderBy('submittedAt','desc'),limit(100)));
  state.feedback=snap.docs.map(normalizeDoc);state.loaded.feedback=true;renderFeedback();
}

function renderMetrics(){
  const m=state.metrics||{};const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v==null?0:v;};
  set('metricApplied',m.applied);set('metricApproved',m.approved);set('metricActive',m.active);set('metricFeedback',m.newFeedback);
  set('metricWaitlist',m.waitlist);set('metricDeclined',m.declined);set('metricInactive',m.inactive);set('iosCount',m.ios);set('androidCount',m.android);
  set('navPendingCount',m.applied);set('navFeedbackCount',m.newFeedback);
  const total=Number(m.total||0);set('platformTotal',total+' applicant'+(total===1?'':'s'));
  document.getElementById('iosBar').style.width=(total?Math.round(Number(m.ios||0)/total*100):0)+'%';
  document.getElementById('androidBar').style.width=(total?Math.round(Number(m.android||0)/total*100):0)+'%';
}
function renderOverview(){
  const apps=state.recentApplications||[];const c=document.getElementById('overviewApplications');
  c.innerHTML=apps.length?apps.map(a=>`<button type="button" class="admin-recent-row" data-open-app="${esc(a.id)}"><span class="admin-person-dot">${esc((a.fullName||'?').slice(0,1).toUpperCase())}</span><span><strong>${esc(a.fullName)}</strong><small>${esc(a.platform)} · ${relativeDate(a.submittedAt)}</small></span><span class="admin-status-pill ${statusClass(a.status)}">${esc(a.status)}</span></button>`).join(''):'<div class="admin-empty-inline">No applications yet.</div>';
  const fb=state.recentFeedback||[];const fbc=document.getElementById('overviewFeedback');
  fbc.innerHTML=fb.length?fb.map(f=>`<button class="admin-feedback-preview" type="button" data-open-feedback="${esc(f.id)}"><span class="admin-feedback-icon">${typeIcon(f.type)}</span><span class="admin-feedback-preview-copy"><strong>${esc(f.subject)}</strong><small>${esc(f.name)} · ${esc(f.type)} · ${relativeDate(f.submittedAt)}</small></span><span class="admin-status-pill ${statusClass(f.status)}">${esc(f.status)}</span></button>`).join(''):'<div class="admin-empty-inline">No tester feedback yet.</div>';
}
function applicationFiltered(){
  const q=document.getElementById('applicationSearch').value.trim().toLowerCase();const status=document.getElementById('applicationStatusFilter').value;const platform=document.getElementById('applicationPlatformFilter').value;
  return state.applications.filter(a=>(!q||((a.fullName||'')+' '+(a.email||'')).toLowerCase().includes(q))&&(!status||a.status===status)&&(!platform||a.platform===platform));
}
function renderApplications(){
  const data=applicationFiltered();const body=document.getElementById('applicationsTableBody');
  body.innerHTML=data.map(a=>`<tr><td><div class="admin-table-person"><span>${esc((a.fullName||'?').slice(0,1).toUpperCase())}</span><div><strong>${esc(a.fullName)}</strong><small>${esc(a.email)}</small></div></div></td><td><span class="admin-platform-pill">${esc(a.platform)}</span></td><td>${esc(relativeDate(a.submittedAt))}</td><td><span class="admin-status-pill ${statusClass(a.status)}">${esc(a.status)}</span></td><td>${esc(a.portalAccess||'Not Enabled')}</td><td><span class="admin-email-status ${esc(String(a.inviteEmailStatus||'').toLowerCase())}">${esc(a.inviteEmailStatus||'Not sent')}</span></td><td><button class="admin-table-open" data-open-app="${esc(a.id)}" type="button">View</button></td></tr>`).join('');
  document.getElementById('applicationsEmpty').hidden=data.length>0;
}
function testerFiltered(){
  const q=document.getElementById('testerSearch').value.trim().toLowerCase();const access=document.getElementById('testerAccessFilter').value;
  return state.testers.filter(t=>(!q||((t.name||'')+' '+(t.email||'')).toLowerCase().includes(q))&&(!access||t.accessStatus===access));
}
function renderTesters(){
  const data=testerFiltered();const body=document.getElementById('testersTableBody');
  body.innerHTML=data.map(t=>`<tr><td><div class="admin-table-person"><span>${esc((t.name||'?').slice(0,1).toUpperCase())}</span><div><strong>${esc(t.name)}</strong><small>${esc(t.email)}</small></div></div></td><td><span class="admin-platform-pill">${esc(t.platform)}</span></td><td><span class="admin-status-pill ${t.accessStatus==='Enabled'?'status-active':'status-inactive'}">${esc(t.accessStatus||'Disabled')}</span></td><td>${esc(t.lastLogin?relativeDate(t.lastLogin):'Never')}</td><td>Email verification code</td><td><button class="admin-table-open" data-open-tester="${esc(t.uid)}" type="button">Manage</button></td></tr>`).join('');
  document.getElementById('testersEmpty').hidden=data.length>0;
}
function feedbackFiltered(){
  const q=document.getElementById('feedbackSearch').value.trim().toLowerCase();const status=document.getElementById('feedbackStatusFilter').value;const type=document.getElementById('feedbackTypeFilter').value;
  return state.feedback.filter(f=>(!q||((f.subject||'')+' '+(f.name||'')+' '+(f.email||'')+' '+(f.details||'')).toLowerCase().includes(q))&&(!status||f.status===status)&&(!type||f.type===type));
}
function renderFeedback(){
  const data=feedbackFiltered();const list=document.getElementById('feedbackList');
  list.innerHTML=data.map(f=>`<button class="admin-feedback-card" type="button" data-open-feedback="${esc(f.id)}"><span class="admin-feedback-icon">${typeIcon(f.type)}</span><span class="admin-feedback-card-main"><span class="admin-feedback-card-top"><strong>${esc(f.subject)}</strong><span class="admin-status-pill ${statusClass(f.status)}">${esc(f.status)}</span></span><span class="admin-feedback-card-meta">${esc(f.name)} · ${esc(f.platform)} · ${relativeDate(f.submittedAt)}</span><span class="admin-feedback-card-preview">${esc(f.details)}</span></span><span class="admin-feedback-chevron">›</span></button>`).join('');
  document.getElementById('feedbackEmpty').hidden=data.length>0;
}

async function switchView(view){
  activeView=view;document.body.classList.remove('admin-nav-open');
  document.querySelectorAll('[data-admin-view]').forEach(b=>b.classList.toggle('is-active',b.dataset.adminView===view));
  document.querySelectorAll('[data-admin-panel]').forEach(p=>p.classList.toggle('is-active',p.dataset.adminPanel===view));
  const titles={overview:'Overview',applications:'Applications',testers:'Testers',feedback:'Feedback'};document.getElementById('adminViewTitle').textContent=titles[view]||'Overview';
  try{
    if(view==='applications')await loadApplications();
    if(view==='testers')await loadTesters();
    if(view==='feedback')await loadFeedback();
  }catch(e){showToast('Could not load '+view+'. '+friendlyFirebaseError(e),'error');}
}
function openDrawer(kicker,title,html){document.getElementById('drawerKicker').textContent=kicker;document.getElementById('drawerTitle').textContent=title;document.getElementById('adminDrawerContent').innerHTML=html;document.getElementById('adminDrawerBackdrop').hidden=false;document.getElementById('adminDrawer').classList.add('is-open');document.getElementById('adminDrawer').setAttribute('aria-hidden','false');}
function closeDrawer(){document.getElementById('adminDrawerBackdrop').hidden=true;document.getElementById('adminDrawer').classList.remove('is-open');document.getElementById('adminDrawer').setAttribute('aria-hidden','true');}
function findApp(id){return state.applications.find(a=>a.id===id)||state.recentApplications.find(a=>a.id===id);}
function findFeedback(id){return state.feedback.find(f=>f.id===id)||state.recentFeedback.find(f=>f.id===id);}
function findTester(uid){return state.testers.find(t=>t.uid===uid);}

async function ensureApplicationLoaded(id){
  let a=findApp(id);if(a)return a;await loadApplications();return findApp(id);
}
async function ensureFeedbackLoaded(id){let f=findFeedback(id);if(f)return f;await loadFeedback();return findFeedback(id);}
function applicationActionButtons(a){
  const status=String(a.status||'Applied');
  const buttons=[];
  const btn=(cls,action,label)=>`<button class="admin-action-button ${cls||''}" data-app-action="${action}" data-row="${esc(a.id)}" type="button">${label}</button>`;
  if(['Applied','Waitlist','Declined'].includes(status)){
    buttons.push(btn('approve','approve','Approve & Send Invite'));
    if(status!=='Waitlist')buttons.push(btn('','waitlist','Waitlist'));
    if(status!=='Declined')buttons.push(btn('danger','decline','Decline'));
  }else if(status==='Approved'){
    buttons.push(btn('approve','resend','Resend Portal Invitation'));
    buttons.push(btn('danger-soft','inactive','Disable Access'));
  }else if(status==='Active'){
    buttons.push(btn('danger-soft','inactive','Disable Access'));
  }else if(status==='Inactive'){
    buttons.push(btn('approve','active','Enable Access'));
  }
  buttons.push(btn('danger-soft','delete','Delete Application'));
  return buttons.join('');
}
function openApplicationRecord(a){
  openDrawer('Beta Application',a.fullName,`<div class="admin-detail-stack"><div class="admin-detail-status-row"><span class="admin-status-pill ${statusClass(a.status)}">${esc(a.status)}</span><span class="admin-platform-pill">${esc(a.platform)}</span></div><div class="admin-detail-grid"><div><span>Email</span><strong>${esc(a.email)}</strong></div><div><span>Submitted</span><strong>${esc(formatDate(a.submittedAt))}</strong></div><div><span>Terms</span><strong>${a.termsAccepted?'Accepted':'—'}</strong></div><div><span>Portal Access</span><strong>${esc(a.portalAccess||'Not Enabled')}</strong></div><div><span>Last Updated</span><strong>${esc(formatDate(a.lastUpdated))}</strong></div><div><span>Invite Email</span><strong>${esc(formatDate(a.inviteEmailSentAt||a.lastDecisionEmail))}</strong></div><div><span>Email Delivery</span><strong><span class="admin-email-status ${esc(String(a.inviteEmailStatus||'').toLowerCase())}">${esc(a.inviteEmailStatus||'Not sent')}</span></strong></div></div><div><label class="admin-detail-label" for="drawerApplicantNotes">Private admin notes</label><textarea id="drawerApplicantNotes" class="admin-detail-textarea" placeholder="Notes only administrators can see">${esc(a.notes||'')}</textarea><button class="admin-secondary-button admin-save-notes" data-save-app-notes="${esc(a.id)}" type="button">Save Notes</button></div><div class="admin-drawer-actions">${applicationActionButtons(a)}</div></div>`);
}
function openTesterRecord(t){
  const normalizedEmail=String(t.email||'').trim().toLowerCase();
  const a=state.applications.find(x=>x.testerUid===t.uid||String(x.email||'').trim().toLowerCase()===normalizedEmail);
  const accessAction=a
    ? (t.accessStatus==='Enabled'
      ? `<button class="admin-action-button danger-soft" data-app-action="inactive" data-row="${esc(a.id)}" type="button">Disable Access</button>`
      : `<button class="admin-action-button approve" data-app-action="active" data-row="${esc(a.id)}" type="button">Enable Access</button>`)
    : '';
  const deleteAction=a
    ? `<button class="admin-action-button danger-soft" data-app-action="delete" data-row="${esc(a.id)}" type="button">Delete Application & Tester</button>`
    : `<button class="admin-action-button danger-soft" data-tester-action="delete" data-tester-uid="${esc(t.uid)}" type="button">Delete Tester</button>`;
  const actions=[accessAction,deleteAction].filter(Boolean).join('');
  openDrawer('Tester Access',t.name,`<div class="admin-detail-stack"><div class="admin-detail-status-row"><span class="admin-status-pill ${t.accessStatus==='Enabled'?'status-active':'status-inactive'}">${esc(t.accessStatus)}</span><span class="admin-platform-pill">${esc(t.platform)}</span></div><div class="admin-detail-grid"><div><span>Email</span><strong>${esc(t.email)}</strong></div><div><span>Created</span><strong>${esc(formatDate(t.createdAt))}</strong></div><div><span>Last Login</span><strong>${esc(t.lastLogin?formatDate(t.lastLogin):'Never')}</strong></div><div><span>Authentication</span><strong>Email verification code</strong></div></div><div class="admin-drawer-actions">${actions}</div></div>`);
}
function openFeedbackRecord(f){
  const statuses=['New','Reviewing','Planned','Fixed','Closed','Declined'];
  openDrawer('Tester Feedback',f.subject,`<div class="admin-detail-stack"><div class="admin-detail-status-row"><span class="admin-feedback-type-chip">${esc(f.type)}</span><span class="admin-platform-pill">${esc(f.platform)}</span></div><div class="admin-detail-grid"><div><span>Tester</span><strong>${esc(f.name)}</strong><small>${esc(f.email)}</small></div><div><span>Submitted</span><strong>${esc(formatDate(f.submittedAt))}</strong></div><div><span>App Version / Build</span><strong>${esc(f.appVersion||'Not provided')}</strong></div><div><span>Device / OS</span><strong>${esc(f.deviceDetails||'Not provided')}</strong></div><div><span>Page / Feature</span><strong>${esc(f.pageFeature||'Not provided')}</strong></div></div><div class="admin-feedback-detail"><span>Feedback</span><p>${esc(f.details)}</p></div><div class="beta-field"><label for="drawerFeedbackStatus">Status</label><select id="drawerFeedbackStatus" class="admin-detail-select">${statuses.map(s=>`<option${s===f.status?' selected':''}>${s}</option>`).join('')}</select></div><div><label class="admin-detail-label" for="drawerFeedbackNotes">Private admin notes</label><textarea id="drawerFeedbackNotes" class="admin-detail-textarea" placeholder="Internal notes, next steps, reproduction details…">${esc(f.adminNotes||'')}</textarea></div><button class="admin-primary-button" data-save-feedback="${esc(f.id)}" type="button">Save Feedback Update</button></div>`);
}

function updateMetricTransition(oldStatus,newStatus,platform){
  const map={Applied:'applied',Approved:'approved',Active:'active',Waitlist:'waitlist',Declined:'declined',Inactive:'inactive'};
  if(map[oldStatus]&&state.metrics[map[oldStatus]]>0)state.metrics[map[oldStatus]]--;
  if(map[newStatus])state.metrics[map[newStatus]]=(state.metrics[map[newStatus]]||0)+1;
  renderMetrics();
}
function normalizeWorkerUrl(value){
  const raw=String(value||'').trim().replace(/\/+$/,'');
  if(!raw)return '';
  try{const u=new URL(raw);return u.protocol==='https:'?u.toString().replace(/\/$/,''):'';}catch(_){return '';}
}
function renderEmailServiceSettings(){
  const input=document.getElementById('emailWorkerUrl');
  const status=document.getElementById('emailWorkerStatus');
  if(input)input.value=emailWorkerEndpoint;
  if(status){status.textContent=emailWorkerEndpoint?'Connected':'Not connected';status.className='admin-subtle-chip '+(emailWorkerEndpoint?'admin-service-connected':'admin-service-disconnected');}
}
async function loadEmailServiceSettings(){
  try{
    const snap=await getDoc(doc(db,'betaSystem','emailService'));
    emailWorkerEndpoint=snap.exists()?normalizeWorkerUrl(snap.data().workerUrl):'';
  }catch(_){emailWorkerEndpoint='';}
  renderEmailServiceSettings();
}
async function saveEmailServiceSettings(){
  const input=document.getElementById('emailWorkerUrl');
  const value=normalizeWorkerUrl(input&&input.value);
  if(!value)throw new Error('Enter the full HTTPS workers.dev URL from Cloudflare.');
  await setDoc(doc(db,'betaSystem','emailService'),{workerUrl:value,updatedAt:serverTimestamp()},{merge:true});
  emailWorkerEndpoint=value;
  renderEmailServiceSettings();
}
async function sendWorkerEmail(type,a){
  if(!emailWorkerEndpoint){const err=new Error('Connect the Cloudflare email Worker in Admin Overview before sending invitations.');err.code='rebatify/email-not-configured';throw err;}
  if(!auth.currentUser){const err=new Error('Administrator session expired.');err.code='auth/invalid-credential';throw err;}
  const token=await auth.currentUser.getIdToken();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(emailWorkerEndpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({type,name:a.fullName||'',email:a.email||'',platform:a.platform||''}),signal:controller.signal});
    let payload={};try{payload=await response.json();}catch(_){}
    if(!response.ok||payload.ok!==true){const err=new Error(payload.error||'The Rebatify email service could not send this message.');err.code='rebatify/email-send-failed';throw err;}
    return payload;
  }finally{clearTimeout(timer);}
}
async function callWorkerAdminAction(type,payload={}){
  if(!emailWorkerEndpoint){const err=new Error('Connect the Cloudflare service in Admin Overview before deleting tester accounts.');err.code='rebatify/service-not-configured';throw err;}
  if(!auth.currentUser){const err=new Error('Administrator session expired.');err.code='auth/invalid-credential';throw err;}
  const token=await auth.currentUser.getIdToken();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(emailWorkerEndpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({type,...payload}),signal:controller.signal});
    let result={};try{result=await response.json();}catch(_){ }
    if(!response.ok||result.ok!==true){const err=new Error(result.error||'The Rebatify admin service could not complete this action.');err.code='rebatify/admin-action-failed';throw err;}
    return result;
  }finally{clearTimeout(timer);}
}
async function provisionTesterAccess(a){
  const result = await callWorkerAdminAction('admin-provision-beta-user', {
    email: String(a.email || '').toLowerCase(),
    name: a.fullName || '',
    platform: a.platform || ''
  });
  const uid = String(result.uid || '').trim();
  if (!uid) throw new Error('The Rebatify admin service did not return a tester account ID.');

  const userRef = doc(db, 'betaUsers', uid);
  const existing = await getDoc(userRef);
  const existingData = existing.exists() ? existing.data() : {};
  await setDoc(userRef, {
    name: a.fullName || '',
    email: String(a.email || '').toLowerCase(),
    platform: a.platform || '',
    status: 'Approved',
    accessStatus: 'Enabled',
    applicationId: a.id,
    authMethod: 'Email verification code',
    createdAt: existingData.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastLogin: existingData.lastLogin || null
  }, { merge: true });

  if (a.inviteId) await deleteDoc(doc(db,'betaInvites',a.inviteId)).catch(()=>{});
  await updateDoc(doc(db,'betaApplications',a.id),{
    status:'Approved',
    portalAccess:'Enabled',
    testerUid:uid,
    inviteId:deleteField(),
    inviteEmailStatus:'Sending',
    lastUpdated:serverTimestamp()
  });
  a.status='Approved';
  a.portalAccess='Enabled';
  a.testerUid=uid;
  a.inviteId='';
  a.inviteEmailStatus='Sending';
  a.lastUpdated=new Date();
  return uid;
}
async function queueDecisionEmail(a,status){
  if(!emailAutomationEnabled||!emailWorkerEndpoint)return false;
  const map={Waitlist:'waitlist',Declined:'declined',Inactive:'inactive'};
  const type=map[status];if(!type)return false;
  await sendWorkerEmail(type,a);return true;
}

async function approveApplicant(a){
  const old=a.status;
  await provisionTesterAccess(a);
  if(old!=='Approved')updateMetricTransition(old,'Approved',a.platform);
  try{
    await sendWorkerEmail('invite',a);
    await updateDoc(doc(db,'betaApplications',a.id),{inviteEmailStatus:'Sent',inviteEmailSentAt:serverTimestamp(),lastDecisionEmail:serverTimestamp(),lastUpdated:serverTimestamp()});
    a.inviteEmailStatus='Sent';a.inviteEmailSentAt=new Date();a.lastDecisionEmail=new Date();
  }catch(error){
    await updateDoc(doc(db,'betaApplications',a.id),{inviteEmailStatus:'Error',lastUpdated:serverTimestamp()}).catch(()=>{});
    a.inviteEmailStatus='Error';
    error.rebatifyApprovalCompleted=true;
    throw error;
  }
}

async function statusAction(a,newStatus,portalAccess){
  const old=a.status;const changes={status:newStatus,portalAccess,lastUpdated:serverTimestamp()};
  if(['Waitlist','Declined','Inactive'].includes(newStatus))changes.lastDecisionEmail=serverTimestamp();
  await updateDoc(doc(db,'betaApplications',a.id),changes);
  if(a.testerUid){
    const accessStatus=portalAccess==='Enabled'?'Enabled':'Disabled';
    await updateDoc(doc(db,'betaUsers',a.testerUid),{status:newStatus,accessStatus,updatedAt:serverTimestamp()});
    if(state.loaded.testers){const t=state.testers.find(x=>x.uid===a.testerUid);if(t){t.status=newStatus;t.accessStatus=accessStatus;renderTesters();}}
  }
  if(['Waitlist','Declined','Inactive'].includes(newStatus))await queueDecisionEmail(a,newStatus).catch(()=>{});
  a.status=newStatus;a.portalAccess=portalAccess;a.lastUpdated=new Date();updateMetricTransition(old,newStatus,a.platform);
}
async function resendInvite(a){
  if(!a.testerUid || a.portalAccess!=='Enabled') await provisionTesterAccess(a);
  try{
    await sendWorkerEmail('invite',a);
    await updateDoc(doc(db,'betaApplications',a.id),{inviteEmailStatus:'Sent',inviteEmailSentAt:serverTimestamp(),lastDecisionEmail:serverTimestamp(),lastUpdated:serverTimestamp()});
    a.inviteEmailStatus='Sent';a.inviteEmailSentAt=new Date();a.lastDecisionEmail=new Date();
  }catch(error){
    await updateDoc(doc(db,'betaApplications',a.id),{inviteEmailStatus:'Error',lastUpdated:serverTimestamp()}).catch(()=>{});
    a.inviteEmailStatus='Error';
    throw error;
  }
}
async function deleteTesterRecordsByEmail(email){
  const normalizedEmail=String(email||'').trim().toLowerCase();
  if(!normalizedEmail)return 0;
  const snap=await getDocs(query(collection(db,'betaUsers'),where('email','==',normalizedEmail)));
  await Promise.all(snap.docs.map(d=>deleteDoc(d.ref)));
  if(state.loaded.testers){
    const removedIds=new Set(snap.docs.map(d=>d.id));
    state.testers=state.testers.filter(t=>!removedIds.has(t.uid)&&String(t.email||'').trim().toLowerCase()!==normalizedEmail);
    renderTesters();
  }
  return snap.size;
}
async function deleteTesterOnly(t){
  const email=String(t.email||'').trim().toLowerCase();
  await callWorkerAdminAction('admin-delete-auth-user',{email});
  await deleteTesterRecordsByEmail(email);
}
async function deleteApplication(a){
  // A deleted application must leave no stale portal identity behind. Clean up
  // the Auth user plus every betaUsers document for this email, including
  // duplicate records left by earlier beta builds/tests.
  const email=String(a.email||'').trim().toLowerCase();
  await callWorkerAdminAction('admin-delete-auth-user',{email});
  await deleteTesterRecordsByEmail(email);
  if(a.testerUid){
    await deleteDoc(doc(db,'betaUsers',a.testerUid)).catch(()=>{});
  }
  if(a.inviteId)await deleteDoc(doc(db,'betaInvites',a.inviteId)).catch(()=>{});
  await deleteDoc(doc(db,'betaApplications',a.id));
  state.applications=state.applications.filter(x=>x.id!==a.id);
  state.recentApplications=state.recentApplications.filter(x=>x.id!==a.id);
  state.loaded.applications=false;
  await loadOverview();
  if(activeView==='applications')await loadApplications(true);
  if(activeView==='testers')await loadTesters(true);
}


async function refreshActiveView(){
  if(!isAdminUser(auth.currentUser)){
    showToast('Your administrator session changed. Sign in to the Rebatify Beta Program Admin again.','error');
    setTimeout(()=>location.replace('admin-login.html?error=access'),700);
    return;
  }
  document.getElementById('adminRefresh').classList.add('is-spinning');
  try{
    await loadOverview();
    if(activeView==='applications')await loadApplications(true);
    if(activeView==='testers')await loadTesters(true);
    if(activeView==='feedback')await loadFeedback(true);
  }catch(e){showToast('Could not refresh beta data. '+friendlyFirebaseError(e),'error');}
  finally{document.getElementById('adminRefresh').classList.remove('is-spinning');}
}

async function init(user){
  document.getElementById('adminIdentityEmail').textContent=user.email||adminEmail;
  if(passwordGate)passwordGate.remove();
  if(portalContent)portalContent.classList.remove('admin-content-locked');

  // Never make the whole portal wait for Firestore. Authentication opens the shell;
  // dashboard data loads on demand in the background.
  loading.hidden=true;
  loading.style.display='none';
  app.hidden=false;
  app.style.display='';

  try{
    await loadEmailServiceSettings();
    await withTimeout(loadOverview(), 12000, 'Dashboard data');
  }catch(error){
    const detail = error && error.code === 'rebatify/timeout'
      ? 'Firebase Authentication succeeded, but Firestore did not respond within 12 seconds. Check that the Firestore database exists and the Rebatify security rules are published.'
      : friendlyFirebaseError(error);
    showToast('Admin opened, but dashboard data could not load. ' + detail, 'error');
    console.error('Rebatify admin overview load failed:', error);
  }
}

if(!firebaseConfigured){
  window.__REBATIFY_ADMIN_BOOT.authResolved = true;
  showFatal('The Rebatify Beta Program data service has not been configured yet.','Missing: '+firebaseMissingFields.join(', '));
}else{
  setLoadingStatus('Restoring your secure administrator session…');
  const authTimer=setTimeout(()=>{
    if(initialized)return;
    initialized=true;
    window.__REBATIFY_ADMIN_BOOT.authResolved = false;
    showFatal('Administrator sign-in did not finish.','Firebase Authentication did not restore a session within 12 seconds. Return to Sign In, sign in again, and retry.');
  },12000);
  onAuthStateChanged(auth,async user=>{
    if(initialized)return;
    initialized=true;
    clearTimeout(authTimer);
    window.__REBATIFY_ADMIN_BOOT.authResolved = true;
    if(!user||!isAdminUser(user)){
      await signOut(auth).catch(()=>{});
      location.replace('admin-login.html?error=access');
      return;
    }
    setLoadingStatus('Opening your admin workspace…');
    await init(user);
  }, error=>{
    if(initialized)return;
    initialized=true;
    clearTimeout(authTimer);
    window.__REBATIFY_ADMIN_BOOT.authResolved = true;
    showFatal('Firebase Authentication could not initialize.',friendlyFirebaseError(error));
  });
}

document.addEventListener('click',async e=>{
  const nav=e.target.closest('[data-admin-view]');if(nav){await switchView(nav.dataset.adminView);return;}
  const jump=e.target.closest('[data-jump-view]');if(jump){await switchView(jump.dataset.jumpView);return;}
  const appBtn=e.target.closest('[data-open-app]');if(appBtn){try{const a=await ensureApplicationLoaded(appBtn.dataset.openApp);if(a)openApplicationRecord(a);}catch(err){showToast('Could not open that application.','error');}return;}
  const testerBtn=e.target.closest('[data-open-tester]');if(testerBtn){if(!state.loaded.applications)await loadApplications();const t=findTester(testerBtn.dataset.openTester);if(t)openTesterRecord(t);return;}
  const feedbackBtn=e.target.closest('[data-open-feedback]');if(feedbackBtn){try{const f=await ensureFeedbackLoaded(feedbackBtn.dataset.openFeedback);if(f)openFeedbackRecord(f);}catch(err){showToast('Could not open that feedback.','error');}return;}
  const noteBtn=e.target.closest('[data-save-app-notes]');if(noteBtn){const a=await ensureApplicationLoaded(noteBtn.dataset.saveAppNotes);if(!a)return;const notes=document.getElementById('drawerApplicantNotes').value;try{await updateDoc(doc(db,'betaApplications',a.id),{notes,lastUpdated:serverTimestamp()});a.notes=notes;a.lastUpdated=new Date();showToast('Private notes saved.');}catch(err){showToast(friendlyFirebaseError(err),'error');}return;}
  const fbSave=e.target.closest('[data-save-feedback]');if(fbSave){const f=await ensureFeedbackLoaded(fbSave.dataset.saveFeedback);if(!f)return;const status=document.getElementById('drawerFeedbackStatus').value;const notes=document.getElementById('drawerFeedbackNotes').value;try{await updateDoc(doc(db,'betaFeedback',f.id),{status,adminNotes:notes,updatedAt:serverTimestamp()});if(f.status==='New'&&status!=='New'&&state.metrics.newFeedback>0)state.metrics.newFeedback--;if(f.status!=='New'&&status==='New')state.metrics.newFeedback++;f.status=status;f.adminNotes=notes;f.updatedAt=new Date();renderMetrics();renderFeedback();renderOverview();showToast('Feedback updated.');openFeedbackRecord(f);}catch(err){showToast(friendlyFirebaseError(err),'error');}return;}
  const emailSave=e.target.closest('[data-save-email-worker]');if(emailSave){emailSave.disabled=true;const original=emailSave.textContent;emailSave.textContent='Saving…';try{await saveEmailServiceSettings();showToast('Cloudflare email service connected.');}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{emailSave.disabled=false;emailSave.textContent=original;}return;}
  const testerActionBtn=e.target.closest('[data-tester-action]');if(testerActionBtn){
    const task=testerActionBtn.dataset.testerAction;
    const uid=testerActionBtn.dataset.testerUid;
    const t=findTester(uid);
    if(task==='delete'&&t){
      const confirmation='Permanently delete this tester portal record and Firebase Authentication login? This removes every tester record using '+String(t.email||'this email')+'.';
      if(!(await confirmAction(confirmation,'danger')))return;
      testerActionBtn.disabled=true;
      try{
        await deleteTesterOnly(t);
        closeDrawer();
        showToast('Tester portal record and login deleted.');
        if(activeView==='testers')await loadTesters(true);
      }catch(err){
        showToast(friendlyFirebaseError(err),'error');
      }finally{testerActionBtn.disabled=false;}
    }
    return;
  }
  const actionBtn=e.target.closest('[data-app-action]');if(actionBtn){
    const task=actionBtn.dataset.appAction;const id=actionBtn.dataset.row;if(!id){showToast('Could not find the tester application record.','error');return;}
    const a=await ensureApplicationLoaded(id);if(!a)return;
    const notification=(emailAutomationEnabled&&emailWorkerEndpoint)?' and notify them':'';
    const deleteNote=' This also deletes the tester portal profile and Firebase Authentication login for this email so the address can be used again later.';
    const confirmation={
      approve:'Approve this tester, enable passwordless Beta Program Portal access, and send the branded invitation?',
      waitlist:'Move this applicant to the waitlist'+notification+'?',
      decline:'Decline this application'+notification+'?',
      resend:'Send the branded Rebatify Beta Program Portal invitation again?',
      inactive:'Disable this tester’s portal access'+notification+'?',
      active:'Enable access and mark this tester active?',
      delete:'Permanently delete this Rebatify Beta Program application?'+deleteNote+' Any duplicate tester records using the same email will also be removed.'
    }[task];
    if(confirmation&&!(await confirmAction(confirmation,['decline','inactive','delete'].includes(task)?'danger':'')))return;
    actionBtn.disabled=true;
    try{
      if(task==='approve')await approveApplicant(a);
      if(task==='waitlist')await statusAction(a,'Waitlist','Disabled');
      if(task==='decline')await statusAction(a,'Declined','Disabled');
      if(task==='inactive')await statusAction(a,'Inactive','Disabled');
      if(task==='active')await statusAction(a,'Active','Enabled');
      if(task==='resend')await resendInvite(a);
      if(task==='delete')await deleteApplication(a);
      if(task!=='delete'){if(state.loaded.applications)renderApplications();renderOverview();}
      const messages={approve:'Tester approved, passwordless portal access enabled, and the branded invitation was sent.',resend:'Branded Rebatify Beta Program Portal invitation sent.',waitlist:'Applicant moved to the waitlist.',decline:'Application declined.',inactive:'Tester access disabled.',active:'Tester marked active.',delete:'Application, all matching tester profiles, and login deleted.'};
      showToast(messages[task]||'Tester record updated.');closeDrawer();
    }catch(err){
      if(task==='approve'&&err&&err.rebatifyApprovalCompleted){
        showToast('Tester approved, but the branded invitation email could not be sent. Use Resend Invitation after the email service is connected. '+friendlyFirebaseError(err),'error');
        if(state.loaded.applications)renderApplications();renderOverview();openApplicationRecord(a);
      }else{
        showToast(friendlyFirebaseError(err),'error');
      }
    }
    finally{actionBtn.disabled=false;}
    return;
  }
});

document.getElementById('adminDrawerClose').addEventListener('click',closeDrawer);
document.getElementById('adminDrawerBackdrop').addEventListener('click',closeDrawer);
document.getElementById('adminRefresh').addEventListener('click',refreshActiveView);
document.getElementById('adminMenuToggle').addEventListener('click',()=>document.body.classList.toggle('admin-nav-open'));
document.getElementById('adminLogout').addEventListener('click',async()=>{await signOut(auth).catch(()=>{});location.replace('admin-login.html');});
['applicationSearch','applicationStatusFilter','applicationPlatformFilter'].forEach(id=>document.getElementById(id).addEventListener('input',renderApplications));
['testerSearch','testerAccessFilter'].forEach(id=>document.getElementById(id).addEventListener('input',renderTesters));
['feedbackSearch','feedbackStatusFilter','feedbackTypeFilter'].forEach(id=>document.getElementById(id).addEventListener('input',renderFeedback));
