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
  deleteField,
  writeBatch,
  Timestamp
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
  tasks: [],
  taskAssignments: [],
  loaded: { applications:false, testers:false, feedback:false, tasks:false }
};


const TASK_TEMPLATES = {
  walkthrough: {
    label:'Walkthrough & first-time setup', platform:'All', responseType:'Long Answer', suggestedHours:48,
    objective:'Confirm the guided walkthrough is clear, complete, and gives a brand-new Rebatify user enough confidence to start using the app without outside help.',
    instructions:`1. Open the latest Rebatify beta build and complete the guided walkthrough from beginning to end. If you have already completed it, use the in-app walkthrough/replay option when available.
2. Follow each step in order and avoid skipping ahead.
3. Pay attention to wording, button labels, icons, screen transitions, layout, and anything that feels unclear or out of order.
4. When you finish, decide whether you would know how to add and track your first rebate order without asking for help.
5. In your response, list anything that confused you. If everything was clear, say “No issues” and briefly tell us what worked well.`
  },
  'add-order': {
    label:'Add and track a rebate order', platform:'All', responseType:'Long Answer', suggestedHours:48,
    objective:'Validate the complete order-entry experience, saved values, calculations, and the Order Details screen.',
    instructions:`1. Create a temporary test order in the latest Rebatify beta build using an available Source of Rebate Deals.
2. Suggested test data: Item/description “Beta Task Test Order”; order number “BETA-1001”; purchase amount $79.99; expected refund $50.00. Use reasonable test values for any other required fields.
3. Save the order, reopen it from Orders, and verify the values, refund timing, status/timeline, and next-action information look correct.
4. Edit one field, save again, and confirm the change persists.
5. Report any field that was confusing, any calculation that looked wrong, or anything that took more steps than expected. If no issue occurred, say “No issues.”`
  },
  'refund-workflow': {
    label:'Partial + final refund workflow', platform:'All', responseType:'Long Answer', suggestedHours:48,
    objective:'Confirm Rebatify correctly handles a partial refund, preserves the remaining shortfall, and then completes the order after the final refund.',
    instructions:`1. Create or use a test order that has not yet received its full expected refund.
2. Record a partial refund that is less than the expected refund.
3. Reopen the order and verify Rebatify still shows the remaining amount correctly instead of treating the order as fully refunded.
4. Record the remaining refund amount.
5. Verify the order moves to the correct completed/refunded state and the totals are correct in Order Details and Reports.
6. Tell us anything that was unclear or incorrect, or respond “No issues.”`
  },
  'multi-order-refund': {
    label:'Multi-order refund workflow', platform:'All', responseType:'Long Answer', suggestedHours:48,
    objective:'Validate the multi-order refund workflow, including the single-order guardrail, selecting multiple eligible orders, and allocation/results after saving.',
    instructions:`1. Make sure at least two eligible test orders are available for a refund.
2. Open Record a Multi-Order Refund.
3. First try to continue with only one order selected. Confirm Rebatify blocks the action and clearly explains that multiple orders are required.
4. Select at least two eligible orders and complete a test multi-order refund.
5. Reopen each affected order and verify the refund amounts and remaining balances are correct.
6. Report any confusing message, incorrect allocation, duplicate record, or unexpected result. If everything worked, say “No issues.”`
  },
  reports: {
    label:'Reports & spending insights', platform:'All', responseType:'Long Answer', suggestedHours:48,
    objective:'Confirm Reports accurately explains spending, refunds, Out Of Pocket Expense, and time-period totals using the tester’s recorded data.',
    instructions:`1. Open Reports after you have at least a few test orders and at least one refund recorded.
2. Review multiple available time periods/filters.
3. Compare the totals to the underlying orders you entered.
4. Check spending, refunds, and Out Of Pocket Expense for anything that appears inconsistent or difficult to understand.
5. Tell us whether the report helped you understand your rebate activity at a glance and note any number, label, or layout that seemed wrong. If no issue occurred, say “No issues.”`
  },
  'shared-profiles': {
    label:'Shared Profiles collaboration', platform:'All', responseType:'Long Answer', suggestedHours:72,
    objective:'Validate creating or joining a Shared Profile and confirm shared data behaves consistently between participating accounts.',
    instructions:`1. Use two test Rebatify accounts when possible.
2. Create a Shared Profile or join one using the normal invitation flow.
3. Confirm the second account can access the shared profile.
4. Add or edit a temporary test record from one participant and confirm the other participant sees the expected update.
5. Check that profile names, access, and shared information are clear and do not appear duplicated.
6. Report any invitation, access, sync, or wording issue. If everything worked, say “No issues.”`
  },
  'cloud-sync': {
    label:'Cloud sync across two clients', platform:'All', responseType:'Long Answer', suggestedHours:72,
    objective:'Confirm the same Rebatify account stays consistent across two authorized clients without duplicates, missing edits, or confusing cloud status.',
    instructions:`1. Sign in to the same Rebatify test account on two authorized clients, such as your phone plus the Rebatify Web App or another trusted device.
2. Create or edit a temporary test order on the first client.
3. Wait for cloud sync to finish and confirm the record appears exactly once on the second client with the same values.
4. Edit that record from the second client and confirm the first client receives the updated values.
5. Watch the cloud status/saving indicators during the test.
6. Report duplicates, missing edits, stale values, unexpected device-limit behavior, or unclear sync status. If no issue occurred, say “No issues.”`
  },
  'plus-ios': {
    label:'Rebatify+ test purchase — iOS / TestFlight', platform:'iOS', responseType:'Long Answer', suggestedHours:48,
    objective:'Validate the complete Rebatify+ purchase and entitlement experience from the TestFlight build without using a real-money production purchase.',
    adminNote:'iOS only. TestFlight In-App Purchases run in Apple’s sandbox and do not charge real money. Do not send this objective to someone using the production App Store build.',
    instructions:`1. Make sure you are using the latest Rebatify build installed through TestFlight — not a production App Store build.
2. Open the Rebatify+ paywall/upgrade screen and review the plan wording, pricing display, trial wording (if shown), and purchase buttons.
3. Start a Rebatify+ subscription purchase and complete the Apple purchase sheet. TestFlight purchases use Apple’s sandbox and should not create a real charge.
4. Confirm Rebatify+ unlocks immediately after the test transaction.
5. Close and reopen Rebatify and confirm Plus access is still recognized.
6. If Restore Purchases is available, test it and confirm entitlement remains correct.
7. Report any incorrect price/plan text, purchase error, entitlement delay, locked Plus feature, restore problem, or confusing messaging. If everything worked, say “No issues.”`
  },
  'plus-android': {
    label:'Rebatify+ test purchase — Android / Google Play', platform:'Android', responseType:'Long Answer', suggestedHours:48,
    objective:'Validate the complete Rebatify+ Google Play purchase and entitlement experience using a Google Play license-testing account.',
    adminNote:'Android only. Before sending this task, make sure the tester’s Google account is configured under Play Console → Settings → License testing and is eligible for the test release. If Google presents a normal real-money purchase instead of a test purchase, the tester should stop.',
    instructions:`1. Make sure the Google Play Store is signed into the Google account approved for the Rebatify beta and configured for Google Play license testing.
2. Install/open Rebatify from the designated Google Play testing track.
3. Open the Rebatify+ paywall and review the plan wording, pricing display, trial wording (if shown), and purchase buttons.
4. Start a Rebatify+ purchase. Confirm Google Play identifies it as a test purchase. If it appears to be a normal real-money purchase, stop and report that instead of completing it.
5. Complete the test purchase and verify Rebatify+ unlocks immediately.
6. Close and reopen Rebatify and confirm Plus access remains correct. Test Restore Purchases if that option is available.
7. Report any billing, entitlement, restore, wording, or paywall issue. If everything worked, say “No issues.”`
  },
  'web-app': {
    label:'Rebatify Web App smoke test', platform:'All', responseType:'Long Answer', suggestedHours:72,
    objective:'Validate that the Rebatify Web App is understandable, synchronized, and usable for the core workflows a Rebatify+ member expects.',
    instructions:`1. Open the Rebatify Web App using the beta web link you were provided and sign in with your Rebatify test account.
2. Review Home, Orders, Order Details, Reports, and Settings/Account areas that are available to you.
3. Create or edit a temporary test record on the web and verify it synchronizes to the mobile app.
4. Make a change on mobile and verify the web version updates without creating a duplicate.
5. Check layout, navigation, wording, loading/saving states, and device/client access behavior.
6. Report anything that is missing, confusing, visually broken, out of sync, or inconsistent with the mobile app. If everything worked, say “No issues.”`
  }
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
  const [total,applied,approved,active,waitlist,declined,inactive,ios,android,newFeedback,activeTasks]=await Promise.all([
    countQuery(apps),
    countQuery(query(apps,where('status','==','Applied'))),
    countQuery(query(apps,where('status','==','Approved'))),
    countQuery(query(apps,where('status','==','Active'))),
    countQuery(query(apps,where('status','==','Waitlist'))),
    countQuery(query(apps,where('status','==','Declined'))),
    countQuery(query(apps,where('status','==','Inactive'))),
    countQuery(query(apps,where('platform','==','iOS'))),
    countQuery(query(apps,where('platform','==','Android'))),
    countQuery(query(feedback,where('status','==','New'))),
    countQuery(query(collection(db,'betaTaskAssignments'),where('status','==','Pending')))
  ]);
  state.metrics={total,applied,approved,active,waitlist,declined,inactive,ios,android,newFeedback,activeTasks};
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

async function loadTasks(force=false){
  if(state.loaded.tasks&&!force){renderTasks();renderTaskRecipientPicker();return;}
  const [taskSnap,assignmentSnap]=await Promise.all([
    getDocs(query(collection(db,'betaTasks'),orderBy('createdAt','desc'),limit(100))),
    getDocs(query(collection(db,'betaTaskAssignments'),limit(500)))
  ]);
  state.tasks=taskSnap.docs.map(normalizeDoc);
  state.taskAssignments=assignmentSnap.docs.map(normalizeDoc);
  state.loaded.tasks=true;
  renderTasks();
  renderTaskRecipientPicker();
}

function renderMetrics(){
  const m=state.metrics||{};
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v==null?0:v;};
  const setNavBadge=(id,v)=>{const el=document.getElementById(id);if(!el)return;const count=Number(v||0);el.textContent=count;el.hidden=count<1;};
  set('metricApplied',m.applied);set('metricApproved',m.approved);set('metricActive',m.active);set('metricFeedback',m.newFeedback);
  set('metricWaitlist',m.waitlist);set('metricDeclined',m.declined);set('metricInactive',m.inactive);set('iosCount',m.ios);set('androidCount',m.android);
  setNavBadge('navPendingCount',m.applied);setNavBadge('navTaskCount',m.activeTasks);setNavBadge('navFeedbackCount',m.newFeedback);
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
function pendingAssignmentsForTester(t){
  const email=String(t.email||'').trim().toLowerCase();
  return state.taskAssignments.filter(a=>a.status==='Pending'&&(a.testerUid===t.uid||String(a.email||'').trim().toLowerCase()===email)).sort((a,b)=>(timestampToDate(a.dueAt)?.getTime()||0)-(timestampToDate(b.dueAt)?.getTime()||0));
}
function testerTaskStateHtml(t){
  const pending=pendingAssignmentsForTester(t);
  if(!pending.length)return '<div class="admin-tester-task-state"><span class="admin-status-pill status-completed">All clear</span><small>No required tasks pending</small></div>';
  const overdue=pending.filter(a=>{const d=timestampToDate(a.dueAt);return d&&d.getTime()<Date.now();});
  if(overdue.length)return `<div class="admin-tester-task-state"><span class="admin-status-pill status-overdue-removed">Removal pending</span><small>${overdue.length} overdue required task${overdue.length===1?'':'s'}</small></div>`;
  const next=pending[0];
  return `<div class="admin-tester-task-state"><span class="admin-status-pill status-pending">${pending.length} pending</span><small>Next: ${esc(formatDate(next.dueAt))}</small></div>`;
}
function renderTesters(){
  const data=testerFiltered();const body=document.getElementById('testersTableBody');
  body.innerHTML=data.map(t=>`<tr><td><div class="admin-table-person"><span>${esc((t.name||'?').slice(0,1).toUpperCase())}</span><div><strong>${esc(t.name)}</strong><small>${esc(t.email)}</small></div></div></td><td><span class="admin-platform-pill">${esc(t.platform)}</span></td><td><span class="admin-status-pill ${t.accessStatus==='Enabled'?'status-active':'status-inactive'}">${esc(t.accessStatus||'Disabled')}</span></td><td>${testerTaskStateHtml(t)}</td><td>${esc(t.lastLogin?relativeDate(t.lastLogin):'Never')}</td><td>Email verification code</td><td><button class="admin-table-open" data-open-tester="${esc(t.uid)}" type="button">Manage</button></td></tr>`).join('');
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

function localDatetimeValue(date){
  const d=new Date(date.getTime()-date.getTimezoneOffset()*60000);return d.toISOString().slice(0,16);
}
function selectTaskRecipients(platform='All'){
  document.querySelectorAll('[data-task-recipient]').forEach(el=>{const p=el.dataset.platform||'';el.checked=platform==='All'||p===platform;});
  updateTaskRecipientSummary();
}
function applyTaskTemplate(key){
  const tpl=TASK_TEMPLATES[key];
  const meta=document.getElementById('taskTemplateMeta');
  if(!tpl){if(meta)meta.textContent='Custom task selected. Write any testing objective and instructions you want.';return;}
  document.getElementById('taskTitle').value=tpl.label;
  document.getElementById('taskObjective').value=tpl.objective;
  document.getElementById('taskInstructions').value=tpl.instructions;
  document.getElementById('taskResponseType').value=tpl.responseType;
  const due=document.getElementById('taskDueAt');if(due&&!due.value)due.value=localDatetimeValue(new Date(Date.now()+tpl.suggestedHours*60*60*1000));
  if(tpl.platform&&tpl.platform!=='All')selectTaskRecipients(tpl.platform);
  if(meta)meta.textContent=`Recommended recipients: ${tpl.platform==='All'?'all active testers':tpl.platform+' testers'} · Suggested deadline: ${tpl.suggestedHours} hours.${tpl.adminNote?' '+tpl.adminNote:''}`;
}
function activeTaskTesters(){
  const byEmail=new Map();
  for(const t of state.testers){
    if(t.accessStatus!=='Enabled'||!['Approved','Active'].includes(t.status))continue;
    const key=String(t.email||'').trim().toLowerCase();
    if(!key)continue;
    const existing=byEmail.get(key);
    if(!existing||t.status==='Active')byEmail.set(key,t);
  }
  return [...byEmail.values()].sort((a,b)=>String(a.name||a.email).localeCompare(String(b.name||b.email)));
}
function updateTaskRecipientSummary(){
  const boxes=[...document.querySelectorAll('[data-task-recipient]:checked')];
  const el=document.getElementById('taskRecipientSummary');
  if(el)el.textContent=boxes.length+' selected';
}
function renderTaskRecipientPicker(){
  const list=document.getElementById('taskRecipientList'); if(!list)return;
  const testers=activeTaskTesters();
  if(!testers.length){list.innerHTML='<div class="admin-empty-inline" style="padding:14px">No active testers are available for a task yet.</div>';updateTaskRecipientSummary();return;}
  list.innerHTML=testers.map(t=>`<label class="admin-task-recipient"><input type="checkbox" data-task-recipient="${esc(t.uid)}" data-platform="${esc(t.platform||'')}"><span class="admin-task-recipient-copy"><strong>${esc(t.name||'Tester')}</strong><span>${esc(t.email||'')}</span></span><span class="admin-platform-pill">${esc(t.platform||'')}</span></label>`).join('');
  updateTaskRecipientSummary();
}
function taskAssignmentStats(taskId){
  const rows=state.taskAssignments.filter(a=>a.taskId===taskId);
  return {rows,total:rows.length,completed:rows.filter(a=>a.status==='Completed').length,removed:rows.filter(a=>a.status==='Overdue - Removed').length,pending:rows.filter(a=>a.status==='Pending').length,reminded:rows.filter(a=>a.status==='Pending'&&a.lastReminderSentAt).length};
}
function taskDisplayStatus(t,stats){
  if(t.status==='Cancelled')return 'Cancelled';
  if(stats.removed>0&&stats.pending===0)return 'Closed';
  if(stats.total>0&&stats.completed===stats.total)return 'Completed';
  return t.status||'Active';
}
function renderTaskDashboard(){
  const pending=state.taskAssignments.filter(a=>a.status==='Pending').sort((a,b)=>(timestampToDate(a.dueAt)?.getTime()||0)-(timestampToDate(b.dueAt)?.getTime()||0));
  const now=Date.now(), day=24*60*60*1000;
  const open=state.tasks.filter(t=>t.status!=='Cancelled'&&taskAssignmentStats(t.id).pending>0).length;
  const dueSoon=pending.filter(a=>{const d=timestampToDate(a.dueAt);return d&&d.getTime()>now&&d.getTime()-now<=day;}).length;
  const reminded=pending.filter(a=>a.lastReminderSentAt).length;
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('taskMetricOpen',open);set('taskMetricPending',pending.length);set('taskMetricDueSoon',dueSoon);set('taskMetricReminded',reminded);
  const list=document.getElementById('taskNeedsAttention');if(!list)return;
  list.innerHTML=pending.length?pending.map(a=>{const d=timestampToDate(a.dueAt);const overdue=!!d&&d.getTime()<now;return `<div class="admin-task-attention-row${overdue?' is-overdue':''}"><div class="admin-task-attention-copy"><strong>${esc(a.name||'Tester')} · ${esc(a.taskTitle||'Required task')}</strong><span>${esc(a.email||'')} · ${esc(a.platform||'')}</span></div><div class="admin-task-attention-due">${overdue?'<strong>OVERDUE — ACCESS REMOVAL PENDING</strong><br>':'Due '}${esc(formatDate(a.dueAt))}</div><button class="admin-task-remind-button" data-remind-assignment="${esc(a.id)}" type="button">${a.lastReminderSentAt?'Remind Again':'Send Reminder'}</button></div>`;}).join(''):'<div class="admin-empty-inline">No outstanding required tasks.</div>';
}
function renderTasks(){
  const body=document.getElementById('tasksTableBody'); if(!body)return;
  body.innerHTML=state.tasks.map(t=>{const stats=taskAssignmentStats(t.id);const pct=stats.total?Math.round(stats.completed/stats.total*100):0;const displayStatus=taskDisplayStatus(t,stats);return `<tr><td><strong>${esc(t.title||'Required task')}</strong><small style="display:block;color:#718095;margin-top:3px">${esc(t.templateLabel||t.responseType||'Custom task')}</small></td><td>${esc(formatDate(t.dueAt))}</td><td>${stats.total}</td><td><div class="admin-task-progress"><strong>${stats.completed}/${stats.total}</strong><span class="admin-task-progress-bar"><span style="width:${pct}%"></span></span></div></td><td><strong>${stats.pending}</strong></td><td><span class="admin-status-pill ${statusClass(displayStatus)}">${esc(displayStatus)}</span></td><td><button class="admin-table-open" data-open-task="${esc(t.id)}" type="button">Manage</button></td></tr>`;}).join('');
  document.getElementById('tasksEmpty').hidden=state.tasks.length>0;
  renderTaskDashboard();
}
function findTask(id){return state.tasks.find(t=>t.id===id);}
function assignmentReminderText(a){return a.lastReminderSentAt?`Last reminder ${relativeDate(a.lastReminderSentAt)}`:'No reminder sent yet';}
function openTaskRecord(t){
  const stats=taskAssignmentStats(t.id);
  const assignments=stats.rows.sort((a,b)=>String(a.name||a.email).localeCompare(String(b.name||b.email)));
  const rows=assignments.length?assignments.map(a=>{const d=timestampToDate(a.dueAt);const overdue=a.status==='Pending'&&d&&d.getTime()<Date.now();return `<div class="admin-task-assignment"><div class="admin-task-assignment-top"><div><strong>${esc(a.name||'Tester')}</strong><small>${esc(a.email||'')}</small></div><span class="admin-status-pill ${statusClass(overdue?'Removal Pending':a.status)}">${esc(overdue?'Removal Pending':a.status)}</span></div><div class="admin-task-assignment-reminder">Email: ${esc(a.emailStatus||'Unknown')}${a.emailError?` · ${esc(a.emailError)}`:''}</div>${a.response?`<div class="admin-task-assignment-response"><strong>Response:</strong><br>${esc(a.response)}</div>`:''}${a.status==='Pending'?`<div class="admin-task-assignment-reminder">${overdue?'Deadline passed — run a deadline check now.':esc(assignmentReminderText(a))}</div><div class="admin-task-assignment-actions"><button class="admin-task-remind-button" data-remind-assignment="${esc(a.id)}" type="button">${a.emailStatus==='Error'?'Retry Task Email':'Send Reminder'}</button></div>`:''}</div>`;}).join(''):'<div class="admin-empty-inline">No task assignments found.</div>';
  const cancel=t.status==='Active'?`<button class="admin-action-button danger-soft" data-task-action="cancel" data-task-id="${esc(t.id)}" type="button">Cancel Task</button>`:'';
  const remind=stats.pending?`<button class="admin-action-button approve" data-task-action="remind-pending" data-task-id="${esc(t.id)}" type="button">Remind Pending Testers (${stats.pending})</button>`:'';
  openDrawer('Beta Program Task',t.title||'Required Task',`<div class="admin-detail-stack"><div class="admin-detail-status-row"><span class="admin-status-pill ${statusClass(taskDisplayStatus(t,stats))}">${esc(taskDisplayStatus(t,stats))}</span><span class="admin-subtle-chip">Due ${esc(formatDate(t.dueAt))}</span></div>${t.objective?`<div class="admin-feedback-detail"><span>Testing Objective</span><p>${esc(t.objective)}</p></div>`:''}<div class="admin-feedback-detail"><span>Instructions</span><p>${esc(t.instructions||'')}</p></div><div class="admin-detail-grid"><div><span>Template</span><strong>${esc(t.templateLabel||'Custom')}</strong></div><div><span>Response Type</span><strong>${esc(t.responseType||'Acknowledgement')}</strong></div><div><span>Recipients</span><strong>${stats.total}</strong></div><div><span>Completed</span><strong>${stats.completed}</strong></div><div><span>Pending</span><strong>${stats.pending}</strong></div><div><span>Reminded</span><strong>${stats.reminded}</strong></div><div><span>Removed for Missed Deadline</span><strong>${stats.removed}</strong></div><div><span>Automatic Reminders</span><strong>${t.autoReminders===false?'Off':'On'}</strong></div></div><div><label class="admin-detail-label">Tester responses</label><div class="admin-task-response-list">${rows}</div></div><div class="admin-drawer-actions">${remind}${cancel}</div></div>`);
}
async function createRequiredTask(){
  const templateKey=String(document.getElementById('taskTemplateSelect').value||'').trim();
  const template=TASK_TEMPLATES[templateKey]||null;
  const title=String(document.getElementById('taskTitle').value||'').trim();
  const objective=String(document.getElementById('taskObjective').value||'').trim();
  const instructions=String(document.getElementById('taskInstructions').value||'').trim();
  const responseType=document.getElementById('taskResponseType').value;
  const autoReminders=!!document.getElementById('taskAutoReminders').checked;
  const dueRaw=document.getElementById('taskDueAt').value;
  const selected=[...document.querySelectorAll('[data-task-recipient]:checked')].map(el=>el.dataset.taskRecipient);
  if(title.length<2)throw new Error('Enter a task title.');
  if(objective.length<2)throw new Error('Enter a testing objective.');
  if(instructions.length<2)throw new Error('Enter clear task instructions.');
  if(!dueRaw)throw new Error('Choose a required completion date and time.');
  const due=new Date(dueRaw); if(Number.isNaN(due.getTime())||due.getTime()<=Date.now())throw new Error('The task deadline must be in the future.');
  if(!selected.length)throw new Error('Select at least one active tester.');
  if(!emailWorkerEndpoint)throw new Error('Connect the Cloudflare email service before sending a required task.');
  const testers=activeTaskTesters().filter(t=>selected.includes(t.uid));
  const taskRef=doc(collection(db,'betaTasks'));
  const batch=writeBatch(db);
  batch.set(taskRef,{title,objective,instructions,responseType,dueAt:Timestamp.fromDate(due),status:'Active',recipientCount:testers.length,templateKey:templateKey||'custom',templateLabel:template?template.label:'Custom task',autoReminders,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),createdBy:adminEmail});
  for(const t of testers){
    const assignmentRef=doc(db,'betaTaskAssignments',taskRef.id+'_'+t.uid);
    batch.set(assignmentRef,{taskId:taskRef.id,taskTitle:title,taskObjective:objective,taskInstructions:instructions,responseType,templateKey:templateKey||'custom',testerUid:t.uid,applicationId:t.applicationId||'',name:t.name||'',email:String(t.email||'').toLowerCase(),platform:t.platform||'',status:'Pending',response:'',assignedAt:serverTimestamp(),dueAt:Timestamp.fromDate(due),dueLabel:'',autoReminders,completedAt:null,removedAt:null,emailStatus:'Sending',lastReminderSentAt:null,reminder24hSentAt:null,reminder4hSentAt:null,updatedAt:serverTimestamp()});
  }
  await batch.commit();
  let sent=0,failed=0;const errors=[];
  const dueLabel=due.toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  for(const t of testers){
    const ref=doc(db,'betaTaskAssignments',taskRef.id+'_'+t.uid);
    try{
      await updateDoc(ref,{dueLabel,updatedAt:serverTimestamp()});
      await callWorkerAdminAction('task-assigned',{email:String(t.email||'').toLowerCase(),name:t.name||'',platform:t.platform||'',taskTitle:title,taskObjective:objective,taskInstructions:instructions,dueLabel});
      await updateDoc(ref,{emailStatus:'Sent',emailError:deleteField(),emailSentAt:serverTimestamp(),updatedAt:serverTimestamp()}); sent++;
    }catch(err){const message=String(err&&err.message||'Email delivery failed.').slice(0,500);errors.push(message);await updateDoc(ref,{emailStatus:'Error',emailError:message,updatedAt:serverTimestamp()}).catch(()=>{});failed++;}
  }
  state.loaded.tasks=false;
  await loadMetrics();renderMetrics();
  await loadTasks(true);
  document.getElementById('taskTemplateSelect').value='';document.getElementById('taskTitle').value='';document.getElementById('taskObjective').value='';document.getElementById('taskInstructions').value='';document.getElementById('taskDueAt').value='';document.getElementById('taskResponseType').value='Acknowledgement';document.getElementById('taskAutoReminders').checked=true;document.getElementById('taskTemplateMeta').textContent='Choose a template to prefill the testing objective and instructions, or leave this on Custom task.';
  renderTaskRecipientPicker();
  return {sent,failed,total:testers.length,errors};
}
async function sendAssignmentReminder(a){
  if(!a||a.status!=='Pending')return false;
  const dueLabel=a.dueLabel||formatDate(a.dueAt);
  const emailType=a.emailStatus==='Error'?'task-assigned':'task-reminder';
  await callWorkerAdminAction(emailType,{email:String(a.email||'').toLowerCase(),name:a.name||'Tester',platform:a.platform||'',taskTitle:a.taskTitle||'Required Beta Program Task',taskObjective:a.taskObjective||'',taskInstructions:a.taskInstructions||'',dueLabel,reminderKind:'Reminder'});
  await updateDoc(doc(db,'betaTaskAssignments',a.id),{emailStatus:'Sent',emailError:deleteField(),emailSentAt:serverTimestamp(),lastReminderSentAt:serverTimestamp(),manualReminderSentAt:serverTimestamp(),updatedAt:serverTimestamp()});
  a.lastReminderSentAt=new Date();a.manualReminderSentAt=new Date();
  renderTasks();
  return true;
}
async function remindPendingForTask(t){
  const rows=state.taskAssignments.filter(a=>a.taskId===t.id&&a.status==='Pending');let sent=0,failed=0;
  for(const a of rows){try{await sendAssignmentReminder(a);sent++;}catch(_){failed++;}}
  return {sent,failed,total:rows.length};
}
async function runDeadlineCheckNow(){
  if(!emailWorkerEndpoint)throw new Error('Connect the Cloudflare service before running the deadline check.');
  const result=await callWorkerAdminAction('admin-process-overdue-tasks',{});
  state.loaded.applications=false;state.loaded.testers=false;state.loaded.tasks=false;
  await Promise.all([loadMetrics(),loadApplications(true),loadTesters(true),loadTasks(true)]);
  renderMetrics();renderOverview();renderTesters();renderTasks();
  return result;
}

async function cancelRequiredTask(t){
  const assignments=state.taskAssignments.filter(a=>a.taskId===t.id&&a.status==='Pending');
  const batch=writeBatch(db);batch.update(doc(db,'betaTasks',t.id),{status:'Cancelled',updatedAt:serverTimestamp()});
  assignments.forEach(a=>batch.update(doc(db,'betaTaskAssignments',a.id),{status:'Cancelled',updatedAt:serverTimestamp()}));
  await batch.commit();t.status='Cancelled';assignments.forEach(a=>a.status='Cancelled');
  await loadMetrics();renderMetrics();renderTasks();
}

async function switchView(view){
  activeView=view;document.body.classList.remove('admin-nav-open');
  document.querySelectorAll('[data-admin-view]').forEach(b=>b.classList.toggle('is-active',b.dataset.adminView===view));
  document.querySelectorAll('[data-admin-panel]').forEach(p=>p.classList.toggle('is-active',p.dataset.adminPanel===view));
  const titles={overview:'Overview',applications:'Applications',testers:'Testers',tasks:'Tasks',feedback:'Feedback'};document.getElementById('adminViewTitle').textContent=titles[view]||'Overview';
  try{
    if(view==='applications')await loadApplications();
    if(view==='testers'){await loadTesters();await loadTasks();renderTesters();}
    if(view==='tasks'){await loadTesters();await loadTasks();}
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
  const pending=pendingAssignmentsForTester(t);
  const pendingHtml=pending.length?pending.map(x=>`<div class="admin-task-assignment"><div class="admin-task-assignment-top"><div><strong>${esc(x.taskTitle||'Required task')}</strong><small>Due ${esc(formatDate(x.dueAt))}</small></div><span class="admin-status-pill status-pending">Pending</span></div><div class="admin-task-assignment-actions"><button class="admin-task-remind-button" data-remind-assignment="${esc(x.id)}" type="button">${x.lastReminderSentAt?'Remind Again':'Send Reminder'}</button></div></div>`).join(''):'<div class="admin-empty-inline">No required tasks are pending for this tester.</div>';
  const accessAction=a
    ? (t.accessStatus==='Enabled'
      ? `<button class="admin-action-button danger-soft" data-app-action="inactive" data-row="${esc(a.id)}" type="button">Disable Access</button>`
      : `<button class="admin-action-button approve" data-app-action="active" data-row="${esc(a.id)}" type="button">Enable Access</button>`)
    : '';
  const deleteAction=a
    ? `<button class="admin-action-button danger-soft" data-app-action="delete" data-row="${esc(a.id)}" type="button">Delete Application & Tester</button>`
    : `<button class="admin-action-button danger-soft" data-tester-action="delete" data-tester-uid="${esc(t.uid)}" type="button">Delete Tester</button>`;
  const actions=[accessAction,deleteAction].filter(Boolean).join('');
  openDrawer('Tester Access',t.name,`<div class="admin-detail-stack"><div class="admin-detail-status-row"><span class="admin-status-pill ${t.accessStatus==='Enabled'?'status-active':'status-inactive'}">${esc(t.accessStatus)}</span><span class="admin-platform-pill">${esc(t.platform)}</span></div><div class="admin-detail-grid"><div><span>Email</span><strong>${esc(t.email)}</strong></div><div><span>Created</span><strong>${esc(formatDate(t.createdAt))}</strong></div><div><span>Last Login</span><strong>${esc(t.lastLogin?formatDate(t.lastLogin):'Never')}</strong></div><div><span>Authentication</span><strong>Email verification code</strong></div><div><span>Required Tasks Pending</span><strong>${pending.length}</strong></div></div><div><label class="admin-detail-label">Outstanding required tasks</label><div class="admin-task-response-list">${pendingHtml}</div></div><div class="admin-drawer-actions">${actions}</div></div>`);
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
  if(!emailWorkerEndpoint){const err=new Error('Connect the Cloudflare service in Admin Overview before using this action.');err.code='rebatify/service-not-configured';throw err;}
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
async function deleteTaskAssignmentsForTester(email,uid=''){
  const normalizedEmail=String(email||'').trim().toLowerCase();
  const docs=new Map();
  if(normalizedEmail){const snap=await getDocs(query(collection(db,'betaTaskAssignments'),where('email','==',normalizedEmail)));snap.docs.forEach(d=>docs.set(d.id,d.ref));}
  if(uid){const snap=await getDocs(query(collection(db,'betaTaskAssignments'),where('testerUid','==',uid)));snap.docs.forEach(d=>docs.set(d.id,d.ref));}
  await Promise.all([...docs.values()].map(ref=>deleteDoc(ref)));
  if(state.loaded.tasks){const ids=new Set(docs.keys());state.taskAssignments=state.taskAssignments.filter(a=>!ids.has(a.id));renderTasks();}
  return docs.size;
}
async function deleteTesterOnly(t){
  const email=String(t.email||'').trim().toLowerCase();
  await callWorkerAdminAction('admin-delete-auth-user',{email});
  await deleteTaskAssignmentsForTester(email,t.uid);
  await deleteTesterRecordsByEmail(email);
}
async function deleteApplication(a){
  // A deleted application must leave no stale portal identity behind. Clean up
  // the Auth user plus every betaUsers document for this email, including
  // duplicate records left by earlier beta builds/tests.
  const email=String(a.email||'').trim().toLowerCase();
  await callWorkerAdminAction('admin-delete-auth-user',{email});
  await deleteTaskAssignmentsForTester(email,a.testerUid||'');
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
  if(activeView==='testers'){await loadTesters(true);await loadTasks(true);renderTesters();}
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
    if(activeView==='testers'){await loadTesters(true);await loadTasks(true);renderTesters();}
    if(activeView==='tasks'){await loadTesters(true);await loadTasks(true);}
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
  const testerBtn=e.target.closest('[data-open-tester]');if(testerBtn){if(!state.loaded.applications)await loadApplications();if(!state.loaded.tasks)await loadTasks();const t=findTester(testerBtn.dataset.openTester);if(t)openTesterRecord(t);return;}
  const taskOpenBtn=e.target.closest('[data-open-task]');if(taskOpenBtn){if(!state.loaded.tasks)await loadTasks();const t=findTask(taskOpenBtn.dataset.openTask);if(t)openTaskRecord(t);return;}
  const feedbackBtn=e.target.closest('[data-open-feedback]');if(feedbackBtn){try{const f=await ensureFeedbackLoaded(feedbackBtn.dataset.openFeedback);if(f)openFeedbackRecord(f);}catch(err){showToast('Could not open that feedback.','error');}return;}
  const noteBtn=e.target.closest('[data-save-app-notes]');if(noteBtn){const a=await ensureApplicationLoaded(noteBtn.dataset.saveAppNotes);if(!a)return;const notes=document.getElementById('drawerApplicantNotes').value;try{await updateDoc(doc(db,'betaApplications',a.id),{notes,lastUpdated:serverTimestamp()});a.notes=notes;a.lastUpdated=new Date();showToast('Private notes saved.');}catch(err){showToast(friendlyFirebaseError(err),'error');}return;}
  const fbSave=e.target.closest('[data-save-feedback]');if(fbSave){const f=await ensureFeedbackLoaded(fbSave.dataset.saveFeedback);if(!f)return;const status=document.getElementById('drawerFeedbackStatus').value;const notes=document.getElementById('drawerFeedbackNotes').value;try{await updateDoc(doc(db,'betaFeedback',f.id),{status,adminNotes:notes,updatedAt:serverTimestamp()});if(f.status==='New'&&status!=='New'&&state.metrics.newFeedback>0)state.metrics.newFeedback--;if(f.status!=='New'&&status==='New')state.metrics.newFeedback++;f.status=status;f.adminNotes=notes;f.updatedAt=new Date();renderMetrics();renderFeedback();renderOverview();showToast('Feedback updated.');openFeedbackRecord(f);}catch(err){showToast(friendlyFirebaseError(err),'error');}return;}
  const emailSave=e.target.closest('[data-save-email-worker]');if(emailSave){emailSave.disabled=true;const original=emailSave.textContent;emailSave.textContent='Saving…';try{await saveEmailServiceSettings();showToast('Cloudflare email service connected.');}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{emailSave.disabled=false;emailSave.textContent=original;}return;}
  const remindAssignmentBtn=e.target.closest('[data-remind-assignment]');if(remindAssignmentBtn){
    const a=state.taskAssignments.find(x=>x.id===remindAssignmentBtn.dataset.remindAssignment);if(!a)return;
    remindAssignmentBtn.disabled=true;const original=remindAssignmentBtn.textContent;remindAssignmentBtn.textContent='Sending…';
    try{await sendAssignmentReminder(a);showToast('Task reminder sent to '+(a.name||a.email||'tester')+'.');const t=findTask(a.taskId);if(t&&document.getElementById('adminDrawer')?.getAttribute('aria-hidden')==='false')openTaskRecord(t);}
    catch(err){showToast(friendlyFirebaseError(err),'error');}
    finally{remindAssignmentBtn.disabled=false;remindAssignmentBtn.textContent=original;}
    return;
  }
  const taskActionBtn=e.target.closest('[data-task-action]');if(taskActionBtn){
    const t=findTask(taskActionBtn.dataset.taskId);
    if(t&&taskActionBtn.dataset.taskAction==='remind-pending'){
      taskActionBtn.disabled=true;const original=taskActionBtn.textContent;taskActionBtn.textContent='Sending Reminders…';
      try{const result=await remindPendingForTask(t);showToast(result.failed?`${result.sent} reminder${result.sent===1?'':'s'} sent; ${result.failed} failed.`:`Reminder sent to ${result.sent} pending tester${result.sent===1?'':'s'}.`,result.failed?'error':'success');openTaskRecord(t);}
      catch(err){showToast(friendlyFirebaseError(err),'error');}
      finally{taskActionBtn.disabled=false;taskActionBtn.textContent=original;}
      return;
    }
    if(t&&taskActionBtn.dataset.taskAction==='cancel'){
      if(!(await confirmAction('Cancel this required task? Testers who have not completed it will no longer be required to respond, and nobody will be removed for this task.','danger')))return;
      taskActionBtn.disabled=true;try{await cancelRequiredTask(t);closeDrawer();showToast('Task cancelled.');}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{taskActionBtn.disabled=false;}
    }
    return;
  }
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
        if(activeView==='testers'){await loadTesters(true);await loadTasks(true);renderTesters();}
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
const deadlineCheckBtn=document.getElementById('taskRunDeadlineCheck');
if(deadlineCheckBtn)deadlineCheckBtn.addEventListener('click',async()=>{const original=deadlineCheckBtn.textContent;deadlineCheckBtn.disabled=true;deadlineCheckBtn.textContent='Checking…';try{const result=await runDeadlineCheckNow();const errors=Array.isArray(result.errors)?result.errors:[];showToast(errors.length?`Deadline check completed with ${errors.length} error${errors.length===1?'':'s'}. ${errors[0]}`:`Deadline check complete. ${Number(result.removed||0)} tester${Number(result.removed||0)===1?'':'s'} removed; ${Number(result.remindersSent||0)} reminder${Number(result.remindersSent||0)===1?'':'s'} sent.`,errors.length?'error':'success');}catch(err){showToast('Deadline check failed. '+friendlyFirebaseError(err),'error');}finally{deadlineCheckBtn.disabled=false;deadlineCheckBtn.textContent=original;}});
document.getElementById('taskTemplateSelect').addEventListener('change',e=>applyTaskTemplate(e.target.value));
document.getElementById('taskSelectAll').addEventListener('click',()=>selectTaskRecipients('All'));
document.getElementById('taskSelectIOS').addEventListener('click',()=>selectTaskRecipients('iOS'));
document.getElementById('taskSelectAndroid').addEventListener('click',()=>selectTaskRecipients('Android'));
document.getElementById('taskClearAll').addEventListener('click',()=>{document.querySelectorAll('[data-task-recipient]').forEach(el=>el.checked=false);updateTaskRecipientSummary();});
document.getElementById('taskRecipientList').addEventListener('change',e=>{if(e.target.matches('[data-task-recipient]'))updateTaskRecipientSummary();});
document.getElementById('taskSendButton').addEventListener('click',async()=>{const btn=document.getElementById('taskSendButton');const original=btn.innerHTML;if(!(await confirmAction('Send this required task to the selected testers? They will receive an email and must complete it by the deadline to keep beta access active.','')))return;btn.disabled=true;btn.innerHTML='Sending Task…';try{const result=await createRequiredTask();const firstError=result.errors&&result.errors[0]?` ${result.errors[0]}`:'';showToast(result.failed?`Task assigned to ${result.total} testers. ${result.failed} email${result.failed===1?'':'s'} could not be sent.${firstError}`:`Required task sent to ${result.total} tester${result.total===1?'':'s'}.`,result.failed?'error':'success');}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{btn.disabled=false;btn.innerHTML=original;}});
['applicationSearch','applicationStatusFilter','applicationPlatformFilter'].forEach(id=>document.getElementById(id).addEventListener('input',renderApplications));
['testerSearch','testerAccessFilter'].forEach(id=>document.getElementById(id).addEventListener('input',renderTesters));
['feedbackSearch','feedbackStatusFilter','feedbackTypeFilter'].forEach(id=>document.getElementById(id).addEventListener('input',renderFeedback));
