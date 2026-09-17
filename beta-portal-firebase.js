// Rebatify Beta Tester Portal - Website Build 68
import { firebaseConfigured, auth, db, timestampToDate, friendlyFirebaseError } from './firebase-core.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc,
  getDoc,
  updateDoc,
  addDoc,
  collection,
  serverTimestamp,
  query,
  where,
  getDocs
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const loading = document.getElementById('portalLoading');
const app = document.getElementById('portalApp');
const content = document.getElementById('portalContent');
const logout = document.getElementById('portalLogout');
const feedbackForm = document.getElementById('portalFeedbackForm');
const feedbackMessage = document.getElementById('feedbackMessage');
let currentProfile = null;
let initialized = false;
let requiredTasks = [];
let allTaskAssignments = [];
let activeTask = null;
let portalAnnouncements = [];
let feedbackHistory = [];
let activeRetestFeedback = null;
let lastFirestoreActivityWrite = 0;
const PORTAL_ACTIVITY_WRITE_MS = 5 * 60 * 1000;
const taskBackdrop = document.getElementById('portalTaskBackdrop');
const taskSubmit = document.getElementById('portalTaskSubmit');
const workerUrl = String(window.REBATIFY_BETA_SETTINGS?.emailWorkerUrl || '').trim().replace(/\/+$/, '');

const PORTAL_INACTIVITY_MS = 6 * 60 * 60 * 1000;
const PORTAL_ACTIVITY_KEY = 'rebatifyBetaPortalLastActivity';
let inactivityTimer = null;
let inactivityStarted = false;
let sessionEnding = false;
let lastActivityWrite = 0;


async function workerPostAuthorized(type,payload={}){
  if(!workerUrl||!auth.currentUser)return {ok:false,skipped:true};
  const token=await auth.currentUser.getIdToken();
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(workerUrl,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({type,...payload}),signal:controller.signal});
    let data={};try{data=await response.json();}catch(_){ }
    if(!response.ok||data.ok!==true)throw new Error(data.error||'Notification service could not complete this request.');
    return data;
  }finally{clearTimeout(timer);}
}


function detectedScreenSize(){
  try{return `${window.screen.width}×${window.screen.height} @ ${window.devicePixelRatio||1}x`;}catch(_){return '';}
}
function detectedOsVersion(){
  const ua=navigator.userAgent||'';
  const ios=ua.match(/OS ([0-9_]+) like Mac OS X/i);if(ios)return 'iOS '+ios[1].replaceAll('_','.');
  const android=ua.match(/Android\s+([^;\)]+)/i);if(android)return 'Android '+android[1].trim();
  return '';
}
function profileDeviceDetails(profile=currentProfile){
  if(!profile)return '';
  const parts=[profile.deviceModel,profile.osVersion].map(v=>String(v||'').trim()).filter(Boolean);
  return parts.join(' · ');
}
async function writePortalActivity(force=false){
  if(!auth.currentUser||!currentProfile||sessionEnding)return;
  const now=Date.now();if(!force&&now-lastFirestoreActivityWrite<PORTAL_ACTIVITY_WRITE_MS)return;
  lastFirestoreActivityWrite=now;
  try{await updateDoc(doc(db,'betaUsers',auth.currentUser.uid),{lastPortalActivity:serverTimestamp(),updatedAt:serverTimestamp()});currentProfile.lastPortalActivity=new Date();}catch(_){/* Activity tracking is best-effort and must never end a valid session. */}
}
function setDeviceMessage(text,type=''){
  const el=document.getElementById('portalDeviceMessage');if(!el)return;el.textContent=text||'';el.className='portal-device-message'+(type?' '+type:'');
}
function renderDeviceProfile(profile){
  const model=document.getElementById('testerDeviceModel');const os=document.getElementById('testerOsVersion');const screen=document.getElementById('testerScreenSize');
  if(model)model.value=profile.deviceModel||'';
  if(os)os.value=profile.osVersion||detectedOsVersion();
  if(screen)screen.value=detectedScreenSize()||profile.screenSize||'';
  const deviceDetails=document.getElementById('deviceDetails');if(deviceDetails)deviceDetails.value=profileDeviceDetails(profile)||'Complete Testing Setup first';
}

function feedbackPublicStatus(f){
  const raw=String(f.status||'New');const status=raw==='Planned'?'Confirmed':raw==='Declined'?'Closed':raw;
  if(status==='Closed')return {label:'Resolved',className:'resolved'};
  if(status==='Needs Retest'&&f.retestedAt)return {label:'Retest submitted',className:'testing'};
  if(status==='Needs Retest')return {label:'Needs retest',className:'testing'};
  if(status==='Fixed')return {label:'Fix in progress',className:'testing'};
  if(status==='Reviewing'||status==='Confirmed')return {label:'Reviewing',className:'reviewing'};
  return {label:'Received',className:'received'};
}

