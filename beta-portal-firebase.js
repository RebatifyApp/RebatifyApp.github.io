// Rebatify Beta Tester Portal - Website Build 74
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
  getDocs,
  orderBy,
  onSnapshot
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
let activeConversation = null;
let feedbackHistoryUnsubscribe = null;
let conversationMessagesUnsubscribe = null;
let conversationMessageCount = 0;
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
  if(os){os.value=profile.osVersion||'';os.placeholder=profile.platform==='Android'?'Example: Android 17':'Example: iOS 27';}
  if(screen)screen.value=detectedScreenSize()||profile.screenSize||'';
  const deviceDetails=document.getElementById('deviceDetails');if(deviceDetails)deviceDetails.value=profileDeviceDetails(profile)||'Complete Testing Setup first';
  applyTestingSetupPlatformCopy(profile);
}
function applyTestingSetupPlatformCopy(profile=currentProfile||{}){
  const ios=String(profile.platform||'')==='iOS';
  const email=String(profile.email||auth.currentUser?.email||'').trim();
  const os=document.getElementById('testerOsVersion');if(os)os.placeholder=ios?'Example: iOS 27':'Example: Android 17';
  const label=document.getElementById('testerDistributionEmailLabel');if(label)label.innerHTML=(ios?'Apple Account email':'Google Play account email')+' <span class="portal-required-inline">Required</span>';
  const input=document.getElementById('testerDistributionEmail');if(input)input.value=email;
  const help=document.getElementById('testerDistributionEmailHelp');if(help)help.textContent=ios?'Confirm the Apple Account currently signed in to the App Store/TestFlight on the iPhone or iPad you will use for testing.':'Confirm the Google Account currently selected in Google Play on the Android device you will use for testing.';
  const confirmText=document.getElementById('testerDistributionConfirmText');if(confirmText)confirmText.textContent=ios?'I confirm this is the Apple Account signed in on my testing iPhone or iPad.':'I confirm this is the Google Account selected in Google Play on my testing Android device.';
  const intro=document.getElementById('portalSetupIntro');if(intro)intro.textContent=ios?'Confirm the iPhone or iPad, iOS/iPadOS version, and Apple Account you will use for Rebatify beta testing.':'Confirm the Android device, Android version, and Google Play account you will use for Rebatify beta testing.';
}
function distributionAccountConfirmed(profile=currentProfile||{}){
  return !!String(profile.distributionAccountEmail||'').trim() && !!profile.distributionAccountConfirmedAt;
}
function testingSetupComplete(profile=currentProfile||{}){
  return !!String(profile.deviceModel||'').trim() && !!String(profile.osVersion||'').trim() && !!String(profile.screenSize||'').trim() && distributionAccountConfirmed(profile);
}

