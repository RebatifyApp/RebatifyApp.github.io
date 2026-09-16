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
const taskBackdrop = document.getElementById('portalTaskBackdrop');
const taskSubmit = document.getElementById('portalTaskSubmit');

const PORTAL_INACTIVITY_MS = 6 * 60 * 60 * 1000;
const PORTAL_ACTIVITY_KEY = 'rebatifyBetaPortalLastActivity';
let inactivityTimer = null;
let inactivityStarted = false;
let sessionEnding = false;
let lastActivityWrite = 0;

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
  if(!pending.length){section.hidden=true;return;}
  section.hidden=false;
  document.getElementById('portalTaskSummaryCount').textContent=pending.length;
  document.getElementById('portalTaskSummaryTitle').textContent=pending.length===1?'You have 1 required Beta Program task to complete.':`You have ${pending.length} required Beta Program tasks to complete.`;
  document.getElementById('portalTaskSummaryText').textContent='Complete every required task by its deadline to keep your Beta Program access active. Reminder emails are sent as deadlines approach.';
  const list=document.getElementById('portalTaskSummaryList');
  list.innerHTML=pending.slice(0,6).map(t=>`<div class="portal-required-summary-item"><strong>${escapeHtml(t.taskTitle||'Required task')}</strong><span>${escapeHtml(formatTaskDue(t.dueAt))}</span></div>`).join('');
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
  requiredTasks=allTaskAssignments.filter(t=>t.status==='Pending').sort((a,b)=>{
    const ad=timestampToDate(a.dueAt),bd=timestampToDate(b.dueAt);return (ad?ad.getTime():0)-(bd?bd.getTime():0);
  });
  renderPortalTaskSummary();
  renderRequiredTask();
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

