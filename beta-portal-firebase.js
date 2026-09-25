// RebataTrack Beta Tester Portal - Website Build 110
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
let profileUnsubscribe = null;
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
const PORTAL_CONVERSATION_READ_KEY = 'rebatifyBetaConversationReads';


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
  const help=document.getElementById('testerDistributionEmailHelp');if(help)help.textContent=ios?'This approved beta email must match the Apple Account signed in for the App Store/TestFlight on the iPhone or iPad where you installed TestFlight.':'Confirm the Google Account currently selected in Google Play on the Android device you will use for testing.';
  const confirmText=document.getElementById('testerDistributionConfirmText');if(confirmText)confirmText.textContent=ios?'I confirm this approved beta email matches the Apple Account signed in on this testing iPhone or iPad.':'I confirm this is the Google Account selected in Google Play on my testing Android device.';
  const intro=document.getElementById('portalSetupIntro');if(intro)intro.textContent=ios?'TestFlight is already installed. Now confirm the iPhone or iPad, iOS/iPadOS version, detected screen size, and matching Apple Account you will use for RebataTrack beta testing.':'Confirm the Android device, Android version, and Google Play account you will use for RebataTrack beta testing.';
}
function distributionAccountConfirmed(profile=currentProfile||{}){
  return !!String(profile.distributionAccountEmail||'').trim() && !!profile.distributionAccountConfirmedAt;
}
function testingSetupComplete(profile=currentProfile||{}){
  // Backward compatibility: testers who already completed Step 2 before newer
  // distribution-account requirements were introduced must remain complete.
  // The saved timeline stage / completion timestamp is the canonical proof that
  // Testing Setup was completed. New testers at the approved stage still must
  // satisfy all current device + distribution-account requirements.
  const stage=normalizeProgramTimelineStage(profile.timelineStage);
  const previouslyCompleted=['setupComplete','inviteSent','activeTesting'].includes(stage)||!!profile.deviceSetupCompletedAt;
  if(previouslyCompleted)return true;
  return !!String(profile.deviceModel||'').trim() && !!String(profile.osVersion||'').trim() && !!String(profile.screenSize||'').trim() && distributionAccountConfirmed(profile);
}

function testFlightPrepared(profile=currentProfile||{}){
  if(String(profile.platform||'')!=='iOS')return true;
  // Existing testers who already completed Testing Setup are grandfathered in.
  return !!profile.testFlightPreparedAt||testingSetupComplete(profile);
}