function formatPortalDate(value){const d=timestampToDate(value);return d?d.toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'}):'';}

function scheduleInactivityLogout() {
  clearTimeout(inactivityTimer);
  const last = Number(sessionStorage.getItem(PORTAL_ACTIVITY_KEY) || Date.now());
  const remaining = PORTAL_INACTIVITY_MS - (Date.now() - last);
  if (remaining <= 0) {
    endInactiveSession();
    return;
  }
  inactivityTimer = setTimeout(endInactiveSession, remaining + 250);
}
function recordPortalActivity() {
  if (sessionEnding) return;
  const now = Date.now();
  if (now - lastActivityWrite < 750) return;
  lastActivityWrite = now;
  sessionStorage.setItem(PORTAL_ACTIVITY_KEY, String(now));
  scheduleInactivityLogout();
  writePortalActivity(false).catch(()=>{});
}
async function endInactiveSession() {
  if (sessionEnding) return;
  sessionEnding = true;
  clearTimeout(inactivityTimer);
  sessionStorage.removeItem(PORTAL_ACTIVITY_KEY);
  try { await signOut(auth); } catch (_) {}
  location.replace('beta-login.html?error=inactive');
}
function startInactivityWatcher() {
  if (inactivityStarted) return;
  inactivityStarted = true;
  sessionStorage.setItem(PORTAL_ACTIVITY_KEY, String(Date.now()));
  writePortalActivity(true).catch(()=>{});
  ['pointerdown','keydown','touchstart','scroll'].forEach(eventName => {
    window.addEventListener(eventName, recordPortalActivity, { passive: true });
  });
  window.addEventListener('focus', () => {
    const last = Number(sessionStorage.getItem(PORTAL_ACTIVITY_KEY) || 0);
    if (last && Date.now() - last >= PORTAL_INACTIVITY_MS) endInactiveSession();
    else recordPortalActivity();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const last = Number(sessionStorage.getItem(PORTAL_ACTIVITY_KEY) || 0);
      if (last && Date.now() - last >= PORTAL_INACTIVITY_MS) endInactiveSession();
      else scheduleInactivityLogout();
    }
  });
  scheduleInactivityLogout();
}

function fail(reason='session') {
  signOut(auth).catch(() => {}).finally(() => location.replace('beta-login.html?error=' + encodeURIComponent(reason)));
}
function firstName(name){ return String(name || 'Tester').trim().split(/\s+/)[0] || 'Tester'; }
function setFeedbackMessage(text,type='') {
  if (!feedbackMessage) return;
  feedbackMessage.textContent=text || '';
  feedbackMessage.className='portal-feedback-message' + (type ? ' ' + type : '');
}