const PROGRAM_TIMELINE_STAGES=['approved','inviteSent','activeTesting'];
function normalizeProgramTimelineStage(value){
  // Build 55 briefly used two extra intermediate values. Map them into the
  // simplified three-stage workflow so existing tester records keep working.
  if(value==='deviceReady')return 'approved';
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
  const timeline=document.getElementById('portalProgramTimeline');
  const footnote=document.getElementById('portalTimelineFootnote');
  if(!timeline)return;
  const ios=profile.platform==='iOS';
  const stage=normalizeProgramTimelineStage(profile.timelineStage);

  let content;
  if(ios){
    const accessCopy=stage==='inviteSent'
      ? 'Your <strong>TestFlight invitation has been sent</strong> to your approved beta email. Open that invitation on your iPhone and accept it in TestFlight. If you do not already have TestFlight, use the shortcut below. <strong>Opening TestFlight does not advance this timeline.</strong>'
      : 'Install or open Apple’s <strong>TestFlight</strong> app on your iPhone now. Then watch your approved beta email for the Rebatify TestFlight invitation. When it arrives, open the invitation on your iPhone and accept it in TestFlight. <strong>Your timeline will be advanced by the Rebatify team when testing access is released to you.</strong>';
    content=[
      ['Approved for the Rebatify Beta Program','Your application is approved and your private Beta Program Portal access is active. Sign in with your approved email and the 6-digit code we send — there is no separate portal password.',''],
      ['Prepare your iPhone & watch for your TestFlight invitation',accessCopy,testFlightActionHtml()],
      ['Install Rebatify, create your account & begin testing','After accepting the TestFlight invitation, install Rebatify and create your Rebatify app account inside the app — this is the only Rebatify password/account you need to remember. Then use Rebatify with real rebate activity when possible, complete required Beta Program tasks, test core workflows, and send meaningful feedback through this portal.','']
    ];
  }else{
    const accessCopy=stage==='inviteSent'
      ? 'Your <strong>Google Play closed-testing link has been sent</strong> to your approved beta email. Open it on your Android phone while Google Play is signed into the Google Account that matches your approved beta email, then opt in as a tester. <strong>Opening the testing link does not advance this timeline.</strong>'
      : 'Make sure Google Play is signed into the <strong>Google Account that matches your approved beta email</strong>. Then watch that email for the Rebatify Google Play closed-testing link. When it arrives, open it on your Android phone and opt in as a tester. <strong>Your timeline will be advanced by the Rebatify team when testing access is released to you.</strong>';
    content=[
      ['Approved for the Rebatify Beta Program','Your application is approved and your private Beta Program Portal access is active. Sign in with your approved email and the 6-digit code we send — there is no separate portal password.',''],
      ['Prepare your Android phone & watch for your testing link',accessCopy,''],
      ['Install Rebatify, create your account & begin testing','After opting in, install Rebatify from Google Play and create your Rebatify app account inside the app — this is the only Rebatify password/account you need to remember. Then use Rebatify with real rebate activity when possible, complete required Beta Program tasks, test core workflows, and send meaningful feedback through this portal.','']
    ];
  }

  const visuals=stage==='activeTesting'
    ? ['complete','complete','ongoing']
    : stage==='inviteSent'
      ? ['complete','now','next']
      : ['complete','now','waiting'];
  timeline.innerHTML=content.map((item,index)=>timelineStep(index+1,visuals[index],item[0],item[1],item[2])).join('');
  bindTestFlightButtons(timeline);

  if(footnote){
    const currentLabel={
      approved:'Approved / Portal Ready',
      inviteSent:ios?'TestFlight Invitation Sent':'Google Play Testing Link Sent',
      activeTesting:'Active Beta Testing'
    }[stage];
    footnote.innerHTML='<strong>How progress works:</strong> This is a program-status timeline, not a checklist. The Rebatify team controls progression and will update your stage as testing access is released and you move into active testing. Opening an app or link does not mark a step complete.'+`<br><span class="portal-timeline-current"><strong>Current program stage:</strong> ${currentLabel}</span>`;
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

  const stage=normalizeProgramTimelineStage(profile.timelineStage);
  const installCopy=document.getElementById('platformInstallCopy');
  const installMeta=document.getElementById('platformInstallMeta');
  const installAction=document.getElementById('platformInstallAction');
  if (profile.platform === 'iOS') {
    const copy={
      approved:'Install or open TestFlight now, then watch your approved beta email for your Rebatify invitation.',
      inviteSent:'Your TestFlight invitation has been sent. Open it on your iPhone, accept it, and install Rebatify.',
      activeTesting:'You are in active beta testing. Keep Rebatify updated through TestFlight.'
    }[stage];
    const meta={
      approved:'Shortcut only: opening TestFlight does not change your Beta Program status. Your timeline is updated by the Rebatify team.',
      inviteSent:'Use TestFlight to accept your invitation and install Rebatify. This shortcut does not change your timeline status.',
      activeTesting:'Complete periodic Beta Program tasks, test real workflows, and keep sending meaningful feedback.'
    }[stage];
    if(installCopy)installCopy.textContent=copy;
    if(installMeta)installMeta.textContent=meta;
    if(installAction){installAction.innerHTML='<button class="portal-tile-testflight-button" data-open-testflight type="button">Open TestFlight <span aria-hidden="true">↗</span></button><small class="portal-tile-shortcut-note"><strong>Shortcut only.</strong> Does not advance your Beta Program status.</small>';bindTestFlightButtons(installAction);}
  } else if (profile.platform === 'Android') {
    const copy={
      approved:'Confirm the correct Google Play account now, then watch your approved beta email for the closed-testing link.',
      inviteSent:'Your Google Play testing link has been sent. Open it on your Android phone, opt in, and install Rebatify.',
      activeTesting:'You are in active beta testing. Keep Rebatify updated through Google Play.'
    }[stage];
    const meta={
      approved:'Google Play must be signed into the Google Account that matches your approved beta email.',
      inviteSent:'After opting in, install Rebatify, create your app account, and begin testing.',
      activeTesting:'Complete periodic Beta Program tasks, test real workflows, and keep sending meaningful feedback.'
    }[stage];
    if(installCopy)installCopy.textContent=copy;
    if(installMeta)installMeta.textContent=meta;
    if(installAction)installAction.innerHTML='';
  }

  renderProgramTimeline(profile);

  loading.hidden = true;
  app.hidden = false;
  if (content) content.classList.remove('portal-locked-content');
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
    // Required tasks should never be able to invalidate an otherwise valid portal
    // session. If task loading fails, keep the tester signed in and surface a
    // non-blocking message instead of bouncing them back to login.
    try {
      await loadRequiredTasks(user.uid);
    } catch (error) {
      console.error('Could not load required beta tasks:', error);
      const summaryText = document.getElementById('portalTaskSummaryText');
      if (summaryText) summaryText.textContent = 'Required tasks could not be loaded right now. Refresh the portal in a moment or contact Rebatify Support if this continues.';
    }
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

if (feedbackForm) {
  feedbackForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!feedbackForm.checkValidity()) { feedbackForm.reportValidity(); return; }
    if (!auth.currentUser || !currentProfile) { fail('session'); return; }

    const button = feedbackForm.querySelector('button[type="submit"]');
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = 'Submitting…';
    setFeedbackMessage('');

    const data = new FormData(feedbackForm);
    const payload = {
      ownerUid: auth.currentUser.uid,
      name: currentProfile.name || '',
      email: currentProfile.email || auth.currentUser.email || '',
      platform: currentProfile.platform || '',
      type: String(data.get('feedbackType') || '').trim(),
      subject: String(data.get('subject') || '').trim(),
      details: String(data.get('details') || '').trim(),
      appVersion: String(data.get('appVersion') || '').trim(),
      deviceDetails: String(data.get('deviceDetails') || '').trim(),
      pageFeature: String(data.get('pageFeature') || '').trim(),
      status: 'New',
      adminNotes: '',
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    try {
      await addDoc(collection(db, 'betaFeedback'), payload);
      feedbackForm.reset();
      setFeedbackMessage('Thank you — your feedback was submitted.', 'success');
    } catch (error) {
      setFeedbackMessage('We could not submit your feedback right now. ' + friendlyFirebaseError(error), 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  });
}