function isSupportConversation(f){return String(f&&f.workflowType||'Feedback')==='Support'||String(f&&f.type||'')==='Account / Access Problem';}
function feedbackPublicStatus(f){
  if(isSupportConversation(f)){
    const status=String(f.status||'Waiting for Rebatify');
    if(status==='Resolved')return {label:'Resolved',className:'resolved'};
    if(status==='Waiting for Tester')return {label:'Waiting for you',className:'testing'};
    return {label:'Waiting for Rebatify',className:'reviewing'};
  }
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
function maybePromptPendingRetest(){
  const pendingRetest=feedbackHistory.find(f=>String(f.status||'')==='Needs Retest'&&!f.retestedAt);
  if(!pendingRetest)return;
  const promptKey='rebatifyBetaRetestPrompted:'+pendingRetest.id;
  if(!sessionStorage.getItem(promptKey)){
    sessionStorage.setItem(promptKey,'1');
    setTimeout(()=>openRetestFeedback(pendingRetest.id),350);
  }
}
function syncOpenConversationHeader(){
  if(!activeConversation)return;
  const fresh=feedbackHistory.find(f=>f.id===activeConversation.id);
  if(fresh)activeConversation=fresh;
  const f=activeConversation;
  const title=document.getElementById('portalConversationTitle');if(title)title.textContent=f.subject||'Conversation';
  const kicker=document.getElementById('portalConversationKicker');if(kicker)kicker.textContent=isSupportConversation(f)?'Support Conversation':'Beta Feedback Conversation';
  const type=document.getElementById('portalConversationType');if(type)type.textContent=f.type||'';
  const ps=feedbackPublicStatus(f);const status=document.getElementById('portalConversationStatus');if(status){status.textContent=ps.label;status.className='portal-feedback-public-status '+ps.className;}
}
async function loadFeedbackHistory(uid){
  if(feedbackHistoryUnsubscribe){feedbackHistoryUnsubscribe();feedbackHistoryUnsubscribe=null;}
  return new Promise((resolve,reject)=>{
    let first=true;
    const q=query(collection(db,'betaFeedback'),where('ownerUid','==',uid),where('adminNotes','==',''));
    feedbackHistoryUnsubscribe=onSnapshot(q,snap=>{
      feedbackHistory=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(timestampToDate(b.lastMessageAt||b.updatedAt||b.submittedAt)?.getTime()||0)-(timestampToDate(a.lastMessageAt||a.updatedAt||a.submittedAt)?.getTime()||0));
      renderFeedbackHistory();
      renderPortalTaskSummary();
      syncOpenConversationHeader();
      maybePromptPendingRetest();
      if(first){first=false;resolve();}
    },error=>{
      console.error('Realtime Help & Feedback listener failed:',error);
      if(first){first=false;reject(error);}
    });
  });
}
function renderFeedbackHistory(){
  const list=document.getElementById('portalFeedbackHistory');if(!list)return;
  if(!feedbackHistory.length){list.innerHTML='<div class="portal-feedback-history-empty">No conversations yet.</div>';return;}
  list.innerHTML=feedbackHistory.slice(0,40).map(f=>{
    const publicStatus=feedbackPublicStatus(f);const support=isSupportConversation(f);const needsRetest=!support&&String(f.status||'')==='Needs Retest'&&!f.retestedAt;const replyNeeded=support&&String(f.status||'')==='Waiting for Tester';
    const action=needsRetest?`<button class="portal-retest-button" data-retest-feedback="${escapeHtml(f.id)}" type="button">Retest This Issue</button>`:(replyNeeded?`<button class="portal-conversation-open portal-reply-needed-button" data-open-conversation="${escapeHtml(f.id)}" type="button">Reply Needed</button>`:'');
    const workflow=support?'Support':'Beta Feedback';
    return `<article class="portal-feedback-history-card${(needsRetest||replyNeeded)?' needs-action':''}"><div class="portal-feedback-history-top"><div><span>${escapeHtml(workflow)} · ${escapeHtml(f.type||'Conversation')}</span><h3>${escapeHtml(f.subject||'Conversation')}</h3></div><span class="portal-feedback-public-status ${publicStatus.className}">${escapeHtml(publicStatus.label)}</span></div><p>${escapeHtml(f.details||'')}</p><div class="portal-feedback-history-meta"><span>${escapeHtml(formatPortalDate(f.lastMessageAt||f.updatedAt||f.submittedAt))}</span>${f.appVersion?`<span>${escapeHtml(f.appVersion)}</span>`:''}${f.pageFeature?`<span>${escapeHtml(f.pageFeature)}</span>`:''}${f.supportAccountEmail?`<span>${escapeHtml(f.supportAccountEmail)}</span>`:''}</div>${f.retestedAt?`<div class="portal-retest-result"><strong>${escapeHtml(f.retestResult||'Retest submitted')}</strong>${f.retestNotes?`<span>${escapeHtml(f.retestNotes)}</span>`:''}</div>`:''}<div class="portal-conversation-card-actions"><button class="portal-conversation-open" data-open-conversation="${escapeHtml(f.id)}" type="button">Open Conversation</button>${action}</div></article>`;
  }).join('');
}

function formatPortalMessageTime(value){
  const d=timestampToDate(value);if(!d)return 'Sending…';
  const now=new Date();const sameDay=d.toDateString()===now.toDateString();
  return sameDay?d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):d.toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