function isSupportConversation(f){return String(f&&f.workflowType||'Feedback')==='Support'||String(f&&f.type||'')==='Account / Access Problem';}
function conversationIsClosed(f){
  if(!f)return false;
  if(isSupportConversation(f))return ['Resolved','Closed'].includes(String(f.status||''));
  return ['Closed','Declined'].includes(String(f.status||''));
}
function conversationActivityMs(f){const d=timestampToDate(f?.lastMessageAt||f?.updatedAt||f?.submittedAt);return d?d.getTime():0;}
function conversationReadMap(){try{return JSON.parse(localStorage.getItem(PORTAL_CONVERSATION_READ_KEY)||'{}')||{};}catch(_){return {};}}
function saveConversationReadMap(map){try{localStorage.setItem(PORTAL_CONVERSATION_READ_KEY,JSON.stringify(map));}catch(_){}}
function conversationHasTesterUpdate(f){
  if(!f)return false;
  const status=String(f.status||'');
  return String(f.lastMessageBy||'')==='Admin'||['Waiting for Tester','Needs Retest','Fixed','Reviewing','Confirmed','Resolved','Closed'].includes(status);
}
function conversationIsUnread(f){const map=conversationReadMap();return conversationHasTesterUpdate(f)&&conversationActivityMs(f)>Number(map[f.id]||0);}
function markConversationRead(f){if(!f)return;const map=conversationReadMap();map[f.id]=Math.max(Date.now(),conversationActivityMs(f));saveConversationReadMap(map);renderSupportLauncher();renderFeedbackHistory();}
function unreadConversationCount(){return feedbackHistory.filter(conversationIsUnread).length;}
function renderSupportLauncher(){
  const count=unreadConversationCount();
  const badge=document.getElementById('portalSupportUnreadBadge');const inline=document.getElementById('portalSupportLauncherInlineBadge');const meta=document.getElementById('portalSupportLauncherConversationMeta');const status=document.getElementById('portalSupportLauncherStatus');
  [badge,inline].forEach(el=>{if(!el)return;el.hidden=count<1;el.textContent=count>9?'9+':String(count);});
  if(meta)meta.textContent=count?`${count} new ${count===1?'update':'updates'} from RebataTrack`:'View your support and feedback history';
  if(status)status.textContent=count?`You have ${count} unread conversation ${count===1?'update':'updates'}.`:'Start a new conversation or check updates from the RebataTrack team.';
}
function feedbackPublicStatus(f){
  if(isSupportConversation(f)){
    const status=String(f.status||'Waiting for RebataTrack');
    if(status==='Resolved'||status==='Closed')return {label:'Resolved',className:'resolved'};
    if(status==='Waiting for Tester')return {label:'Waiting for you',className:'testing'};
    return {label:'Waiting for RebataTrack',className:'reviewing'};
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

function endEmailChangedSession(newEmail='') {
  if (sessionEnding) return;
  sessionEnding = true;
  clearTimeout(inactivityTimer);
  if (profileUnsubscribe) { profileUnsubscribe(); profileUnsubscribe = null; }
  sessionStorage.removeItem(PORTAL_ACTIVITY_KEY);
  const target = String(newEmail || '').trim().toLowerCase();
  signOut(auth).catch(() => {}).finally(() => {
    const params = new URLSearchParams();
    params.set('notice', 'email-changed');
    if (target) params.set('email', target);
    location.replace('beta-login.html?' + params.toString());
  });
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
  const retests=feedbackHistory.filter(f=>!isSupportConversation(f)&&String(f.status||'')==='Needs Retest'&&!f.retestedAt);
  const supportActions=feedbackHistory.filter(f=>isSupportConversation(f)&&(String(f.status||'')==='Waiting for Tester'||conversationIsUnread(f))).sort((a,b)=>conversationActivityMs(b)-conversationActivityMs(a));
  const total=pending.length+retests.length+supportActions.length;
  const mobileCount=document.getElementById('portalMobileActionCount');if(mobileCount){mobileCount.textContent=total;mobileCount.hidden=total===0;}
  if(!total){section.hidden=true;return;}
  section.hidden=false;
  document.getElementById('portalTaskSummaryCount').textContent=total;
  document.getElementById('portalTaskSummaryTitle').textContent=total===1?'You have 1 outstanding item.':`You have ${total} outstanding items.`;
  const kinds=[];if(retests.length)kinds.push(`${retests.length} retest${retests.length===1?'':'s'}`);if(pending.length)kinds.push(`${pending.length} required task${pending.length===1?'':'s'}`);if(supportActions.length)kinds.push(`${supportActions.length} support update${supportActions.length===1?'':'s'}`);
  document.getElementById('portalTaskSummaryText').textContent=`Needs your attention: ${kinds.join(', ')}. Open an item below to go directly to it.`;
  const list=document.getElementById('portalTaskSummaryList');
  const retestRows=retests.slice(0,6).map(f=>`<button class="portal-required-summary-item portal-required-retest" data-retest-feedback="${escapeHtml(f.id)}" type="button"><strong>Retest: ${escapeHtml(f.subject||'Reported issue')}</strong><span>Retest required</span></button>`);
  const taskRows=pending.slice(0,6).map(t=>`<button class="portal-required-summary-item" data-open-required-task="${escapeHtml(t.id)}" type="button"><strong>${escapeHtml(t.taskTitle||'Required task')}</strong><span>${escapeHtml(formatTaskDue(t.dueAt))}</span></button>`);
  const supportRows=supportActions.slice(0,6).map(f=>`<button class="portal-required-summary-item portal-required-support" data-open-conversation="${escapeHtml(f.id)}" type="button"><strong>${escapeHtml(f.subject||'Support conversation')}</strong><span>${String(f.status||'')==='Waiting for Tester'?'Reply needed':'New support update'}</span></button>`);
  list.innerHTML=[...retestRows,...supportRows,...taskRows].slice(0,10).join('');
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
  if(overdue){response.innerHTML='<div class="portal-task-overdue">This required task deadline has passed. Your RebataTrack Beta Program access is scheduled for automatic removal because the task was not completed on time.</div>';}
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
    return `<article class="portal-announcement-card${a.announcementImportant?' is-important':''}"><div class="portal-announcement-meta"><span><b class="portal-announcement-icon" aria-hidden="true">!</b>${a.announcementImportant?'Important Beta Update':'Beta Update'}</span><time>${escapeHtml(formatPortalDate(a.publishedAt||a.assignedAt))}</time></div><h3>${escapeHtml(a.announcementTitle||'RebataTrack Beta Update')}</h3><p>${escapeHtml(a.announcementMessage||'')}</p><div class="portal-announcement-footer">${requires?'<small>RebataTrack asks you to confirm that you have read this update.</small>':'<small>No acknowledgement is required.</small>'}${action}</div></article>`;
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
  syncConversationComposerState(f);
  if(!document.getElementById('portalConversationBackdrop')?.hidden)markConversationRead(f);
}
function syncConversationComposerState(f=activeConversation){
  const composer=document.getElementById('portalConversationReplyComposer');const notice=document.getElementById('portalConversationClosedNotice');const text=document.getElementById('portalConversationClosedText');
  const closed=conversationIsClosed(f);
  if(composer)composer.hidden=closed;
  if(notice)notice.hidden=!closed;
  if(text&&closed)text.textContent=isSupportConversation(f)?'This support conversation has been resolved and is now closed. RebataTrack can reopen it if more follow-up is needed.':'This feedback conversation has been resolved and is now closed. RebataTrack can reopen it if more follow-up is needed.';
}

async function loadFeedbackHistory(uid){
  if(feedbackHistoryUnsubscribe){feedbackHistoryUnsubscribe();feedbackHistoryUnsubscribe=null;}
  return new Promise((resolve,reject)=>{
    let first=true;
    const q=query(collection(db,'betaFeedback'),where('ownerUid','==',uid),where('adminNotes','==',''));
    feedbackHistoryUnsubscribe=onSnapshot(q,snap=>{
      feedbackHistory=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(timestampToDate(b.lastMessageAt||b.updatedAt||b.submittedAt)?.getTime()||0)-(timestampToDate(a.lastMessageAt||a.updatedAt||a.submittedAt)?.getTime()||0));
      renderFeedbackHistory();
      renderSupportLauncher();
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
    const publicStatus=feedbackPublicStatus(f);const support=isSupportConversation(f);const unread=conversationIsUnread(f);const needsRetest=!support&&String(f.status||'')==='Needs Retest'&&!f.retestedAt;const replyNeeded=support&&String(f.status||'')==='Waiting for Tester';
    const action=needsRetest?`<button class="portal-retest-button" data-retest-feedback="${escapeHtml(f.id)}" type="button">Retest This Issue</button>`:(replyNeeded?`<button class="portal-conversation-open portal-reply-needed-button" data-open-conversation="${escapeHtml(f.id)}" type="button">Reply Needed</button>`:'');
    const workflow=support?'Support':'Beta Feedback';
    return `<article class="portal-feedback-history-card${(needsRetest||replyNeeded)?' needs-action':''}${unread?' has-unread':''}"><div class="portal-feedback-history-top"><div><span>${escapeHtml(workflow)} · ${escapeHtml(f.type||'Conversation')}${unread?'<b class="portal-history-unread">New update</b>':''}</span><h3>${escapeHtml(f.subject||'Conversation')}</h3></div><span class="portal-feedback-public-status ${publicStatus.className}">${escapeHtml(publicStatus.label)}</span></div><p>${escapeHtml(f.details||'')}</p><div class="portal-feedback-history-meta"><span>${escapeHtml(formatPortalDate(f.lastMessageAt||f.updatedAt||f.submittedAt))}</span>${f.appVersion?`<span>${escapeHtml(f.appVersion)}</span>`:''}${f.pageFeature?`<span>${escapeHtml(f.pageFeature)}</span>`:''}${f.supportAccountEmail?`<span>${escapeHtml(f.supportAccountEmail)}</span>`:''}</div>${f.retestedAt?`<div class="portal-retest-result"><strong>${escapeHtml(f.retestResult||'Retest submitted')}</strong>${f.retestNotes?`<span>${escapeHtml(f.retestNotes)}</span>`:''}</div>`:''}<div class="portal-conversation-card-actions"><button class="portal-conversation-open" data-open-conversation="${escapeHtml(f.id)}" type="button">Open Conversation</button>${action}</div></article>`;
  }).join('');
}

function formatPortalMessageTime(value){
  const d=timestampToDate(value);if(!d)return 'Sending…';
  const now=new Date();const sameDay=d.toDateString()===now.toDateString();
  return sameDay?d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):d.toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
function conversationMessageHtml(message){
  const eventType=String(message.eventType||'');
  if(eventType==='retest-request'){
    const pending=activeConversation&&String(activeConversation.status||'')==='Needs Retest'&&!activeConversation.retestedAt;
    return `<div class="portal-chat-event"><div class="portal-chat-message-head"><strong>RebataTrack · Retest requested</strong><time>${escapeHtml(formatPortalMessageTime(message.createdAt))}</time></div><p>${escapeHtml(message.body||'RebataTrack has requested a retest for this issue.')}</p>${pending&&activeConversation?`<button class="portal-chat-event-action" data-retest-feedback="${escapeHtml(activeConversation.id)}" type="button">Open Retest</button>`:''}</div>`;
  }
  if(eventType==='retest-submitted'){
    return `<div class="portal-chat-event is-complete"><div class="portal-chat-message-head"><strong>You · Retest submitted</strong><time>${escapeHtml(formatPortalMessageTime(message.createdAt))}</time></div><p>${escapeHtml(message.retestResult||message.body||'Retest submitted')}</p>${message.retestNotes?`<span class="portal-chat-event-detail">${escapeHtml(message.retestNotes)}</span>`:''}</div>`;
  }
  const admin=String(message.authorRole||'').toLowerCase()==='admin';
  return `<div class="portal-chat-message ${admin?'from-rebatify':'from-tester'}"><div class="portal-chat-message-head"><strong>${admin?'RebataTrack':'You'}</strong><time>${escapeHtml(formatPortalMessageTime(message.createdAt))}</time></div><p>${escapeHtml(message.body||'')}</p></div>`;
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
  const hasRetestRequest=messages.some(m=>m.eventType==='retest-request');
  const hasRetestSubmission=messages.some(m=>m.eventType==='retest-submitted');
  const legacyRequest=!isSupportConversation(f)&&String(f.status||'')==='Needs Retest'&&!f.retestedAt&&!hasRetestRequest?`<div class="portal-chat-event"><div class="portal-chat-message-head"><strong>RebataTrack · Retest requested</strong><time>${escapeHtml(formatPortalMessageTime(f.updatedAt))}</time></div><p>RebataTrack has requested a retest for this issue. Please test the latest fix and submit your retest result.</p><button class="portal-chat-event-action" data-retest-feedback="${escapeHtml(f.id)}" type="button">Open Retest</button></div>`:'';
  const legacySubmission=f.retestedAt&&!hasRetestSubmission?`<div class="portal-chat-event is-complete"><div class="portal-chat-message-head"><strong>You · Retest submitted</strong><time>${escapeHtml(formatPortalMessageTime(f.retestedAt))}</time></div><p>${escapeHtml(f.retestResult||'Retest submitted')}</p>${f.retestNotes?`<span class="portal-chat-event-detail">${escapeHtml(f.retestNotes)}</span>`:''}</div>`:'';
  const nextCount=messages.length+(legacyRequest?1:0)+(legacySubmission?1:0)+1;
  const animate=conversationMessageCount>0&&nextCount>conversationMessageCount;
  conversationMessageCount=nextCount;
  thread.innerHTML=original+replies+legacyRequest+legacySubmission;
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
  const f=feedbackHistory.find(x=>x.id===id);if(!f)return;activeConversation=f;setSupportLauncherOpen(false);
  const back=document.getElementById('portalConversationBackdrop');
  syncOpenConversationHeader();
  const reply=document.getElementById('portalConversationReply');if(reply)reply.value='';
  const message=document.getElementById('portalConversationMessage');if(message){message.textContent='';message.className='portal-task-message';}
  const thread=document.getElementById('portalConversationThread');if(thread)thread.innerHTML='';
  conversationMessageCount=0;back.hidden=false;document.body.classList.add('portal-conversation-active');
  markConversationRead(f);syncConversationComposerState(f);
  renderOpenConversationThread([]);
  resizeConversationComposer();
  subscribeConversationMessages(id);
}
function closeConversation(){
  if(conversationMessagesUnsubscribe){conversationMessagesUnsubscribe();conversationMessagesUnsubscribe=null;}
  conversationMessageCount=0;activeConversation=null;const back=document.getElementById('portalConversationBackdrop');if(back)back.hidden=true;document.body.classList.remove('portal-conversation-active');
}
async function sendConversationReply(){
  if(!activeConversation||!auth.currentUser)return;if(conversationIsClosed(activeConversation)){syncConversationComposerState(activeConversation);return;}const input=document.getElementById('portalConversationReply');const body=String(input.value||'').trim();const message=document.getElementById('portalConversationMessage');
  if(!body){message.textContent='Write a reply before sending.';message.className='portal-task-message error';input?.focus();return;}
  const btn=document.getElementById('portalConversationSend');const original=btn.innerHTML;btn.disabled=true;btn.innerHTML='Sending…';message.textContent='';
  try{
    const feedbackId=activeConversation.id;
    const ref=await addDoc(collection(db,'betaFeedback',feedbackId,'messages'),{authorUid:auth.currentUser.uid,authorRole:'Tester',authorName:currentProfile?.name||'Tester',body,createdAt:serverTimestamp()});
    const update={lastMessageAt:serverTimestamp(),lastMessageBy:'Tester',updatedAt:serverTimestamp()};
    if(isSupportConversation(activeConversation))update.status='Waiting for RebataTrack';
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
    const feedbackId=activeRetestFeedback.id;const retestCount=(Number(activeRetestFeedback.retestCount)||0)+1;
    const feedbackRef=doc(db,'betaFeedback',feedbackId);const messageRef=doc(collection(db,'betaFeedback',feedbackId,'messages'));const batch=writeBatch(db);
    batch.update(feedbackRef,{retestResult:result,retestNotes:notes,retestedAt:serverTimestamp(),retestCount,lastMessageAt:serverTimestamp(),lastMessageBy:'Tester',updatedAt:serverTimestamp()});
    batch.set(messageRef,{authorUid:auth.currentUser.uid,authorRole:'Tester',authorName:currentProfile?.name||'Tester',eventType:'retest-submitted',retestResult:result,retestNotes:notes,body:`Retest submitted: ${result}`,createdAt:serverTimestamp()});
    await batch.commit();
    activeRetestFeedback.retestResult=result;activeRetestFeedback.retestNotes=notes;activeRetestFeedback.retestedAt=new Date();activeRetestFeedback.retestCount=retestCount;activeRetestFeedback.lastMessageAt=new Date();activeRetestFeedback.lastMessageBy='Tester';renderFeedbackHistory();renderPortalTaskSummary();closeRetestFeedback();setFeedbackMessage('Retest submitted. Thank you for checking the fix.','success');workerPostAuthorized('feedback-retest-submitted',{feedbackId}).catch(err=>console.warn('Retest email notification failed:',err));
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
  const isInvitationWait=status==='now'&&(
    title==='Watch for your RebataTrack TestFlight invitation'||
    title==='Prepare your Android phone & watch for testing access'
  );
  const statusLabel=isInvitationWait?'Waiting':({complete:'Completed',now:'Action Needed',waiting:'Upcoming',next:'Upcoming',ongoing:'In Progress'}[status]||status);
  const marker=status==='complete'
    ? `<span class="portal-timeline-complete-marker" aria-label="Step ${number} completed"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12.5 4.2 4.2L19 7"/></svg></span>`
    : `<span>${number}</span>`;
  return `<article class="portal-timeline-step ${status}"><div class="portal-timeline-marker">${marker}</div><div class="portal-timeline-copy"><div class="portal-timeline-step-top"><h3>${title}</h3><span class="portal-timeline-status">${statusLabel}</span></div><p>${body}</p>${actionHtml}</div></article>`;
}

const PROGRAM_TIMELINE_STAGES=['approved','setupComplete','inviteSent','activeTesting'];
function normalizeProgramTimelineStage(value){
  if(value==='deviceReady')return 'setupComplete';
  if(value==='installed')return 'activeTesting';
  return PROGRAM_TIMELINE_STAGES.includes(value)?value:'approved';
}


function testFlightActionHtml(profile=currentProfile||{}){
  const prepared=testFlightPrepared(profile);
  if(prepared){
    return `<div class="portal-timeline-actions"><button class="portal-testflight-button" data-open-testflight type="button"><span class="portal-testflight-icon" aria-hidden="true">↗</span><span>Open TestFlight</span></button><small>TestFlight installation is confirmed. You can use this shortcut anytime to open TestFlight.</small></div>`;
  }
  return `<div class="portal-timeline-actions"><button class="portal-testflight-button" data-open-testflight type="button"><span class="portal-testflight-icon" aria-hidden="true">↗</span><span>Install / Open TestFlight</span></button><button class="portal-testflight-button portal-setup-button" data-confirm-testflight type="button"><span>I have TestFlight installed</span></button><small>Install TestFlight on the iPhone or iPad you will use for beta testing. After it is installed, confirm above to unlock Step 3.</small></div>`;
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
  showPortalShortcutToast('Opening TestFlight. After it is installed, return here and confirm Step 2.');
  fallbackTimer=setTimeout(()=>{
    if(!leftPage)window.location.href=appStoreUrl;
  },1050);
  setTimeout(()=>{window.location.href=deepLink;},180);
}

async function confirmTestFlightInstalled(button){
  if(!auth.currentUser||!currentProfile||String(currentProfile.platform||'')!=='iOS')return;
  if(testFlightPrepared(currentProfile)){renderProgramTimeline(currentProfile);return;}
  const original=button.innerHTML;button.disabled=true;button.innerHTML='Saving…';
  try{
    await updateDoc(doc(db,'betaUsers',auth.currentUser.uid),{testFlightPreparedAt:serverTimestamp(),lastPortalActivity:serverTimestamp(),updatedAt:serverTimestamp()});
    currentProfile.testFlightPreparedAt=new Date();currentProfile.lastPortalActivity=new Date();
    renderProgramTimeline(currentProfile);
    showPortalShortcutToast('TestFlight confirmed. Step 2 is complete — continue with Testing Setup in Step 3.');
  }catch(error){
    showPortalShortcutToast('We could not save the TestFlight confirmation. '+friendlyFirebaseError(error));
    button.disabled=false;button.innerHTML=original;
  }
}

function bindTestFlightButtons(scope=document){
  scope.querySelectorAll('[data-open-testflight]').forEach(btn=>{
    if(btn.dataset.bound==='1')return;
    btn.dataset.bound='1';
    btn.addEventListener('click',openTestFlightOrStore);
  });
  scope.querySelectorAll('[data-confirm-testflight]').forEach(btn=>{
    if(btn.dataset.bound==='1')return;
    btn.dataset.bound='1';
    btn.addEventListener('click',()=>confirmTestFlightInstalled(btn));
  });
}

function renderProgramTimeline(profile){
  const timeline=document.getElementById('portalProgramTimeline');const footnote=document.getElementById('portalTimelineFootnote');if(!timeline)return;
  const ios=profile.platform==='iOS';const stage=normalizeProgramTimelineStage(profile.timelineStage);const setupDone=testingSetupComplete(profile);const tfDone=testFlightPrepared(profile);
  const accessCopy=ios
    ? (stage==='inviteSent'||stage==='activeTesting'?'Your <strong>RebataTrack TestFlight invitation has been sent</strong> to your approved beta email. Open it on the same iPhone or iPad where TestFlight is installed, accept it, and install RebataTrack.':'TestFlight and Testing Setup are complete. Watch your approved beta email for the RebataTrack TestFlight invitation. RebataTrack will advance this stage when testing access is released.')
    : (stage==='inviteSent'||stage==='activeTesting'
      ? 'Your <strong>Google Play beta-testing link has been sent</strong> to your approved beta email. Open it on your Android phone, opt in, and install RebataTrack.'
      : 'Make sure Google Play uses the Google Account that matches your approved beta email, then watch for the beta-testing link. If your Google Play account email is different than your approved RebataTrack Beta program email, click here for help.');
  const androidAccessHelpAction=!ios&&!(stage==='inviteSent'||stage==='activeTesting')
    ? '<div class="portal-timeline-actions portal-timeline-account-mismatch"><button class="portal-account-help-button" data-account-mismatch type="button"><span>My Google Play email is different</span></button><small>RebataTrack will notify you via email and advance this stage when testing access is released to you.</small></div>'
    : '';
  const setupAction=setupDone
    ? '<div class="portal-timeline-completed-note">Testing Setup is complete. You can update your saved device details later from <strong>Settings</strong>.</div>'
    : (ios&&!tfDone
      ? '<div class="portal-timeline-completed-note">Complete Step 2 first by installing and confirming TestFlight. Testing Setup will unlock next.</div>'
      : `<div class="portal-timeline-actions"><button class="portal-testflight-button portal-setup-button" data-open-testing-setup type="button"><span>Complete Testing Setup</span></button><small>${ios?'Confirm your testing iPhone or iPad, iOS/iPadOS version, detected screen size, and matching Apple Account.':'Confirm your testing device and Google Play account before continuing.'}</small></div>`);

  let content,visuals,currentLabel;
  if(ios){
    content=[
      ['Approved for the RebataTrack Beta Program','Your application is approved and your private Beta Portal access is active.',''],
      ['Install TestFlight','Install Apple’s TestFlight app on the iPhone or iPad you will use for RebataTrack beta testing. Use the shortcut below, then confirm when TestFlight is installed.',testFlightActionHtml(profile)],
      ['Complete Testing Setup','Confirm the device, iOS/iPadOS version, automatically detected screen size, and that the Apple Account on that device matches your approved beta email.',setupAction],
      ['Watch for your RebataTrack TestFlight invitation',accessCopy,''],
      ['Install RebataTrack, create your account & begin testing','After accepting the RebataTrack TestFlight invitation, install RebataTrack and create your RebataTrack app account. Then use real rebate activity when possible, complete required Beta Program tasks, and send feedback through this portal.','']
    ];
    if(!tfDone){visuals=['complete','now','waiting','waiting','waiting'];currentLabel='TestFlight Installation Required';}
    else if(!setupDone){visuals=['complete','complete','now','waiting','waiting'];currentLabel='Testing Setup Required';}
    else if(stage==='approved'||stage==='setupComplete'){visuals=['complete','complete','complete','now','waiting'];currentLabel='Waiting for TestFlight Invitation';}
    else if(stage==='inviteSent'){visuals=['complete','complete','complete','complete','now'];currentLabel='TestFlight Invitation Sent';}
    else{visuals=['complete','complete','complete','complete','ongoing'];currentLabel='Active Beta Testing';}
  }else{
    content=[
      ['Approved for the RebataTrack Beta Program','Your application is approved and your private Beta Portal access is active.',''],
      ['Complete Testing Setup','Confirm the device, operating-system version, automatically detected screen size, and the Google Play account you will use to receive and install the beta build.',setupAction],
      ['Prepare your Android phone & watch for testing access',accessCopy,androidAccessHelpAction],
      ['Install RebataTrack, create your account & begin testing','After opting in through Google Play, install RebataTrack and create your RebataTrack app account. Then use real rebate activity when possible, complete required Beta Program tasks, and send feedback through this portal.','']
    ];
    if(!setupDone){visuals=['complete','now','waiting','waiting'];currentLabel='Testing Setup Required';}
    else if(stage==='approved'||stage==='setupComplete'){visuals=['complete','complete','now','waiting'];currentLabel='Waiting for Testing Access';}
    else if(stage==='inviteSent'){visuals=['complete','complete','complete','now'];currentLabel='Google Play Testing Link Sent';}
    else{visuals=['complete','complete','complete','ongoing'];currentLabel='Active Beta Testing';}
  }
  timeline.innerHTML=content.map((item,index)=>timelineStep(index+1,visuals[index],item[0],item[1],item[2])).join('');
  bindTestFlightButtons(timeline);
  timeline.querySelectorAll('[data-open-testing-setup]').forEach(btn=>btn.addEventListener('click',openTestingSetup));
  if(footnote){
    footnote.innerHTML=(ios
      ? '<strong>How progress works:</strong> Approval completes Step 1 automatically. Install and confirm TestFlight in Step 2, then complete Testing Setup in Step 3. RebataTrack controls the invitation and later testing-access stages.'
      : '<strong>How progress works:</strong> Approval completes Step 1 automatically. Completing Testing Setup marks Step 2 complete. RebataTrack controls the later Google Play testing-access stages.')+`<br><span class="portal-timeline-current"><strong>Current program stage:</strong> ${currentLabel}</span>`;
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

function safeAndroidTestingInviteUrl(value){
  try{const u=new URL(String(value||'').trim());return u.protocol==='https:'&&u.hostname==='play.google.com'&&u.pathname.startsWith('/apps/testing/')?u.toString():'';}catch(_){return '';}
}

function renderProfile(profile) {
  document.getElementById('portalFirstName').textContent = firstName(profile.name);
  document.getElementById('portalEmail').textContent = profile.email || '';
  document.getElementById('portalPlatform').textContent = profile.platform || '';
  renderDeviceProfile(profile);

  const stage=normalizeProgramTimelineStage(profile.timelineStage);const setupDone=testingSetupComplete(profile);
  const installCopy=document.getElementById('platformInstallCopy');const installMeta=document.getElementById('platformInstallMeta');const installAction=document.getElementById('platformInstallAction');
  if (profile.platform === 'iOS') {
    const tfDone=testFlightPrepared(profile);
    let copy,meta,actionHtml;
    if(!tfDone){
      copy='Install TestFlight first, then return to your Beta Program timeline and confirm Step 2.';
      meta='TestFlight must be installed on the iPhone or iPad you will use for RebataTrack.';
      actionHtml='<button class="portal-tile-testflight-button" data-open-testflight type="button">Install / Open TestFlight <span aria-hidden="true">↗</span></button><small class="portal-tile-shortcut-note"><strong>Step 2.</strong> Confirm installation from the Progress timeline after TestFlight is installed.</small>';
    }else if(!setupDone){
      copy='TestFlight is installed. Complete Testing Setup in Step 3 to confirm your device and matching Apple Account.';
      meta='Testing Setup is separate from the TestFlight installation step.';
      actionHtml='<button class="portal-tile-testflight-button" data-open-testflight type="button">Open TestFlight <span aria-hidden="true">↗</span></button><small class="portal-tile-shortcut-note"><strong>Shortcut only.</strong> Complete Step 3 from your Progress timeline.</small>';
    }else{
      copy=({approved:'Testing Setup is complete. Watch your approved beta email for your RebataTrack TestFlight invitation.',setupComplete:'Testing Setup is complete. Watch your approved beta email for your RebataTrack TestFlight invitation.',inviteSent:'Your TestFlight invitation has been sent. Open it on your iPhone, accept it, and install RebataTrack.',activeTesting:'You are in active beta testing. Keep RebataTrack updated through TestFlight.'}[stage]);
      meta=({approved:'Shortcut only: opening TestFlight does not change your Beta Program status. RebataTrack updates testing-access stages.',setupComplete:'Shortcut only: opening TestFlight does not change your Beta Program status. RebataTrack updates testing-access stages.',inviteSent:'Use TestFlight to accept your invitation and install RebataTrack. This shortcut does not change your timeline status.',activeTesting:'Complete periodic Beta Program tasks, test real workflows, and keep sending meaningful feedback.'}[stage]);
      actionHtml='<button class="portal-tile-testflight-button" data-open-testflight type="button">Open TestFlight <span aria-hidden="true">↗</span></button><small class="portal-tile-shortcut-note"><strong>Shortcut only.</strong> Does not advance your Beta Program status.</small>';
    }
    if(installCopy)installCopy.textContent=copy;if(installMeta)installMeta.textContent=meta;if(installAction){installAction.innerHTML=actionHtml;bindTestFlightButtons(installAction);}
  } else if (profile.platform === 'Android') {
    const testingUrl=safeAndroidTestingInviteUrl(profile.androidTestingInviteUrl);
    const copy=!setupDone?'Complete Testing Setup first, then prepare the correct Google Play account.':({approved:'Testing Setup is complete. Confirm the correct Google Play account and watch your approved beta email for the beta-testing link.',setupComplete:'Testing Setup is complete. Confirm the correct Google Play account and watch your approved beta email for the beta-testing link.',inviteSent:'Your Google Play testing link has been sent. Use the button below on your Android phone, join the test, and install RebataTrack.',activeTesting:'You are in active beta testing. Keep RebataTrack updated through Google Play.'}[stage]);
    const meta=!setupDone?'Complete the required Testing Setup from Step 2 of your timeline.':({approved:'Google Play must be signed into the Google Account that matches your approved beta email.',setupComplete:'Google Play must be signed into the Google Account that matches your approved beta email.',inviteSent:'Before opening the link, confirm Google Play is using the Google Account that matches your approved beta email.',activeTesting:'Complete periodic Beta Program tasks, test real workflows, and keep sending meaningful feedback.'}[stage]);
    let actionHtml='';
    if(testingUrl&&(stage==='inviteSent'||stage==='activeTesting')){
      actionHtml=`<a class="portal-tile-testflight-button" href="${escapeHtml(testingUrl)}" target="_blank" rel="noopener noreferrer">Open Google Play Testing Link <span aria-hidden="true">↗</span></a><small class="portal-tile-shortcut-note"><strong>Android steps:</strong> use your approved Google Account → join the test → open the Play listing → install RebataTrack.</small>`;
    }
    if(installCopy)installCopy.textContent=copy;if(installMeta)installMeta.textContent=meta;if(installAction)installAction.innerHTML=actionHtml;
  }
  renderProgramTimeline(profile);
  loading.hidden = true;app.hidden = false;document.getElementById('portalSupportLauncher')?.removeAttribute('hidden');if (content) content.classList.remove('portal-locked-content');
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
  const target=document.querySelector('.portal-feedback-form-column')||feedbackForm||document.getElementById('submit-feedback');rebatifyPortalScrollTarget(target,'smooth');setTimeout(()=>{try{supportEmail?.focus({preventScroll:true});}catch(_){supportEmail?.focus();}},650);
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
  loading.innerHTML = '<div class="portal-alert warning">The Beta Portal is not connected yet. Please check back shortly.</div>';
} else {
  onAuthStateChanged(auth, async user => {
    if (initialized) return;
    if (!user) { fail('session'); return; }
    initialized = true;
    try {
      currentProfile = await loadProfile(user);
      renderProfile(currentProfile);
      if(profileUnsubscribe)profileUnsubscribe();
      const sessionEmail=String(user.email||'').trim().toLowerCase();
      profileUnsubscribe=onSnapshot(doc(db,'betaUsers',user.uid),snap=>{
        if(!snap.exists()){fail('access');return;}
        const next={id:snap.id,...snap.data()};
        if(next.accessStatus!=='Enabled'||!['Approved','Active'].includes(next.status)){fail('access');return;}
        const profileEmail=String(next.email||'').trim().toLowerCase();
        if(sessionEmail&&profileEmail&&sessionEmail!==profileEmail){endEmailChangedSession(profileEmail);return;}
        currentProfile=next;renderProfile(currentProfile);
      },err=>console.warn('Beta profile realtime listener failed:',err));
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
      if (summaryText) summaryText.textContent = 'Required tasks and Beta News could not be loaded right now. Refresh the portal in a moment or contact RebataTrack Support if this continues.';
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
    if(profileUnsubscribe){profileUnsubscribe();profileUnsubscribe=null;}
    sessionStorage.removeItem(PORTAL_ACTIVITY_KEY);
    try { await signOut(auth); } catch (_) {}
    location.replace('beta-login.html');
  });
}

if(taskSubmit)taskSubmit.addEventListener('click',completeRequiredTask);


const setupBackdrop=document.getElementById('portalSetupBackdrop');
function openTestingSetup(){if(!setupBackdrop)return;if(String(currentProfile?.platform||'')==='iOS'&&!testFlightPrepared(currentProfile||{})){showPortalShortcutToast('Install and confirm TestFlight in Step 2 before completing Testing Setup.');return;}renderDeviceProfile(currentProfile||{});const confirm=document.getElementById('testerDistributionConfirm');if(confirm)confirm.checked=distributionAccountConfirmed(currentProfile||{});setupBackdrop.hidden=false;document.body.classList.add('portal-setup-open');}
function closeTestingSetup(){if(!setupBackdrop)return;setupBackdrop.hidden=true;document.body.classList.remove('portal-setup-open');}
const setupClose=document.getElementById('portalSetupClose');if(setupClose)setupClose.addEventListener('click',closeTestingSetup);
if(setupBackdrop)setupBackdrop.addEventListener('click',e=>{if(e.target===setupBackdrop)closeTestingSetup();});
const deviceForm=document.getElementById('portalDeviceForm');
if(deviceForm){deviceForm.addEventListener('submit',async event=>{
  event.preventDefault();if(!auth.currentUser||!currentProfile){fail('session');return;}if(!deviceForm.checkValidity()){deviceForm.reportValidity();return;}
  const button=deviceForm.querySelector('button[type="submit"]');const original=button.innerHTML;button.disabled=true;button.innerHTML='Saving…';setDeviceMessage('');
  const deviceModel=String(document.getElementById('testerDeviceModel').value||'').trim();const osVersion=String(document.getElementById('testerOsVersion').value||'').trim();const screenSize=detectedScreenSize()||String(document.getElementById('testerScreenSize').value||'').trim();
  const distributionAccountEmail=String(currentProfile.email||auth.currentUser.email||'').trim();const distributionConfirm=document.getElementById('testerDistributionConfirm');const ios=String(currentProfile.platform||'')==='iOS';
  if(!distributionAccountEmail){setDeviceMessage('Your approved beta email could not be loaded. Contact RebataTrack Support before continuing.','error');button.disabled=false;button.innerHTML=original;return;}
  if(ios&&!testFlightPrepared(currentProfile)){setDeviceMessage('Complete Step 2 first by installing and confirming TestFlight.','error');button.disabled=false;button.innerHTML=original;return;}
  if(!distributionConfirm||!distributionConfirm.checked){setDeviceMessage(ios?'Confirm that the Apple Account signed in on this iPhone or iPad matches your approved beta email before continuing.':'Confirm the Google Play account you use for beta distribution before continuing.','error');button.disabled=false;button.innerHTML=original;return;}
  const stage=normalizeProgramTimelineStage(currentProfile.timelineStage);const firstSetup=stage==='approved';const needsAccountConfirmation=!distributionAccountConfirmed(currentProfile);
  try{
    const update={deviceModel,osVersion,screenSize,deviceUpdatedAt:serverTimestamp(),lastPortalActivity:serverTimestamp(),updatedAt:serverTimestamp()};
    // First-time Testing Setup must always record a fresh account confirmation.
    // This is important after an Admin beta-email/account swap: the Worker may
    // have updated the stored distribution email, but Firestore requires the
    // tester's current confirmation timestamp when approved -> setupComplete.
    if(firstSetup||needsAccountConfirmation){update.distributionAccountEmail=distributionAccountEmail;update.distributionAccountConfirmedAt=serverTimestamp();}
    if(firstSetup){update.timelineStage='setupComplete';update.timelineUpdatedAt=serverTimestamp();update.deviceSetupCompletedAt=serverTimestamp();}
    await updateDoc(doc(db,'betaUsers',auth.currentUser.uid),update);
    Object.assign(currentProfile,{deviceModel,osVersion,screenSize,deviceUpdatedAt:new Date(),lastPortalActivity:new Date()});if(firstSetup||needsAccountConfirmation){currentProfile.distributionAccountEmail=distributionAccountEmail;currentProfile.distributionAccountConfirmedAt=new Date();}if(firstSetup){currentProfile.timelineStage='setupComplete';currentProfile.timelineUpdatedAt=new Date();currentProfile.deviceSetupCompletedAt=new Date();}
    renderDeviceProfile(currentProfile);renderProfile(currentProfile);setDeviceMessage(firstSetup?(ios?'Testing Setup saved. Step 3 is complete and your timeline advanced to Step 4.':'Testing Setup saved. Step 2 is complete and your timeline advanced to Step 3.'):'Testing Setup saved.','success');setTimeout(closeTestingSetup,650);
  }catch(error){setDeviceMessage('We could not save your testing setup. '+friendlyFirebaseError(error),'error');}
  finally{button.disabled=false;button.innerHTML=original;}
});}

const supportLauncherButton=document.getElementById('portalSupportLauncherButton');
const supportLauncherPanel=document.getElementById('portalSupportLauncherPanel');
function setSupportLauncherOpen(open){if(!supportLauncherPanel||!supportLauncherButton)return;supportLauncherPanel.hidden=!open;supportLauncherButton.setAttribute('aria-expanded',open?'true':'false');document.getElementById('portalSupportLauncher')?.classList.toggle('is-open',open);}
supportLauncherButton?.addEventListener('click',event=>{event.stopPropagation();setSupportLauncherOpen(supportLauncherPanel?.hidden!==false);});
document.getElementById('portalSupportLauncherClose')?.addEventListener('click',()=>setSupportLauncherOpen(false));
document.querySelectorAll('[data-support-launch]').forEach(button=>button.addEventListener('click',()=>{const mode=button.dataset.supportLaunch;setSupportLauncherOpen(false);
  // Support must remain reachable even before Testing Setup is complete. If the
  // setup dialog is open, close it first so Help & Feedback is visible and usable.
  closeTestingSetup();
  const target=mode==='new'?(document.querySelector('.portal-feedback-form-column')||document.getElementById('submit-feedback')):document.getElementById('feedback-history');rebatifyPortalScrollTarget(target,'smooth');
  if(mode==='new')setTimeout(()=>{const type=document.getElementById('feedbackType');if(type)type.focus({preventScroll:true});},500);
}));
document.addEventListener('click',event=>{const launcher=document.getElementById('portalSupportLauncher');if(launcher&&!launcher.contains(event.target))setSupportLauncherOpen(false);});
renderSupportLauncher();

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
const conversationReplyInput=document.getElementById('portalConversationReply');if(conversationReplyInput){conversationReplyInput.addEventListener('input',resizeConversationComposer);conversationReplyInput.addEventListener('compositionend',resizeConversationComposer);conversationReplyInput.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();sendConversationReply();}});}
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
      supportAccountEmail:support?String(data.get('supportAccountEmail')||'').trim():'',status:support?'Waiting for RebataTrack':'New',adminNotes:'',lastMessageAt:serverTimestamp(),lastMessageBy:'Tester',submittedAt:serverTimestamp(),updatedAt:serverTimestamp()
    };
    try{
      const ref=await addDoc(collection(db,'betaFeedback'),payload);const local={id:ref.id,...payload,submittedAt:new Date(),updatedAt:new Date(),lastMessageAt:new Date()};feedbackHistory.unshift(local);renderFeedbackHistory();
      if(appVersion)currentProfile.currentBuild=appVersion;
      if(support){
        await updateDoc(doc(db,'betaUsers',auth.currentUser.uid),{lastPortalActivity:serverTimestamp(),updatedAt:serverTimestamp()}).catch(()=>{});
      }else{
        await updateDoc(doc(db,'betaUsers',auth.currentUser.uid),{lastFeedbackSubmittedAt:serverTimestamp(),lastPortalActivity:serverTimestamp(),currentBuild:appVersion,updatedAt:serverTimestamp()}).catch(()=>{});
      }
      feedbackForm.reset();feedbackForm.classList.remove('is-validation-attempted');updateHelpFormForType();renderDeviceProfile(currentProfile);setFeedbackMessage(support?'Your support conversation was started. RebataTrack has been notified.':'Thank you — your feedback conversation was started.','success');
      workerPostAuthorized('feedback-submitted',{feedbackId:ref.id}).catch(err=>console.warn('Help & Feedback email notification failed:',err));
      setTimeout(()=>openConversation(ref.id),300);
    }catch(error){setFeedbackMessage('We could not start your conversation right now. '+friendlyFirebaseError(error),'error');}
    finally{button.disabled=false;button.innerHTML=original;}
  });
}

