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

const PORTAL_INACTIVITY_MS = 15 * 60 * 1000;
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

function timelineStep(number,status,title,body){
  const statusLabel={complete:'Complete',now:'Do now',waiting:'Waiting',next:'Next',ongoing:'Ongoing'}[status]||status;
  return `<article class="portal-timeline-step ${status}"><div class="portal-timeline-marker"><span>${number}</span></div><div class="portal-timeline-copy"><div class="portal-timeline-step-top"><h3>${title}</h3><span class="portal-timeline-status">${statusLabel}</span></div><p>${body}</p></div></article>`;
}
function renderProgramTimeline(profile){
  const timeline=document.getElementById('portalProgramTimeline');
  const footnote=document.getElementById('portalTimelineFootnote');
  if(!timeline)return;
  const ios=profile.platform==='iOS';
  const items=ios ? [
    ['complete','Approved for the Rebatify Beta Program','Your application is approved and your private Beta Program Portal access is active. Sign in with your approved email and the 6-digit code we send — there is no separate portal password.'],
    ['now','Prepare your iPhone','Install Apple’s <strong>TestFlight</strong> app from the App Store now so you are ready when the Rebatify build becomes available.'],
    ['waiting','Watch for your TestFlight invitation','When the iOS beta build is ready for you, Apple/TestFlight will send an invitation to your approved beta email. Open that invitation on your iPhone and accept it in TestFlight.'],
    ['next','Install Rebatify and create your app account','After accepting the invitation, open TestFlight and install Rebatify. Create your Rebatify app account inside the app — this is the only Rebatify password/account you need to remember. Future beta builds will appear in TestFlight.'],
    ['ongoing','Test real workflows and send feedback','Use Rebatify with real rebate activity when possible. Check Orders, Order Details, Reports, notifications, and other workflows, then use this portal whenever you find a bug, confusing experience, or useful suggestion.']
  ] : [
    ['complete','Approved for the Rebatify Beta Program','Your application is approved and your private Beta Program Portal access is active. Sign in with your approved email and the 6-digit code we send — there is no separate portal password.'],
    ['now','Prepare your Android phone','Make sure the Google Play Store is signed into the <strong>Google Account that matches your approved beta email</strong>. This is the account that will be eligible for the closed test.'],
    ['waiting','Watch for your Google Play testing link','Google Play closed testing uses an opt-in link. When the Android beta build is ready, <strong>Rebatify will email you the Google Play testing link</strong>. Open it on your Android phone and opt in as a tester.'],
    ['next','Install Rebatify and create your app account','After opting in, install Rebatify from Google Play. Create your Rebatify app account inside the app — this is the only Rebatify password/account you need to remember. Future test updates will be delivered through Google Play.'],
    ['ongoing','Test real workflows and send feedback','Use Rebatify with real rebate activity when possible. Check Orders, Order Details, Reports, notifications, and other workflows, then use this portal whenever you find a bug, confusing experience, or useful suggestion.']
  ];
  timeline.innerHTML=items.map((item,index)=>timelineStep(index+1,item[0],item[1],item[2])).join('');
  if(footnote){
    footnote.innerHTML=ios
      ? '<strong>iOS:</strong> Your app invitation comes through Apple/TestFlight after Rebatify adds your approved email to the external testing group.'
      : '<strong>Android:</strong> Google Play closed testing is joined through an opt-in link. Rebatify will send that link to your approved beta email when your Android build is ready.';
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

  if (profile.platform === 'iOS') {
    document.getElementById('platformInstallCopy').textContent = 'Install TestFlight now, then wait for your Rebatify invitation.';
    document.getElementById('platformInstallMeta').textContent = 'Apple/TestFlight will email your approved beta address when the iOS build is ready for you.';
  } else if (profile.platform === 'Android') {
    document.getElementById('platformInstallCopy').textContent = 'Confirm the correct Google Play account, then wait for the testing link.';
    document.getElementById('platformInstallMeta').textContent = 'Rebatify will email your Google Play closed-testing opt-in link when the Android build is ready.';
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
