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
    document.getElementById('platformInstallCopy').textContent = 'Use the latest Rebatify beta build delivered through TestFlight.';
    document.getElementById('platformInstallMeta').textContent = 'Your TestFlight invitation and current build information will be provided as beta access is distributed.';
  } else if (profile.platform === 'Android') {
    document.getElementById('platformInstallCopy').textContent = 'Use the latest Rebatify beta build delivered through Google Play testing.';
    document.getElementById('platformInstallMeta').textContent = 'Your Google Play testing invitation and current build information will be provided as beta access is distributed.';
  }

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