function formatTaskDue(value){
  const d=timestampToDate(value);if(!d)return 'Deadline not available';
  return 'Required by '+d.toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
}
function setTaskMessage(text,type=''){
  const el=document.getElementById('portalTaskMessage');if(!el)return;el.textContent=text||'';el.className='portal-task-message'+(type?' '+type:'');
}
function taskIsOverdue(task){const d=timestampToDate(task.dueAt);return !!d&&d.getTime()<Date.now();}
function escapeHtml(value){return String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function renderPortalTaskSummary(){
  const section=document.getElementById('portalTaskSummary');if(!section)return;
  const pending=allTaskAssignments.filter(t=>t.status==='Pending').sort((a,b)=>(timestampToDate(a.dueAt)?.getTime()||0)-(timestampToDate(b.dueAt)?.getTime()||0));
  const retests=feedbackHistory.filter(f=>String(f.status||'')==='Needs Retest'&&!f.retestedAt);
  const total=pending.length+retests.length;
  const mobileCount=document.getElementById('portalMobileActionCount');if(mobileCount){mobileCount.textContent=total;mobileCount.hidden=total===0;}
  if(!total){section.hidden=true;return;}
  section.hidden=false;
  document.getElementById('portalTaskSummaryCount').textContent=total;
  document.getElementById('portalTaskSummaryTitle').textContent=total===1?'You have 1 required action to complete.':`You have ${total} required actions to complete.`;
  document.getElementById('portalTaskSummaryText').textContent=retests.length?'A reported issue is ready for retesting. Complete retests and required Beta Program tasks as soon as possible.':'Complete every required task by its deadline to keep your Beta Program access active. Reminder emails are sent as deadlines approach.';
  const list=document.getElementById('portalTaskSummaryList');
  const taskRows=pending.slice(0,6).map(t=>`<button class="portal-required-summary-item" data-open-required-task="${escapeHtml(t.id)}" type="button"><strong>${escapeHtml(t.taskTitle||'Required task')}</strong><span>${escapeHtml(formatTaskDue(t.dueAt))}</span></button>`);
  const retestRows=retests.slice(0,6).map(f=>`<button class="portal-required-summary-item portal-required-retest" data-retest-feedback="${escapeHtml(f.id)}" type="button"><strong>Retest: ${escapeHtml(f.subject||'Reported issue')}</strong><span>Action required</span></button>`);
  list.innerHTML=[...retestRows,...taskRows].slice(0,8).join('');
}

function renderRequiredTask(){
  if(!taskBackdrop)return;
  if(!requiredTasks.length){activeTask=null;taskBackdrop.hidden=true;document.body.classList.remove('portal-task-open');return;}
  activeTask=requiredTasks[0];
  document.getElementById('portalTaskPosition').textContent=requiredTasks.length>1?`1 of ${requiredTasks.length}`:'';
  document.getElementById('portalTaskTitle').textContent=activeTask.taskTitle||'Required Beta Program Task';
  document.getElementById('portalTaskDue').textContent=formatTaskDue(activeTask.dueAt);
  const objectiveBox=document.getElementById('portalTaskObjective');const objectiveText=document.getElementById('portalTaskObjectiveText');
  if(activeTask.taskObjective){objectiveBox.hidden=false;objectiveText.textContent=activeTask.taskObjective;}else{objectiveBox.hidden=true;objectiveText.textContent='';}
  document.getElementById('portalTaskInstructions').textContent=activeTask.taskInstructions||'';
  const response=document.getElementById('portalTaskResponse');
  const overdue=taskIsOverdue(activeTask);
  const modal=taskBackdrop.querySelector('.portal-task-modal');if(modal)modal.classList.toggle('is-overdue',overdue);
  setTaskMessage('');
  if(overdue){response.innerHTML='<div class="portal-task-overdue">This required task deadline has passed. Your Rebatify Beta Program access is scheduled for automatic removal because the task was not completed on time.</div>';}
  else if(activeTask.responseType==='Short Answer')response.innerHTML='<label for="portalTaskShortAnswer">Your response</label><input id="portalTaskShortAnswer" type="text" maxlength="500" placeholder="Enter your response"/>';
  else if(activeTask.responseType==='Long Answer')response.innerHTML='<label for="portalTaskLongAnswer">Your response</label><textarea id="portalTaskLongAnswer" maxlength="5000" placeholder="Enter your response"></textarea>';
  else if(activeTask.responseType==='Yes / No')response.innerHTML='<label for="portalTaskYesNo">Your response</label><select id="portalTaskYesNo"><option value="">Choose one</option><option value="Yes">Yes</option><option value="No">No</option></select>';
  else response.innerHTML='<label class="portal-task-ack"><input id="portalTaskAck" type="checkbox"/><span>I have completed or reviewed this required Beta Program task.</span></label>';
  taskBackdrop.hidden=false;document.body.classList.add('portal-task-open');
}
async function loadRequiredTasks(uid){
  const snap=await getDocs(query(collection(db,'betaTaskAssignments'),where('testerUid','==',uid)));
  allTaskAssignments=snap.docs.map(d=>({id:d.id,...d.data()}));
  portalAnnouncements=allTaskAssignments.filter(t=>t.recordType==='Announcement'&&!t.announcementArchived).sort((a,b)=>(timestampToDate(b.publishedAt)?.getTime()||0)-(timestampToDate(a.publishedAt)?.getTime()||0));
  requiredTasks=allTaskAssignments.filter(t=>t.recordType!=='Announcement'&&t.status==='Pending').sort((a,b)=>{
    const ad=timestampToDate(a.dueAt),bd=timestampToDate(b.dueAt);return (ad?ad.getTime():0)-(bd?bd.getTime():0);
  });
  renderPortalAnnouncements();
  renderPortalTaskSummary();
  renderRequiredTask();
}

function renderPortalAnnouncements(){
  const section=document.getElementById('portalAnnouncements');const list=document.getElementById('portalAnnouncementList');if(!section||!list)return;
  if(!portalAnnouncements.length){section.hidden=true;list.innerHTML='';return;}
  section.hidden=false;
  list.innerHTML=portalAnnouncements.map(a=>{
    const requires=!!a.requiresAcknowledgement;const acknowledged=a.status==='Acknowledged'&&!!a.acknowledgedAt;
    const action=requires?(acknowledged?`<span class="portal-announcement-acknowledged">✓ Acknowledged ${escapeHtml(formatPortalDate(a.acknowledgedAt))}</span>`:`<button class="portal-announcement-ack" data-ack-announcement="${escapeHtml(a.id)}" type="button">Acknowledge</button>`):'<span class="portal-announcement-info">For your information</span>';
    return `<article class="portal-announcement-card${a.announcementImportant?' is-important':''}"><div class="portal-announcement-meta"><span><b class="portal-announcement-icon" aria-hidden="true">!</b>${a.announcementImportant?'Important Beta Update':'Beta Update'}</span><time>${escapeHtml(formatPortalDate(a.publishedAt||a.assignedAt))}</time></div><h3>${escapeHtml(a.announcementTitle||'Rebatify Beta Update')}</h3><p>${escapeHtml(a.announcementMessage||'')}</p><div class="portal-announcement-footer">${requires?'<small>Rebatify asks you to confirm that you have read this update.</small>':'<small>No acknowledgement is required.</small>'}${action}</div></article>`;
  }).join('');
}
async function acknowledgeAnnouncement(id,button){
  const row=portalAnnouncements.find(a=>a.id===id);if(!row||row.status==='Acknowledged')return;
  if(button){button.disabled=true;button.textContent='Saving…';}
  try{
    await updateDoc(doc(db,'betaTaskAssignments',row.id),{status:'Acknowledged',response:'Acknowledged',acknowledgedAt:serverTimestamp(),updatedAt:serverTimestamp()});
    row.status='Acknowledged';row.response='Acknowledged';row.acknowledgedAt=new Date();renderPortalAnnouncements();
  }catch(error){if(button){button.disabled=false;button.textContent='Acknowledge';}setFeedbackMessage('We could not save that acknowledgement. '+friendlyFirebaseError(error),'error');}
}
async function loadFeedbackHistory(uid){
  const snap=await getDocs(query(collection(db,'betaFeedback'),where('ownerUid','==',uid),where('adminNotes','==','')));
  feedbackHistory=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(timestampToDate(b.submittedAt)?.getTime()||0)-(timestampToDate(a.submittedAt)?.getTime()||0));
  renderFeedbackHistory();
  renderPortalTaskSummary();
  const pendingRetest=feedbackHistory.find(f=>String(f.status||'')==='Needs Retest'&&!f.retestedAt);
  if(pendingRetest){const promptKey='rebatifyBetaRetestPrompted:'+pendingRetest.id;if(!sessionStorage.getItem(promptKey)){sessionStorage.setItem(promptKey,'1');setTimeout(()=>openRetestFeedback(pendingRetest.id),350);}}
}
function renderFeedbackHistory(){
  const list=document.getElementById('portalFeedbackHistory');if(!list)return;
  if(!feedbackHistory.length){list.innerHTML='<div class="portal-feedback-history-empty">No feedback submitted yet.</div>';return;}
  list.innerHTML=feedbackHistory.slice(0,30).map(f=>{const publicStatus=feedbackPublicStatus(f);const needsRetest=String(f.status||'')==='Needs Retest'&&!f.retestedAt;const action=needsRetest?`<button class="portal-retest-button" data-retest-feedback="${escapeHtml(f.id)}" type="button">Retest This Issue</button>`:'';return `<article class="portal-feedback-history-card${needsRetest?' needs-action':''}"><div class="portal-feedback-history-top"><div><span>${escapeHtml(f.type||'Feedback')}</span><h3>${escapeHtml(f.subject||'Feedback')}</h3></div><span class="portal-feedback-public-status ${publicStatus.className}">${escapeHtml(publicStatus.label)}</span></div><p>${escapeHtml(f.details||'')}</p><div class="portal-feedback-history-meta"><span>${escapeHtml(formatPortalDate(f.submittedAt))}</span>${f.appVersion?`<span>${escapeHtml(f.appVersion)}</span>`:''}${f.pageFeature?`<span>${escapeHtml(f.pageFeature)}</span>`:''}</div>${f.retestedAt?`<div class="portal-retest-result"><strong>${escapeHtml(f.retestResult||'Retest submitted')}</strong>${f.retestNotes?`<span>${escapeHtml(f.retestNotes)}</span>`:''}</div>`:''}${action}</article>`;}).join('');
}

