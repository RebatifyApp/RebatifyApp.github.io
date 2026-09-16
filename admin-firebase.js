import {
  firebaseConfigured,
  firebaseMissingFields,
  auth,
  db,
  isAdminUser,
  adminEmail,
  emailAutomationEnabled,
  testerPortalUrl,
  getProvisioningAuth,
  clearProvisioningAuth,
  timestampToDate,
  friendlyFirebaseError
} from './firebase-core.js';
import {
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  collection,
  doc,
  getDocs,
  getCountFromServer,
  query,
  where,
  orderBy,
  limit,
  setDoc,
  updateDoc,
  addDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

'use strict';

const loading = document.getElementById('adminLoading');
const app = document.getElementById('adminApp');
const toast = document.getElementById('adminToast');
const portalContent = document.getElementById('adminPortalContent');
const passwordGate = document.getElementById('adminPasswordGate');
let activeView = 'overview';
let initialized = false;
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
function typeIcon(type){if(type==='Feature Request')return '✦';if(type==='Crash / Performance')return '⚡';if(type==='Confusing Experience')return '?';if(type==='General Feedback')return '💬';return '●';}
function normalizeDoc(snap){return { id:snap.id, row:snap.id, ...snap.data() };}
function randomPassword(){
  const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);
  return 'Rbt!'+Array.from(bytes,b=>b.toString(36).slice(-1)).join('')+'7a';
}
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
  body.innerHTML=data.map(a=>`<tr><td><div class="admin-table-person"><span>${esc((a.fullName||'?').slice(0,1).toUpperCase())}</span><div><strong>${esc(a.fullName)}</strong><small>${esc(a.email)}</small></div></div></td><td><span class="admin-platform-pill">${esc(a.platform)}</span></td><td>${esc(relativeDate(a.submittedAt))}</td><td><span class="admin-status-pill ${statusClass(a.status)}">${esc(a.status)}</span></td><td>${esc(a.portalAccess||'Not Enabled')}</td><td><button class="admin-table-open" data-open-app="${esc(a.id)}" type="button">View</button></td></tr>`).join('');
  document.getElementById('applicationsEmpty').hidden=data.length>0;
}
function testerFiltered(){
  const q=document.getElementById('testerSearch').value.trim().toLowerCase();const access=document.getElementById('testerAccessFilter').value;
  return state.testers.filter(t=>(!q||((t.name||'')+' '+(t.email||'')).toLowerCase().includes(q))&&(!access||t.accessStatus===access));
}
function renderTesters(){
  const data=testerFiltered();const body=document.getElementById('testersTableBody');
  body.innerHTML=data.map(t=>`<tr><td><div class="admin-table-person"><span>${esc((t.name||'?').slice(0,1).toUpperCase())}</span><div><strong>${esc(t.name)}</strong><small>${esc(t.email)}</small></div></div></td><td><span class="admin-platform-pill">${esc(t.platform)}</span></td><td><span class="admin-status-pill ${t.accessStatus==='Enabled'?'status-active':'status-inactive'}">${esc(t.accessStatus||'Disabled')}</span></td><td>${esc(t.lastLogin?relativeDate(t.lastLogin):'Never')}</td><td>Email / Password</td><td><button class="admin-table-open" data-open-tester="${esc(t.uid)}" type="button">Manage</button></td></tr>`).join('');
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
function openApplicationRecord(a){
  openDrawer('Beta Application',a.fullName,`<div class="admin-detail-stack"><div class="admin-detail-status-row"><span class="admin-status-pill ${statusClass(a.status)}">${esc(a.status)}</span><span class="admin-platform-pill">${esc(a.platform)}</span></div><div class="admin-detail-grid"><div><span>Email</span><strong>${esc(a.email)}</strong></div><div><span>Submitted</span><strong>${esc(formatDate(a.submittedAt))}</strong></div><div><span>Terms</span><strong>${a.termsAccepted?'Accepted':'—'}</strong></div><div><span>Portal Access</span><strong>${esc(a.portalAccess||'Not Enabled')}</strong></div><div><span>Last Updated</span><strong>${esc(formatDate(a.lastUpdated))}</strong></div><div><span>Invite / Decision Email</span><strong>${esc(formatDate(a.lastDecisionEmail))}</strong></div></div><div><label class="admin-detail-label" for="drawerApplicantNotes">Private admin notes</label><textarea id="drawerApplicantNotes" class="admin-detail-textarea" placeholder="Notes only administrators can see">${esc(a.notes||'')}</textarea><button class="admin-secondary-button admin-save-notes" data-save-app-notes="${esc(a.id)}" type="button">Save Notes</button></div><div class="admin-drawer-actions"><button class="admin-action-button approve" data-app-action="approve" data-row="${esc(a.id)}" type="button">Approve & Send Invite</button><button class="admin-action-button" data-app-action="waitlist" data-row="${esc(a.id)}" type="button">Waitlist</button><button class="admin-action-button danger" data-app-action="decline" data-row="${esc(a.id)}" type="button">Decline</button><button class="admin-action-button" data-app-action="active" data-row="${esc(a.id)}" type="button">Mark Active</button><button class="admin-action-button" data-app-action="resend" data-row="${esc(a.id)}" type="button">Resend Password Setup</button><button class="admin-action-button danger-soft" data-app-action="inactive" data-row="${esc(a.id)}" type="button">Disable Access</button></div></div>`);
}
function openTesterRecord(t){
  const a=state.applications.find(x=>x.testerUid===t.uid||x.email===t.email);
  openDrawer('Tester Access',t.name,`<div class="admin-detail-stack"><div class="admin-detail-status-row"><span class="admin-status-pill ${t.accessStatus==='Enabled'?'status-active':'status-inactive'}">${esc(t.accessStatus)}</span><span class="admin-platform-pill">${esc(t.platform)}</span></div><div class="admin-detail-grid"><div><span>Email</span><strong>${esc(t.email)}</strong></div><div><span>Created</span><strong>${esc(formatDate(t.createdAt))}</strong></div><div><span>Last Login</span><strong>${esc(t.lastLogin?formatDate(t.lastLogin):'Never')}</strong></div><div><span>Authentication</span><strong>Email / Password</strong></div></div><div class="admin-drawer-actions"><button class="admin-action-button approve" data-app-action="resend" data-row="${a?esc(a.id):''}" type="button">Send Password Setup / Reset</button><button class="admin-action-button" data-app-action="active" data-row="${a?esc(a.id):''}" type="button">Enable / Mark Active</button><button class="admin-action-button danger-soft" data-app-action="inactive" data-row="${a?esc(a.id):''}" type="button">Disable Access</button></div></div>`);
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
async function queueDecisionEmail(a,status){
  if(!emailAutomationEnabled)return false;
  const first=String(a.fullName||'Tester').trim().split(/\s+/)[0]||'Tester';
  const templates={
    Waitlist:{subject:'Rebatify Beta application update',body:`Hi ${first},\n\nThank you for your interest in the Rebatify Beta. The current beta group is full, so your application has been placed on the waitlist. We will contact you if a spot becomes available.\n\nOrder. Track. Complete. Get Refunded.\nSimplify with Rebatify.`},
    Declined:{subject:'Rebatify Beta application update',body:`Hi ${first},\n\nThank you for your interest in helping test Rebatify. We are not able to offer a beta spot for this testing group. We appreciate your interest and support as Rebatify moves toward public launch.\n\nOrder. Track. Complete. Get Refunded.\nSimplify with Rebatify.`},
    Inactive:{subject:'Rebatify Beta access update',body:`Hi ${first},\n\nYour Rebatify Beta portal access has been paused. If you believe this was unexpected, reply to this message or contact Rebatify Support.\n\nSimplify with Rebatify.`}
  };
  const t=templates[status];if(!t)return false;
  await addDoc(collection(db,'mail'),{to:[a.email],message:{subject:t.subject,text:t.body}});return true;
}

async function approveApplicant(a){
  let uid=a.testerUid||'';
  if(!uid){
    const provisioningAuth=getProvisioningAuth();
    try{
      const cred=await createUserWithEmailAndPassword(provisioningAuth,a.email,randomPassword());
      uid=cred.user.uid;
    }finally{await clearProvisioningAuth();}
  }
  const testerPayload={name:a.fullName,email:a.email,platform:a.platform,status:'Approved',accessStatus:'Enabled',applicationId:a.id,updatedAt:serverTimestamp()};
  if(!a.testerUid){testerPayload.createdAt=serverTimestamp();testerPayload.lastLogin=null;}
  await setDoc(doc(db,'betaUsers',uid),testerPayload,{merge:true});
  await updateDoc(doc(db,'betaApplications',a.id),{status:'Approved',portalAccess:'Enabled',testerUid:uid,lastUpdated:serverTimestamp(),lastDecisionEmail:serverTimestamp()});
  await sendPasswordResetEmail(auth,a.email,{url:testerPortalUrl});
  const old=a.status;a.status='Approved';a.portalAccess='Enabled';a.testerUid=uid;a.lastUpdated=new Date();a.lastDecisionEmail=new Date();updateMetricTransition(old,'Approved',a.platform);
  if(state.loaded.testers){
    const existing=state.testers.find(t=>t.uid===uid);
    if(existing){Object.assign(existing,{name:a.fullName,email:a.email,platform:a.platform,status:'Approved',accessStatus:'Enabled',applicationId:a.id});}
    else{state.testers.unshift({uid,name:a.fullName,email:a.email,platform:a.platform,status:'Approved',accessStatus:'Enabled',applicationId:a.id,createdAt:new Date(),lastLogin:null});}
    renderTesters();
  }else state.loaded.testers=false;
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
  if(!a.testerUid)throw new Error('Tester access has not been created yet. Approve this applicant first.');
  await sendPasswordResetEmail(auth,a.email,{url:testerPortalUrl});
  await updateDoc(doc(db,'betaApplications',a.id),{lastDecisionEmail:serverTimestamp(),lastUpdated:serverTimestamp()});
  a.lastDecisionEmail=new Date();a.lastUpdated=new Date();
}

async function refreshActiveView(){
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
  try{
    document.getElementById('adminIdentityEmail').textContent=user.email||adminEmail;
    if(passwordGate)passwordGate.remove();
    if(portalContent)portalContent.classList.remove('admin-content-locked');
    await loadOverview();
    loading.hidden=true;app.hidden=false;
  }catch(error){showFatal('The beta administration data could not be loaded.',friendlyFirebaseError(error));}
}

if(!firebaseConfigured){showFatal('The Rebatify Beta data service has not been configured yet.','Missing: '+firebaseMissingFields.join(', '));}
else{
  onAuthStateChanged(auth,async user=>{
    if(initialized)return;
    initialized=true;
    if(!user||!isAdminUser(user)){await signOut(auth).catch(()=>{});location.replace('admin-login.html?error=access');return;}
    await init(user);
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
  const actionBtn=e.target.closest('[data-app-action]');if(actionBtn){
    const task=actionBtn.dataset.appAction;const id=actionBtn.dataset.row;if(!id){showToast('Could not find the tester application record.','error');return;}
    const a=await ensureApplicationLoaded(id);if(!a)return;
    const notification=emailAutomationEnabled?' and notify them':'';
    const confirmation={approve:'Approve this tester and send a secure password-setup email?',waitlist:'Move this applicant to the waitlist'+notification+'?',decline:'Decline this application'+notification+'?',resend:'Send a fresh password-setup email?',inactive:'Disable this tester’s portal access'+notification+'?',active:'Enable access and mark this tester active?'}[task];
    if(confirmation&&!(await confirmAction(confirmation,(task==='decline'||task==='inactive')?'danger':'')))return;
    actionBtn.disabled=true;
    try{
      if(task==='approve')await approveApplicant(a);
      if(task==='waitlist')await statusAction(a,'Waitlist','Disabled');
      if(task==='decline')await statusAction(a,'Declined','Disabled');
      if(task==='inactive')await statusAction(a,'Inactive','Disabled');
      if(task==='active')await statusAction(a,'Active','Enabled');
      if(task==='resend')await resendInvite(a);
      if(state.loaded.applications)renderApplications();renderOverview();
      const messages={approve:'Tester approved and the password-setup email was sent.',resend:'Password-setup email sent.',waitlist:'Applicant moved to the waitlist.',decline:'Application declined.',inactive:'Tester access disabled.',active:'Tester marked active.'};
      showToast(messages[task]||'Tester record updated.');closeDrawer();
    }catch(err){showToast(friendlyFirebaseError(err),'error');}
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