function conversationMessageHtml(message){
  const admin=String(message.authorRole||'').toLowerCase()==='admin';
  return `<div class="portal-chat-message ${admin?'from-rebatify':'from-tester'}"><div class="portal-chat-message-head"><strong>${admin?'Rebatify':'You'}</strong><time>${escapeHtml(formatPortalMessageTime(message.createdAt))}</time></div><p>${escapeHtml(message.body||'')}</p></div>`;
}
function scrollConversationToLatest(behavior='auto'){
  const thread=document.getElementById('portalConversationThread');
  if(!thread)return;
  requestAnimationFrame(()=>thread.scrollTo({top:thread.scrollHeight,behavior}));
}
function resizeConversationComposer(){
  const input=document.getElementById('portalConversationReply');
  if(!input)return;
  input.style.height='auto';
  input.style.height=Math.min(Math.max(input.scrollHeight,48),112)+'px';
}
function renderOpenConversationThread(messages=[]){
  if(!activeConversation)return;
  const thread=document.getElementById('portalConversationThread');if(!thread)return;
  const f=activeConversation;
  const original=`<div class="portal-chat-message from-tester initial"><div class="portal-chat-message-head"><strong>You <span class="portal-chat-original-label">Original</span></strong><time>${escapeHtml(formatPortalMessageTime(f.submittedAt))}</time></div><p>${escapeHtml(f.details||'')}</p><div class="portal-chat-meta-list">${f.supportAccountEmail?`<span>Account: ${escapeHtml(f.supportAccountEmail)}</span>`:''}${f.appVersion?`<span>${escapeHtml(f.appVersion)}</span>`:''}${f.pageFeature?`<span>${escapeHtml(f.pageFeature)}</span>`:''}</div></div>`;
  const replies=messages.map(conversationMessageHtml).join('');
  const retest=f.retestedAt?`<div class="portal-chat-system"><strong>Retest submitted: ${escapeHtml(f.retestResult||'Retest submitted')}</strong>${f.retestNotes?`<span>${escapeHtml(f.retestNotes)}</span>`:''}</div>`:'';
  const nextCount=messages.length+(f.retestedAt?1:0)+1;
  const animate=conversationMessageCount>0&&nextCount>conversationMessageCount;
  conversationMessageCount=nextCount;
  thread.innerHTML=original+replies+retest;
  scrollConversationToLatest(animate?'smooth':'auto');
}
function subscribeConversationMessages(feedbackId){
  if(conversationMessagesUnsubscribe){conversationMessagesUnsubscribe();conversationMessagesUnsubscribe=null;}
  const thread=document.getElementById('portalConversationThread');if(thread)thread.insertAdjacentHTML('beforeend','<div class="portal-chat-loading">Connecting live conversation…</div>');
  conversationMessagesUnsubscribe=onSnapshot(query(collection(db,'betaFeedback',feedbackId,'messages'),orderBy('createdAt','asc')),snap=>{
    if(!activeConversation||activeConversation.id!==feedbackId)return;
    const messages=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderOpenConversationThread(messages);
  },error=>{
    console.error('Realtime conversation listener failed:',error);
    const loading=document.querySelector('#portalConversationThread .portal-chat-loading');if(loading)loading.textContent='Live replies could not be loaded right now.';
  });
}
function openConversation(id){
  const f=feedbackHistory.find(x=>x.id===id);if(!f)return;activeConversation=f;
  const back=document.getElementById('portalConversationBackdrop');
  syncOpenConversationHeader();
  const reply=document.getElementById('portalConversationReply');if(reply)reply.value='';
  const message=document.getElementById('portalConversationMessage');if(message){message.textContent='';message.className='portal-task-message';}
  const thread=document.getElementById('portalConversationThread');if(thread)thread.innerHTML='';
  conversationMessageCount=0;back.hidden=false;document.body.classList.add('portal-conversation-active');
  renderOpenConversationThread([]);
  resizeConversationComposer();
  subscribeConversationMessages(id);
}
function closeConversation(){
  if(conversationMessagesUnsubscribe){conversationMessagesUnsubscribe();conversationMessagesUnsubscribe=null;}
  conversationMessageCount=0;activeConversation=null;const back=document.getElementById('portalConversationBackdrop');if(back)back.hidden=true;document.body.classList.remove('portal-conversation-active');
}
async function sendConversationReply(){
  if(!activeConversation||!auth.currentUser)return;const input=document.getElementById('portalConversationReply');const body=String(input.value||'').trim();const message=document.getElementById('portalConversationMessage');
  if(!body){message.textContent='Write a reply before sending.';message.className='portal-task-message error';input?.focus();return;}
  const btn=document.getElementById('portalConversationSend');const original=btn.innerHTML;btn.disabled=true;btn.innerHTML='Sending…';message.textContent='';
  try{
    const feedbackId=activeConversation.id;
    const ref=await addDoc(collection(db,'betaFeedback',feedbackId,'messages'),{authorUid:auth.currentUser.uid,authorRole:'Tester',authorName:currentProfile?.name||'Tester',body,createdAt:serverTimestamp()});
    const update={lastMessageAt:serverTimestamp(),lastMessageBy:'Tester',updatedAt:serverTimestamp()};
    if(isSupportConversation(activeConversation))update.status='Waiting for Rebatify';
    await updateDoc(doc(db,'betaFeedback',feedbackId),update);
    input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));resizeConversationComposer();message.textContent='';message.className='portal-task-message';scrollConversationToLatest('smooth');
    workerPostAuthorized('conversation-reply-added',{feedbackId,messageId:ref.id}).catch(err=>console.warn('Conversation reply email failed:',err));
  }catch(error){message.textContent='We could not send your reply. '+friendlyFirebaseError(error);message.className='portal-task-message error';}
  finally{btn.disabled=false;btn.innerHTML=original;}
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
  const ios=profile.platform==='iOS';const stage=normalizeProgramTimelineStage(profile.timelineStage);const setupDone=testingSetupComplete(profile);
  const accessCopy=ios
    ? (stage==='inviteSent'||stage==='activeTesting'?'Your <strong>TestFlight invitation has been sent</strong> to your approved beta email. Open it on your iPhone, accept it in TestFlight, and install Rebatify.':'Prepare your iPhone for TestFlight and watch your approved beta email for the Rebatify invitation. Rebatify will advance this stage when testing access is released.')
    : (stage==='inviteSent'||stage==='activeTesting'?'Your <strong>Google Play closed-testing link has been sent</strong> to your approved beta email. Open it on your Android phone, opt in, and install Rebatify.':'Make sure Google Play uses the Google Account that matches your approved beta email, then watch for the closed-testing link. Rebatify will advance this stage when testing access is released.');
  const setupAction=setupDone
    ? '<div class="portal-timeline-completed-note">Testing Setup is complete. You can update your saved device details later from <strong>Settings</strong>.</div>'
    : `<div class="portal-timeline-actions"><button class="portal-testflight-button portal-setup-button" data-open-testing-setup type="button"><span>Complete Testing Setup</span></button><small>Confirm your testing device and ${ios?'Apple Account':'Google Play account'} before continuing.</small></div>`;
  const content=[
    ['Approved for the Rebatify Beta Program','Your application is approved and your private Beta Program Portal access is active.',''],
    ['Complete Testing Setup','Confirm the device, operating-system version, automatically detected screen size, and the account you will use to receive and install the beta build.',setupAction],
    [ios?'Prepare your iPhone & watch for TestFlight':'Prepare your Android phone & watch for testing access',accessCopy,(ios&&setupDone)?testFlightActionHtml():''],
    ['Install Rebatify, create your account & begin testing',ios?'After accepting the TestFlight invitation, install Rebatify and create your Rebatify app account. Then use real rebate activity when possible, complete required Beta Program tasks, and send feedback through this portal.':'After opting in through Google Play, install Rebatify and create your Rebatify app account. Then use real rebate activity when possible, complete required Beta Program tasks, and send feedback through this portal.','']
  ];
  let visuals;
  if(!setupDone){
    visuals=['complete','now','waiting','waiting'];
  }else if(stage==='approved'||stage==='setupComplete'){
    visuals=['complete','complete','now','waiting'];
  }else if(stage==='inviteSent'){
    visuals=['complete','complete','complete','now'];
  }else{
    visuals=['complete','complete','complete','ongoing'];
  }
  timeline.innerHTML=content.map((item,index)=>timelineStep(index+1,visuals[index],item[0],item[1],item[2])).join('');
  bindTestFlightButtons(timeline);
  timeline.querySelectorAll('[data-open-testing-setup]').forEach(btn=>btn.addEventListener('click',openTestingSetup));
  if(footnote){
    const currentLabel=!setupDone?'Testing Setup Required':({approved:'Testing Setup Complete',setupComplete:'Waiting for Testing Access',inviteSent:ios?'TestFlight Invitation Sent':'Google Play Testing Link Sent',activeTesting:'Active Beta Testing'}[stage]);
    footnote.innerHTML='<strong>How progress works:</strong> Approval completes Step 1 automatically. Completing Testing Setup marks Step 2 complete and advances you to Step 3. Rebatify controls the later testing-access stages. Opening TestFlight, Google Play, or Rebatify by itself does not advance your program status.'+`<br><span class="portal-timeline-current"><strong>Current program stage:</strong> ${currentLabel}</span>`;
  }
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

  const stage=normalizeProgramTimelineStage(profile.timelineStage);const setupDone=testingSetupComplete(profile);
  const installCopy=document.getElementById('platformInstallCopy');const installMeta=document.getElementById('platformInstallMeta');const installAction=document.getElementById('platformInstallAction');
  if (profile.platform === 'iOS') {
    const copy=!setupDone?'Complete Testing Setup first, then prepare for your TestFlight invitation.':({approved:'Testing Setup is complete. Install or open TestFlight and watch your approved beta email for your Rebatify invitation.',setupComplete:'Testing Setup is complete. Install or open TestFlight and watch your approved beta email for your Rebatify invitation.',inviteSent:'Your TestFlight invitation has been sent. Open it on your iPhone, accept it, and install Rebatify.',activeTesting:'You are in active beta testing. Keep Rebatify updated through TestFlight.'}[stage]);
    const meta=!setupDone?'Complete the required Testing Setup from Step 2 of your timeline.':({approved:'Shortcut only: opening TestFlight does not change your Beta Program status. Rebatify updates testing-access stages.',setupComplete:'Shortcut only: opening TestFlight does not change your Beta Program status. Rebatify updates testing-access stages.',inviteSent:'Use TestFlight to accept your invitation and install Rebatify. This shortcut does not change your timeline status.',activeTesting:'Complete periodic Beta Program tasks, test real workflows, and keep sending meaningful feedback.'}[stage]);
    if(installCopy)installCopy.textContent=copy;if(installMeta)installMeta.textContent=meta;if(installAction){installAction.innerHTML=setupDone?'<button class="portal-tile-testflight-button" data-open-testflight type="button">Open TestFlight <span aria-hidden="true">↗</span></button><small class="portal-tile-shortcut-note"><strong>Shortcut only.</strong> Does not advance your Beta Program status.</small>':'<small class="portal-tile-shortcut-note"><strong>Complete Step 2 first.</strong> The TestFlight shortcut will appear after Testing Setup is complete.</small>';bindTestFlightButtons(installAction);}
  } else if (profile.platform === 'Android') {
    const copy=!setupDone?'Complete Testing Setup first, then prepare the correct Google Play account.':({approved:'Testing Setup is complete. Confirm the correct Google Play account and watch your approved beta email for the closed-testing link.',setupComplete:'Testing Setup is complete. Confirm the correct Google Play account and watch your approved beta email for the closed-testing link.',inviteSent:'Your Google Play testing link has been sent. Open it on your Android phone, opt in, and install Rebatify.',activeTesting:'You are in active beta testing. Keep Rebatify updated through Google Play.'}[stage]);
    const meta=!setupDone?'Complete the required Testing Setup from Step 2 of your timeline.':({approved:'Google Play must be signed into the Google Account that matches your approved beta email.',setupComplete:'Google Play must be signed into the Google Account that matches your approved beta email.',inviteSent:'After opting in, install Rebatify, create your app account, and begin testing.',activeTesting:'Complete periodic Beta Program tasks, test real workflows, and keep sending meaningful feedback.'}[stage]);
    if(installCopy)installCopy.textContent=copy;if(installMeta)installMeta.textContent=meta;if(installAction)installAction.innerHTML='';
  }
  renderProgramTimeline(profile);
  loading.hidden = true;app.hidden = false;if (content) content.classList.remove('portal-locked-content');
}