function openRetestFeedback(id){
  const f=feedbackHistory.find(x=>x.id===id);if(!f)return;activeRetestFeedback=f;
  document.getElementById('portalRetestSubject').textContent=f.subject||'Feedback';
  document.getElementById('portalRetestOriginalDetails').textContent=f.details||'';
  const meta=[f.pageFeature?`Page / feature: ${f.pageFeature}`:'',f.appVersion||'',f.deviceDetails||profileDeviceDetails(currentProfile)].filter(Boolean).join(' · ');
  document.getElementById('portalRetestOriginalMeta').textContent=meta;
  document.getElementById('portalRetestResult').value='';document.getElementById('portalRetestNotes').value='';document.getElementById('portalRetestMessage').textContent='';document.getElementById('portalRetestBackdrop').hidden=false;document.body.classList.add('portal-retest-open');
}

function closeRetestFeedback(){activeRetestFeedback=null;const back=document.getElementById('portalRetestBackdrop');if(back)back.hidden=true;document.body.classList.remove('portal-retest-open');}
async function submitRetest(){
  if(!activeRetestFeedback||!auth.currentUser)return;const result=String(document.getElementById('portalRetestResult').value||'').trim();const notes=String(document.getElementById('portalRetestNotes').value||'').trim();const message=document.getElementById('portalRetestMessage');
  if(!result){message.textContent='Choose what happened when you retested.';message.className='portal-task-message error';return;}
  const btn=document.getElementById('portalRetestSubmit');const original=btn.innerHTML;btn.disabled=true;btn.innerHTML='Submitting…';message.textContent='';
  try{
    const retestCount=(Number(activeRetestFeedback.retestCount)||0)+1;
    await updateDoc(doc(db,'betaFeedback',activeRetestFeedback.id),{retestResult:result,retestNotes:notes,retestedAt:serverTimestamp(),retestCount,updatedAt:serverTimestamp()});
    const feedbackId=activeRetestFeedback.id;activeRetestFeedback.retestResult=result;activeRetestFeedback.retestNotes=notes;activeRetestFeedback.retestedAt=new Date();activeRetestFeedback.retestCount=retestCount;renderFeedbackHistory();renderPortalTaskSummary();closeRetestFeedback();setFeedbackMessage('Retest submitted. Thank you for checking the fix.','success');workerPostAuthorized('feedback-retest-submitted',{feedbackId}).catch(err=>console.warn('Retest email notification failed:',err));
  }catch(error){message.textContent='We could not submit your retest. '+friendlyFirebaseError(error);message.className='portal-task-message error';}
  finally{btn.disabled=false;btn.innerHTML=original;}
}

