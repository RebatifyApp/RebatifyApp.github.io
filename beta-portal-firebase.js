import { firebaseConfigured, auth, db, timestampToDate, friendlyFirebaseError } from './firebase-core.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc,
  getDoc,
  updateDoc,
  addDoc,
  collection,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const loading = document.getElementById('portalLoading');
const app = document.getElementById('portalApp');
const content = document.getElementById('portalContent');
const logout = document.getElementById('portalLogout');
const feedbackForm = document.getElementById('portalFeedbackForm');
const feedbackMessage = document.getElementById('feedbackMessage');
let currentProfile = null;
let initialized = false;

function fail(reason='session') {
  signOut(auth).catch(() => {}).finally(() => location.replace('beta-login.html?error=' + encodeURIComponent(reason)));
}
function firstName(name){ return String(name || 'Tester').trim().split(/\s+/)[0] || 'Tester'; }
function setFeedbackMessage(text,type='') {
  if (!feedbackMessage) return;
  feedbackMessage.textContent=text || '';
  feedbackMessage.className='portal-feedback-message' + (type ? ' ' + type : '');
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
    ['complete','Approved for the Rebatify Beta Program','Your application is approved and your private Beta Program Portal account is active.'],
    ['now','Prepare your iPhone','Install Apple’s <strong>TestFlight</strong> app from the App Store now so you are ready when the Rebatify build becomes available.'],
    ['waiting','Watch for your TestFlight invitation','When the iOS beta build is ready for you, Apple/TestFlight will send an invitation to your approved beta email. Open that invitation on your iPhone and accept it in TestFlight.'],
    ['next','Install the Rebatify beta','After accepting the invitation, open TestFlight and install Rebatify. New beta builds will also appear in TestFlight when they are released.'],
    ['ongoing','Test real workflows and send feedback','Use Rebatify with real rebate activity when possible. Check Orders, Order Details, Reports, notifications, and other workflows, then use this portal whenever you find a bug, confusing experience, or useful suggestion.']
  ] : [
    ['complete','Approved for the Rebatify Beta Program','Your application is approved and your private Beta Program Portal account is active.'],
    ['now','Prepare your Android phone','Make sure the Google Play Store is signed into the <strong>Google Account that matches your approved beta email</strong>. This is the account that will be eligible for the closed test.'],
    ['waiting','Watch for your Google Play testing link','Google Play closed testing uses an opt-in link. When the Android beta build is ready, <strong>Rebatify will email you the Google Play testing link</strong>. Open it on your Android phone and opt in as a tester.'],
    ['next','Install Rebatify from Google Play','After opting in, use the Google Play page to install Rebatify. Future test updates will be delivered through Google Play.'],
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

  const lastLogin = timestampToDate(data.lastLogin);
  const stale = !lastLogin || (Date.now() - lastLogin.getTime()) > 12 * 60 * 60 * 1000;
  if (stale) updateDoc(ref, { lastLogin: serverTimestamp() }).catch(() => {});
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
    } catch (error) {
      fail(error && error.message === 'access' ? 'access' : 'session');
    }
  });
}

if (logout) {
  logout.addEventListener('click', async () => {
    try { await signOut(auth); } catch (_) {}
    location.replace('beta-login.html');
  });
}

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