function updateHelpFormForType(){
  const type=String(document.getElementById('feedbackType')?.value||'');const support=type==='Account / Access Problem';
  const supportField=document.getElementById('supportAccountField');const technical=document.getElementById('feedbackTechnicalFields');
  const supportEmail=document.getElementById('supportAccountEmail');const pageFeature=document.getElementById('pageFeature');const appVersion=document.getElementById('appVersion');const deviceDetails=document.getElementById('deviceDetails');
  if(supportField)supportField.hidden=!support;if(technical)technical.hidden=support;
  if(supportEmail){supportEmail.required=support;supportEmail.setAttribute('aria-required',support?'true':'false');if(support&&!supportEmail.value&&currentProfile) supportEmail.value=String(currentProfile.email||auth.currentUser?.email||'').trim();}
  [pageFeature,appVersion,deviceDetails].forEach(field=>{if(!field)return;field.required=!support;field.setAttribute('aria-required',support?'false':'true');});
}
function prefillAccountMismatchHelp(){
  if(!currentProfile)return;closeTestingSetup();
  const type=document.getElementById('feedbackType');const subject=document.getElementById('feedbackSubject');const details=document.getElementById('feedbackDetails');const supportEmail=document.getElementById('supportAccountEmail');
  const ios=currentProfile.platform==='iOS';const approved=String(currentProfile.email||auth.currentUser?.email||'').trim();
  if(type)type.value='Account / Access Problem';updateHelpFormForType();
  if(subject){subject.value='Beta account email mismatch';subject.dispatchEvent(new Event('input',{bubbles:true}));}
  if(details){details.value=`My approved beta email is ${approved}, but this is not the ${ios?'Apple Account used for App Store/TestFlight':'Google Account selected in Google Play'} on my testing device. Please help correct my beta access.`;details.dispatchEvent(new Event('input',{bubbles:true}));}
  if(supportEmail){supportEmail.value='';supportEmail.dispatchEvent(new Event('input',{bubbles:true}));}
  document.getElementById('submit-feedback')?.scrollIntoView({behavior:'smooth',block:'start'});setTimeout(()=>supportEmail?.focus(),450);
}
function handleHelpQuery(){
  const params=new URLSearchParams(location.search);if(params.get('help')==='account-mismatch')setTimeout(prefillAccountMismatchHelp,350);
}