function collectTaskResponse(task){
  if(task.responseType==='Short Answer')return String(document.getElementById('portalTaskShortAnswer')?.value||'').trim();
  if(task.responseType==='Long Answer')return String(document.getElementById('portalTaskLongAnswer')?.value||'').trim();
  if(task.responseType==='Yes / No')return String(document.getElementById('portalTaskYesNo')?.value||'').trim();
  return document.getElementById('portalTaskAck')?.checked?'Completed':'';
}
async function completeRequiredTask(){
  if(!activeTask||!auth.currentUser)return;
  if(taskIsOverdue(activeTask)){setTaskMessage('This task deadline has passed and can no longer be completed.','error');return;}
  const response=collectTaskResponse(activeTask);
  if(!response){setTaskMessage(activeTask.responseType==='Acknowledgement'?'Confirm that you completed or reviewed this task before continuing.':'A response is required before you can continue.','error');return;}
  const original=taskSubmit.innerHTML;taskSubmit.disabled=true;taskSubmit.innerHTML='Saving…';setTaskMessage('');
  try{
    await updateDoc(doc(db,'betaTaskAssignments',activeTask.id),{status:'Completed',response,completedAt:serverTimestamp(),updatedAt:serverTimestamp()});
    const completedId=activeTask.id;requiredTasks=requiredTasks.filter(t=>t.id!==completedId);const allRow=allTaskAssignments.find(t=>t.id===completedId);if(allRow)allRow.status='Completed';renderPortalTaskSummary();renderRequiredTask();
  }catch(error){setTaskMessage('We could not complete this task. '+friendlyFirebaseError(error),'error');}
  finally{taskSubmit.disabled=false;taskSubmit.innerHTML=original;}
}

function timelineStep(number,status,title,body,actionHtml=''){
  const statusLabel={complete:'Completed',now:'Action Needed',waiting:'Upcoming',next:'Upcoming',ongoing:'In Progress'}[status]||status;
  return `<article class="portal-timeline-step ${status}"><div class="portal-timeline-marker"><span>${number}</span></div><div class="portal-timeline-copy"><div class="portal-timeline-step-top"><h3>${title}</h3><span class="portal-timeline-status">${statusLabel}</span></div><p>${body}</p>${actionHtml}</div></article>`;
}

const PROGRAM_TIMELINE_STAGES=['approved','setupComplete','inviteSent','activeTesting'];
function normalizeProgramTimelineStage(value){
  if(value==='deviceReady')return 'setupComplete';
  if(value==='installed')return 'activeTesting';
  return PROGRAM_TIMELINE_STAGES.includes(value)?value:'approved';
}


function testFlightActionHtml(){
  return `<div class="portal-timeline-actions"><button class="portal-testflight-button" data-open-testflight type="button"><span class="portal-testflight-icon" aria-hidden="true">↗</span><span>Open TestFlight</span></button><small><strong>Shortcut only —</strong> opens TestFlight if installed or its App Store page if needed. It does not complete this step or advance your Beta Program status.</small></div>`;
}

function showPortalShortcutToast(message){
  const toast=document.getElementById('portalShortcutToast');
  if(!toast)return;
  toast.textContent=message;
  toast.hidden=false;
  toast.classList.add('show');
  clearTimeout(showPortalShortcutToast.timer);
  showPortalShortcutToast.timer=setTimeout(()=>{toast.classList.remove('show');setTimeout(()=>{toast.hidden=true;},180);},4200);
}

function openTestFlightOrStore(){
  const appStoreUrl='https://apps.apple.com/app/testflight/id899247664';
  const deepLink='itms-beta://';
  let fallbackTimer=null;
  let leftPage=false;
  const cancelFallback=()=>{leftPage=true;if(fallbackTimer){clearTimeout(fallbackTimer);fallbackTimer=null;}};
  const visibilityHandler=()=>{if(document.hidden)cancelFallback();};
  document.addEventListener('visibilitychange',visibilityHandler,{once:true});
  window.addEventListener('pagehide',cancelFallback,{once:true});
  showPortalShortcutToast('Opening TestFlight. This shortcut does not advance your Beta Program status.');
  fallbackTimer=setTimeout(()=>{
    if(!leftPage)window.location.href=appStoreUrl;
  },1050);
  setTimeout(()=>{window.location.href=deepLink;},180);
}

function bindTestFlightButtons(scope=document){
  scope.querySelectorAll('[data-open-testflight]').forEach(btn=>{
    if(btn.dataset.bound==='1')return;
    btn.dataset.bound='1';
    btn.addEventListener('click',openTestFlightOrStore);
  });
}