// Website Build 88: sticky Beta Portal navigation section positioning.
function rebatifyPortalScrollTarget(target, behavior = 'smooth') {
  if (!target) return;
  const stickyNav = document.querySelector('.portal-mobile-nav');
  const navRect = stickyNav?.getBoundingClientRect();
  const stickyBottom = navRect ? Math.max(0, navRect.bottom) : 0;
  const breathingRoom = 28;
  const absoluteTargetTop = window.scrollY + target.getBoundingClientRect().top;
  const destination = Math.max(0, absoluteTargetTop - stickyBottom - breathingRoom);
  window.scrollTo({ top: destination, behavior });
}

document.querySelectorAll('.portal-mobile-nav a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    const href = link.getAttribute('href');
    if (!href || href === '#') return;
    const target = document.querySelector(href);
    if (!target) return;
    event.preventDefault();
    history.replaceState(null, '', href);
    rebatifyPortalScrollTarget(target, 'smooth');
  });
});

function rebatifyPortalApplyHashOffset() {
  if (!window.location.hash) return;
  const target = document.querySelector(window.location.hash);
  if (!target) return;
  requestAnimationFrame(() => rebatifyPortalScrollTarget(target, 'auto'));
}
window.addEventListener('hashchange', rebatifyPortalApplyHashOffset);
window.addEventListener('load', () => setTimeout(rebatifyPortalApplyHashOffset, 80));