function installTextEntryCompatibility(root=document){
  const fields=root.querySelectorAll('input[type="text"],input[type="email"],input[type="search"],input[type="url"],textarea');
  fields.forEach(field=>{
    if(field.dataset.rebatifyTextEntryReady==='1')return;
    field.dataset.rebatifyTextEntryReady='1';
    const sync=()=>{field.setCustomValidity('');field.dataset.rebatifyValue=field.value;};
    field.addEventListener('input',sync);
    field.addEventListener('change',sync);
    field.addEventListener('compositionend',sync);
    field.addEventListener('blur',sync);
    field.addEventListener('paste',()=>requestAnimationFrame(sync));
  });
  const build=document.getElementById('appVersion');
  if(build&&build.dataset.rebatifyBuildReady!=='1'){
    build.dataset.rebatifyBuildReady='1';let composing=false;
    const sanitize=()=>{if(composing)return;const next=String(build.value||'').replace(/\D+/g,'').slice(0,6);if(build.value!==next)build.value=next;build.setCustomValidity('');};
    build.addEventListener('compositionstart',()=>{composing=true;});
    build.addEventListener('compositionend',()=>{composing=false;sanitize();});
    build.addEventListener('input',sanitize);
    build.addEventListener('change',sanitize);
    build.addEventListener('paste',()=>requestAnimationFrame(sanitize));
  }
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
    catch (error) { console.error('Could not load tester feedback history:', error); const history=document.getElementById('portalFeedbackHistory');if(history)history.innerHTML='<div class="portal-feedback-history-empty">Your conversations could not be loaded right now. You can still start a new Help & Feedback conversation below.</div>'; }
    handleHelpQuery();
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
function openTestingSetup(){if(!setupBackdrop)return;renderDeviceProfile(currentProfile||{});const confirm=document.getElementById('testerDistributionConfirm');if(confirm)confirm.checked=distributionAccountConfirmed(currentProfile||{});setupBackdrop.hidden=false;document.body.classList.add('portal-setup-open');}
function closeTestingSetup(){if(!setupBackdrop)return;setupBackdrop.hidden=true;document.body.classList.remove('portal-setup-open');}
const setupClose=document.getElementById('portalSetupClose');if(setupClose)setupClose.addEventListener('click',closeTestingSetup);
if(setupBackdrop)setupBackdrop.addEventListener('click',e=>{if(e.target===setupBackdrop)closeTestingSetup();});
const deviceForm=document.getElementById('portalDeviceForm');
if(deviceForm){deviceForm.addEventListener('submit',async event=>{
  event.preventDefault();if(!auth.currentUser||!currentProfile){fail('session');return;}if(!deviceForm.checkValidity()){deviceForm.reportValidity();return;}
  const button=deviceForm.querySelector('button[type="submit"]');const original=button.innerHTML;button.disabled=true;button.innerHTML='Saving…';setDeviceMessage('');
  const deviceModel=String(document.getElementById('testerDeviceModel').value||'').trim();const osVersion=String(document.getElementById('testerOsVersion').value||'').trim();const screenSize=detectedScreenSize()||String(document.getElementById('testerScreenSize').value||'').trim();
  const distributionAccountEmail=String(currentProfile.email||auth.currentUser.email||'').trim();const distributionConfirm=document.getElementById('testerDistributionConfirm');
  if(!distributionAccountEmail){setDeviceMessage('Your approved beta email could not be loaded. Contact Rebatify Support before continuing.','error');button.disabled=false;button.innerHTML=original;return;}
  if(!distributionConfirm||!distributionConfirm.checked){setDeviceMessage('Confirm the account you use for beta distribution before continuing.','error');button.disabled=false;button.innerHTML=original;return;}
  const stage=normalizeProgramTimelineStage(currentProfile.timelineStage);const firstSetup=stage==='approved';const needsAccountConfirmation=!distributionAccountConfirmed(currentProfile);
  try{
    const update={deviceModel,osVersion,screenSize,deviceUpdatedAt:serverTimestamp(),lastPortalActivity:serverTimestamp(),updatedAt:serverTimestamp()};
    if(needsAccountConfirmation){update.distributionAccountEmail=distributionAccountEmail;update.distributionAccountConfirmedAt=serverTimestamp();}
    if(firstSetup){update.timelineStage='setupComplete';update.timelineUpdatedAt=serverTimestamp();update.deviceSetupCompletedAt=serverTimestamp();}
    await updateDoc(doc(db,'betaUsers',auth.currentUser.uid),update);
    Object.assign(currentProfile,{deviceModel,osVersion,screenSize,deviceUpdatedAt:new Date(),lastPortalActivity:new Date()});if(needsAccountConfirmation){currentProfile.distributionAccountEmail=distributionAccountEmail;currentProfile.distributionAccountConfirmedAt=new Date();}if(firstSetup){currentProfile.timelineStage='setupComplete';currentProfile.timelineUpdatedAt=new Date();currentProfile.deviceSetupCompletedAt=new Date();}
    renderDeviceProfile(currentProfile);renderProfile(currentProfile);setDeviceMessage(firstSetup?'Testing Setup saved. Step 2 is complete and your timeline advanced to Step 3.':'Testing Setup saved.','success');setTimeout(closeTestingSetup,650);
  }catch(error){setDeviceMessage('We could not save your testing setup. '+friendlyFirebaseError(error),'error');}
  finally{button.disabled=false;button.innerHTML=original;}
});}

document.addEventListener('click',event=>{
  const ack=event.target.closest('[data-ack-announcement]');if(ack){acknowledgeAnnouncement(ack.dataset.ackAnnouncement,ack);return;}
  const setup=event.target.closest('[data-open-testing-setup]');if(setup){openTestingSetup();return;}
  const mismatch=event.target.closest('[data-account-mismatch]');if(mismatch){prefillAccountMismatchHelp();return;}
  const convo=event.target.closest('[data-open-conversation]');if(convo){openConversation(convo.dataset.openConversation);return;}
  const req=event.target.closest('[data-open-required-task]');if(req){const found=requiredTasks.find(t=>t.id===req.dataset.openRequiredTask);if(found){requiredTasks=[found,...requiredTasks.filter(t=>t.id!==found.id)];renderRequiredTask();}return;}
  const retest=event.target.closest('[data-retest-feedback]');if(retest){openRetestFeedback(retest.dataset.retestFeedback);return;}
});
const retestClose=document.getElementById('portalRetestClose');if(retestClose)retestClose.addEventListener('click',closeRetestFeedback);
const retestBackdrop=document.getElementById('portalRetestBackdrop');if(retestBackdrop)retestBackdrop.addEventListener('click',event=>{if(event.target===retestBackdrop)closeRetestFeedback();});
const retestSubmit=document.getElementById('portalRetestSubmit');if(retestSubmit)retestSubmit.addEventListener('click',submitRetest);
const conversationClose=document.getElementById('portalConversationClose');if(conversationClose)conversationClose.addEventListener('click',closeConversation);
const conversationBackdrop=document.getElementById('portalConversationBackdrop');if(conversationBackdrop)conversationBackdrop.addEventListener('click',event=>{if(event.target===conversationBackdrop)closeConversation();});
const conversationSend=document.getElementById('portalConversationSend');if(conversationSend)conversationSend.addEventListener('click',sendConversationReply);
const conversationReplyInput=document.getElementById('portalConversationReply');if(conversationReplyInput){conversationReplyInput.addEventListener('input',resizeConversationComposer);conversationReplyInput.addEventListener('compositionend',resizeConversationComposer);}
const feedbackTypeSelect=document.getElementById('feedbackType');if(feedbackTypeSelect)feedbackTypeSelect.addEventListener('change',updateHelpFormForType);updateHelpFormForType();installTextEntryCompatibility();

if (feedbackForm) {
  feedbackForm.addEventListener('submit', async event => {
    event.preventDefault();
    feedbackForm.classList.add('is-validation-attempted');
    if (!feedbackForm.checkValidity()) { feedbackForm.reportValidity(); return; }
    if (!auth.currentUser || !currentProfile) { fail('session'); return; }
    const button=feedbackForm.querySelector('button[type="submit"]');const original=button.innerHTML;button.disabled=true;button.innerHTML='Submitting…';setFeedbackMessage('');
    const data=new FormData(feedbackForm);const type=String(data.get('feedbackType')||'').trim();const support=type==='Account / Access Problem';
    if(!support&&!testingSetupComplete(currentProfile)){setFeedbackMessage('Complete Testing Setup before submitting beta feedback so the report includes your confirmed testing account and device information.','error');openTestingSetup();button.disabled=false;button.innerHTML=original;return;}
    const buildNumber=support?'':String(data.get('appVersion')||'').trim();
    if(!support&&!/^[0-9]+$/.test(buildNumber)){setFeedbackMessage('Enter only the Build number, for example “228”.','error');button.disabled=false;button.innerHTML=original;return;}
    const appVersion=support?'':`Build ${buildNumber}`;
    const deviceDetails=support?String(profileDeviceDetails(currentProfile)||'').trim():String(data.get('deviceDetails')||profileDeviceDetails(currentProfile)||'').trim();
    const payload={
      ownerUid:auth.currentUser.uid,name:currentProfile.name||'',email:currentProfile.email||auth.currentUser.email||'',platform:currentProfile.platform||'',
      workflowType:support?'Support':'Feedback',type,subject:String(data.get('subject')||'').trim(),details:String(data.get('details')||'').trim(),appVersion,deviceDetails,
      deviceModel:String(currentProfile.deviceModel||'').trim(),osVersion:String(currentProfile.osVersion||'').trim(),screenSize:String(currentProfile.screenSize||detectedScreenSize()||'').trim(),pageFeature:support?'':String(data.get('pageFeature')||'').trim(),
      supportAccountEmail:support?String(data.get('supportAccountEmail')||'').trim():'',status:support?'Waiting for Rebatify':'New',adminNotes:'',lastMessageAt:serverTimestamp(),lastMessageBy:'Tester',submittedAt:serverTimestamp(),updatedAt:serverTimestamp()
    };
    try{
      const ref=await addDoc(collection(db,'betaFeedback'),payload);const local={id:ref.id,...payload,submittedAt:new Date(),updatedAt:new Date(),lastMessageAt:new Date()};feedbackHistory.unshift(local);renderFeedbackHistory();
      if(appVersion)currentProfile.currentBuild=appVersion;
      if(support){
        await updateDoc(doc(db,'betaUsers',auth.currentUser.uid),{lastPortalActivity:serverTimestamp(),updatedAt:serverTimestamp()}).catch(()=>{});
      }else{
        await updateDoc(doc(db,'betaUsers',auth.currentUser.uid),{lastFeedbackSubmittedAt:serverTimestamp(),lastPortalActivity:serverTimestamp(),currentBuild:appVersion,updatedAt:serverTimestamp()}).catch(()=>{});
      }
      feedbackForm.reset();feedbackForm.classList.remove('is-validation-attempted');updateHelpFormForType();renderDeviceProfile(currentProfile);setFeedbackMessage(support?'Your support conversation was started. Rebatify has been notified.':'Thank you — your feedback conversation was started.','success');
      workerPostAuthorized('feedback-submitted',{feedbackId:ref.id}).catch(err=>console.warn('Help & Feedback email notification failed:',err));
      setTimeout(()=>openConversation(ref.id),300);
    }catch(error){setFeedbackMessage('We could not start your conversation right now. '+friendlyFirebaseError(error),'error');}
    finally{button.disabled=false;button.innerHTML=original;}
  });
}