function renderProgramTimeline(profile){
  const timeline=document.getElementById('portalProgramTimeline');const footnote=document.getElementById('portalTimelineFootnote');if(!timeline)return;
  const ios=profile.platform==='iOS';const stage=normalizeProgramTimelineStage(profile.timelineStage);const rank=PROGRAM_TIMELINE_STAGES.indexOf(stage);
  const accessCopy=ios
    ? (stage==='inviteSent'||stage==='activeTesting'?'Your <strong>TestFlight invitation has been sent</strong> to your approved beta email. Open it on your iPhone, accept it in TestFlight, and install Rebatify.':'Prepare your iPhone for TestFlight and watch your approved beta email for the Rebatify invitation. Rebatify will advance this stage when testing access is released.')
    : (stage==='inviteSent'||stage==='activeTesting'?'Your <strong>Google Play closed-testing link has been sent</strong> to your approved beta email. Open it on your Android phone, opt in, and install Rebatify.':'Make sure Google Play uses the Google Account that matches your approved beta email, then watch for the closed-testing link. Rebatify will advance this stage when testing access is released.');
  const content=[
    ['Approved for the Rebatify Beta Program','Your application is approved and your private Beta Program Portal access is active.',''],
    ['Complete Testing Setup','Save the phone model and operating-system version you will use for beta testing. Your screen size is detected automatically. Completing this step advances your timeline automatically.',`<div class="portal-timeline-actions"><button class="portal-testflight-button portal-setup-button" data-open-testing-setup type="button"><span>Complete Testing Setup</span></button><small>You can edit these details later from <strong>Settings</strong>.</small></div>`],
    [ios?'Prepare your iPhone & watch for TestFlight':'Prepare your Android phone & watch for testing access',accessCopy,ios?testFlightActionHtml():''],
    ['Install Rebatify, create your account & begin testing',ios?'After accepting the TestFlight invitation, install Rebatify and create your Rebatify app account. Then use real rebate activity when possible, complete required Beta Program tasks, and send feedback through this portal.':'After opting in through Google Play, install Rebatify and create your Rebatify app account. Then use real rebate activity when possible, complete required Beta Program tasks, and send feedback through this portal.','']
  ];
  const visuals=content.map((_,i)=>{if(i<rank)return 'complete';if(i===rank)return stage==='activeTesting'?'ongoing':'now';return 'waiting';});
  timeline.innerHTML=content.map((item,index)=>timelineStep(index+1,visuals[index],item[0],item[1],item[2])).join('');
  bindTestFlightButtons(timeline);
  timeline.querySelectorAll('[data-open-testing-setup]').forEach(btn=>btn.addEventListener('click',openTestingSetup));
  if(footnote){const currentLabel={approved:'Testing Setup Required',setupComplete:'Testing Setup Complete',inviteSent:ios?'TestFlight Invitation Sent':'Google Play Testing Link Sent',activeTesting:'Active Beta Testing'}[stage];footnote.innerHTML='<strong>How progress works:</strong> Completing Testing Setup advances your first portal milestone automatically. Rebatify controls the later testing-access stages. Opening TestFlight, Google Play, or Rebatify by itself does not advance your program status.'+`<br><span class="portal-timeline-current"><strong>Current program stage:</strong> ${currentLabel}</span>`;}
}

async function loadProfile(user) {
  const ref = doc(db, 'betaUsers', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('access');
  const data = snap.data();
  if (data.accessStatus !== 'Enabled' || !['Approved','Active'].includes(data.status)) throw new Error('access');

  if (data.status === 'Approved') {
    // A successful passwordless sign-in is the point at which an approved tester
    // becomes Active. Include lastLogin so this transition remains compatible
    // with the current betaUsers security rule. The Worker also records the login
    // at code verification time, so this timestamp still represents a real sign-in.
    const profileUpdate = { status: 'Active', updatedAt: serverTimestamp(), lastLogin: serverTimestamp() };
    await updateDoc(ref, profileUpdate);
    if (data.applicationId) {
      await updateDoc(doc(db, 'betaApplications', data.applicationId), {
        status: 'Active',
        portalAccess: 'Enabled',
        testerUid: user.uid,
        lastUpdated: serverTimestamp()
      }).catch(() => {});
    }
    return { id: snap.id, ...data, status: 'Active' };
  }

  return { id: snap.id, ...data };
}

function renderProfile(profile) {
  document.getElementById('portalFirstName').textContent = firstName(profile.name);
  document.getElementById('portalEmail').textContent = profile.email || '';
  document.getElementById('portalPlatform').textContent = profile.platform || '';
  renderDeviceProfile(profile);

  const stage=normalizeProgramTimelineStage(profile.timelineStage);
  const installCopy=document.getElementById('platformInstallCopy');const installMeta=document.getElementById('platformInstallMeta');const installAction=document.getElementById('platformInstallAction');
  if (profile.platform === 'iOS') {
    const copy={approved:'Complete Testing Setup first, then prepare for your TestFlight invitation.',setupComplete:'Testing Setup is complete. Install or open TestFlight and watch your approved beta email for your Rebatify invitation.',inviteSent:'Your TestFlight invitation has been sent. Open it on your iPhone, accept it, and install Rebatify.',activeTesting:'You are in active beta testing. Keep Rebatify updated through TestFlight.'}[stage];
    const meta={approved:'Complete the required Testing Setup from your timeline.',setupComplete:'Shortcut only: opening TestFlight does not change your Beta Program status. Rebatify updates testing-access stages.',inviteSent:'Use TestFlight to accept your invitation and install Rebatify. This shortcut does not change your timeline status.',activeTesting:'Complete periodic Beta Program tasks, test real workflows, and keep sending meaningful feedback.'}[stage];
    if(installCopy)installCopy.textContent=copy;if(installMeta)installMeta.textContent=meta;if(installAction){installAction.innerHTML='<button class="portal-tile-testflight-button" data-open-testflight type="button">Open TestFlight <span aria-hidden="true">↗</span></button><small class="portal-tile-shortcut-note"><strong>Shortcut only.</strong> Does not advance your Beta Program status.</small>';bindTestFlightButtons(installAction);}
  } else if (profile.platform === 'Android') {
    const copy={approved:'Complete Testing Setup first, then prepare the correct Google Play account.',setupComplete:'Testing Setup is complete. Confirm the correct Google Play account and watch your approved beta email for the closed-testing link.',inviteSent:'Your Google Play testing link has been sent. Open it on your Android phone, opt in, and install Rebatify.',activeTesting:'You are in active beta testing. Keep Rebatify updated through Google Play.'}[stage];
    const meta={approved:'Complete the required Testing Setup from your timeline.',setupComplete:'Google Play must be signed into the Google Account that matches your approved beta email.',inviteSent:'After opting in, install Rebatify, create your app account, and begin testing.',activeTesting:'Complete periodic Beta Program tasks, test real workflows, and keep sending meaningful feedback.'}[stage];
    if(installCopy)installCopy.textContent=copy;if(installMeta)installMeta.textContent=meta;if(installAction)installAction.innerHTML='';
  }
  renderProgramTimeline(profile);
  loading.hidden = true;app.hidden = false;if (content) content.classList.remove('portal-locked-content');
}

if (!firebaseConfigured) {
  loading.innerHTML = '<div class="portal-alert warning">The beta portal is not connected yet. Please check back shortly.</div>';
} else {
  onAuthStateChanged(auth, async user => {
    if (initialized) return;
    if (!user) { fail('session'); return; }
    initialized = true;
    try {
      currentProfile = await loadProfile(user);
      renderProfile(currentProfile);
      startInactivityWatcher();
    } catch (error) {
      fail(error && error.message === 'access' ? 'access' : 'session');
      return;
    }
    // Portal add-ons must never invalidate an otherwise valid authenticated session.
    try {
      await loadRequiredTasks(user.uid);
    } catch (error) {
      console.error('Could not load beta assignments:', error);
      const summaryText = document.getElementById('portalTaskSummaryText');
      if (summaryText) summaryText.textContent = 'Required tasks and Beta News could not be loaded right now. Refresh the portal in a moment or contact Rebatify Support if this continues.';
    }
    try { await loadFeedbackHistory(user.uid); }
    catch (error) { console.error('Could not load tester feedback history:', error); const history=document.getElementById('portalFeedbackHistory');if(history)history.innerHTML='<div class="portal-feedback-history-empty">Your feedback history could not be loaded right now. You can still submit new feedback below.</div>'; }
  });
}

if (logout) {
  logout.addEventListener('click', async () => {
    sessionEnding = true;
    clearTimeout(inactivityTimer);
    sessionStorage.removeItem(PORTAL_ACTIVITY_KEY);
    try { await signOut(auth); } catch (_) {}
    location.replace('beta-login.html');
  });
}

if(taskSubmit)taskSubmit.addEventListener('click',completeRequiredTask);


const setupBackdrop=document.getElementById('portalSetupBackdrop');
function openTestingSetup(){if(!setupBackdrop)return;renderDeviceProfile(currentProfile||{});setupBackdrop.hidden=false;document.body.classList.add('portal-setup-open');}
function closeTestingSetup(){if(!setupBackdrop)return;setupBackdrop.hidden=true;document.body.classList.remove('portal-setup-open');}
const setupClose=document.getElementById('portalSetupClose');if(setupClose)setupClose.addEventListener('click',closeTestingSetup);
if(setupBackdrop)setupBackdrop.addEventListener('click',e=>{if(e.target===setupBackdrop)closeTestingSetup();});
const deviceForm=document.getElementById('portalDeviceForm');
if(deviceForm){deviceForm.addEventListener('submit',async event=>{
  event.preventDefault();if(!auth.currentUser||!currentProfile){fail('session');return;}if(!deviceForm.checkValidity()){deviceForm.reportValidity();return;}
  const button=deviceForm.querySelector('button[type="submit"]');const original=button.innerHTML;button.disabled=true;button.innerHTML='Saving…';setDeviceMessage('');
  const deviceModel=String(document.getElementById('testerDeviceModel').value||'').trim();const osVersion=String(document.getElementById('testerOsVersion').value||'').trim();const screenSize=detectedScreenSize()||String(document.getElementById('testerScreenSize').value||'').trim();
  const stage=normalizeProgramTimelineStage(currentProfile.timelineStage);const firstSetup=stage==='approved';
  try{
    const update={deviceModel,osVersion,screenSize,deviceUpdatedAt:serverTimestamp(),lastPortalActivity:serverTimestamp(),updatedAt:serverTimestamp()};
    if(firstSetup){update.timelineStage='setupComplete';update.timelineUpdatedAt=serverTimestamp();update.deviceSetupCompletedAt=serverTimestamp();}
    await updateDoc(doc(db,'betaUsers',auth.currentUser.uid),update);
    Object.assign(currentProfile,{deviceModel,osVersion,screenSize,deviceUpdatedAt:new Date(),lastPortalActivity:new Date()});if(firstSetup){currentProfile.timelineStage='setupComplete';currentProfile.timelineUpdatedAt=new Date();currentProfile.deviceSetupCompletedAt=new Date();}
    renderDeviceProfile(currentProfile);renderProfile(currentProfile);setDeviceMessage(firstSetup?'Testing Setup saved. Your timeline has advanced.':'Testing Setup saved.','success');setTimeout(closeTestingSetup,450);
  }catch(error){setDeviceMessage('We could not save your testing setup. '+friendlyFirebaseError(error),'error');}
  finally{button.disabled=false;button.innerHTML=original;}
});}

document.addEventListener('click',event=>{
  const ack=event.target.closest('[data-ack-announcement]');if(ack){acknowledgeAnnouncement(ack.dataset.ackAnnouncement,ack);return;}
  const setup=event.target.closest('[data-open-testing-setup]');if(setup){openTestingSetup();return;}
  const req=event.target.closest('[data-open-required-task]');if(req){const found=requiredTasks.find(t=>t.id===req.dataset.openRequiredTask);if(found){requiredTasks=[found,...requiredTasks.filter(t=>t.id!==found.id)];renderRequiredTask();}return;}
  const retest=event.target.closest('[data-retest-feedback]');if(retest){openRetestFeedback(retest.dataset.retestFeedback);return;}
});
const retestClose=document.getElementById('portalRetestClose');if(retestClose)retestClose.addEventListener('click',closeRetestFeedback);
const retestBackdrop=document.getElementById('portalRetestBackdrop');if(retestBackdrop)retestBackdrop.addEventListener('click',event=>{if(event.target===retestBackdrop)closeRetestFeedback();});
const retestSubmit=document.getElementById('portalRetestSubmit');if(retestSubmit)retestSubmit.addEventListener('click',submitRetest);

if (feedbackForm) {
  feedbackForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!feedbackForm.checkValidity()) { feedbackForm.reportValidity(); return; }
    if (!auth.currentUser || !currentProfile) { fail('session'); return; }

    const button = feedbackForm.querySelector('button[type="submit"]');
    const original = button.innerHTML;button.disabled = true;button.innerHTML = 'Submitting…';setFeedbackMessage('');
    if(!String(currentProfile.deviceModel||'').trim()||!String(currentProfile.osVersion||'').trim()||!String(currentProfile.screenSize||'').trim()){setFeedbackMessage('Complete Testing Setup before submitting feedback so your device details can be attached to the report.','error');openTestingSetup();button.disabled=false;button.innerHTML=original;return;}
    const data = new FormData(feedbackForm);
    const appVersion=String(data.get('appVersion') || '').trim();
    if(!/^Build [0-9]+$/.test(appVersion)){setFeedbackMessage('Enter the Build number in the format “Build 228”.','error');button.disabled=false;button.innerHTML=original;return;}
    const deviceDetails=String(data.get('deviceDetails') || profileDeviceDetails(currentProfile) || '').trim();
    const payload = {
      ownerUid: auth.currentUser.uid,name: currentProfile.name || '',email: currentProfile.email || auth.currentUser.email || '',platform: currentProfile.platform || '',
      type: String(data.get('feedbackType') || '').trim(),subject: String(data.get('subject') || '').trim(),details: String(data.get('details') || '').trim(),appVersion,deviceDetails,
      deviceModel:String(currentProfile.deviceModel||'').trim(),osVersion:String(currentProfile.osVersion||'').trim(),screenSize:String(currentProfile.screenSize||'').trim(),pageFeature: String(data.get('pageFeature') || '').trim(),
      status: 'New',adminNotes: '',submittedAt: serverTimestamp(),updatedAt: serverTimestamp()
    };

    try {
      const ref=await addDoc(collection(db, 'betaFeedback'), payload);
      const local={id:ref.id,...payload,submittedAt:new Date(),updatedAt:new Date()};feedbackHistory.unshift(local);renderFeedbackHistory();
      if(appVersion)currentProfile.currentBuild=appVersion;
      await updateDoc(doc(db,'betaUsers',auth.currentUser.uid),{lastFeedbackSubmittedAt:serverTimestamp(),lastPortalActivity:serverTimestamp(),...(appVersion?{currentBuild:appVersion}:{}),updatedAt:serverTimestamp()}).catch(()=>{});
      feedbackForm.reset();renderDeviceProfile(currentProfile);setFeedbackMessage('Thank you — your feedback was submitted.', 'success');workerPostAuthorized('feedback-submitted',{feedbackId:ref.id}).catch(err=>console.warn('Feedback email notification failed:',err));
    } catch (error) {
      setFeedbackMessage('We could not submit your feedback right now. ' + friendlyFirebaseError(error), 'error');
    } finally {button.disabled = false;button.innerHTML = original;}
  });
}
