import { firebaseConfigured, firebaseMissingFields, auth } from './firebase-core.js';
import {
  onAuthStateChanged,
  signInWithCustomToken,
  signOut,
  setPersistence,
  browserSessionPersistence
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const form = document.getElementById('portalLoginForm');
const codeForm = document.getElementById('portalCodeForm');
const errorBox = document.getElementById('portalLoginError');
const notConnected = document.getElementById('portalNotConnected');
const emailInput = document.getElementById('portalEmail');
const codeInput = document.getElementById('portalCode');
const codeSent = document.getElementById('portalCodeSent');
const useDifferent = document.getElementById('portalUseDifferentEmail');
const supportToggle = document.getElementById('portalSupportToggle');
const supportPanel = document.getElementById('portalSupportPanel');
const supportForm = document.getElementById('portalSupportForm');
const supportEmail = document.getElementById('portalSupportEmail');
const supportIssue = document.getElementById('portalSupportIssue');
const supportDetails = document.getElementById('portalSupportDetails');
const supportMessage = document.getElementById('portalSupportMessage');
const settings = window.REBATIFY_BETA_SETTINGS || {};
const workerUrl = String(settings.emailWorkerUrl || '').trim().replace(/\/+$/, '');
let pendingEmail = '';
let isCompletingSignIn = false;

function showError(message, tone='error') {
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.className = 'portal-alert ' + tone;
  errorBox.hidden = false;
}
function clearError() { if (errorBox) errorBox.hidden = true; }
function validWorkerUrl(){
  try { const u = new URL(workerUrl); return u.protocol === 'https:'; } catch (_) { return false; }
}
async function workerPost(payload){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || data.ok !== true) {
      const error = new Error(data.error || 'The RebataTrack Beta Program sign-in service could not complete this request.');
      error.retryAfter = data.retryAfter || 0;
      throw error;
    }
    return data;
  } finally { clearTimeout(timer); }
}

if (!firebaseConfigured || !validWorkerUrl()) {
  if (notConnected) {
    notConnected.hidden = false;
    notConnected.textContent = 'The RebataTrack Beta Portal sign-in service is not connected yet. Please check back shortly.';
  }
  if (form) form.querySelector('button[type="submit"]').disabled = true;
  console.warn('Missing Beta Portal configuration:', firebaseMissingFields);
} else {
  onAuthStateChanged(auth, user => {
    if (user && !isCompletingSignIn && location.pathname.endsWith('/beta-login.html')) {
      location.replace('beta-portal.html');
    }
  });
}

const params = new URLSearchParams(location.search);
const prefill = String(params.get('email') || '').trim().toLowerCase();
if (prefill && emailInput) emailInput.value = prefill;
if (params.get('error') === 'access') showError('Your RebataTrack Beta Portal access is currently disabled.');
if (params.get('error') === 'session') showError('Your portal session ended. Enter your approved beta email to sign in again.');
if (params.get('error') === 'inactive') showError('For your security, you were signed out after 6 hours of inactivity. Enter your approved beta email to sign in again.');
if (params.get('notice') === 'email-changed') showError('Your RebataTrack Beta email was updated. Your previous portal session ended. Sign in again using the new approved beta email shown below.', 'success');

if (form) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!firebaseConfigured || !validWorkerUrl()) return;
    if (!form.checkValidity()) { form.reportValidity(); return; }
    clearError();
    const button = document.getElementById('portalSendCode');
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = 'Sending Code…';
    pendingEmail = emailInput.value.trim().toLowerCase();
    try {
      const result = await workerPost({ type: 'beta-login-request', email: pendingEmail });
      form.hidden = true;
      codeForm.hidden = false;
      codeSent.textContent = `If ${pendingEmail} has active RebataTrack Beta Program access, a 6-digit verification code has been sent. The code expires in 10 minutes.`;
      codeInput.value = '';
      codeInput.focus();
      if (result.retryAfter) showError(`A verification code was sent recently. Wait ${result.retryAfter} seconds before requesting another.`, 'success');
    } catch (error) {
      showError(error.message || 'We could not send a verification code. Please try again.');
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  });
}

if (codeForm) {
  codeForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!codeForm.checkValidity()) { codeForm.reportValidity(); return; }
    clearError();
    const button = document.getElementById('portalVerifyCode');
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = 'Verifying…';
    try {
      const result = await workerPost({
        type: 'beta-login-verify',
        email: pendingEmail,
        code: String(codeInput.value || '').trim()
      });
      if (!result.customToken) throw new Error('The sign-in service did not return a valid session.');
      isCompletingSignIn = true;
      try { await signOut(auth); } catch (_) {}
      // Explicitly establish tab-scoped persistence before signing in so the
      // authenticated tester survives the navigation to beta-portal.html.
      await setPersistence(auth, browserSessionPersistence);
      const credential = await signInWithCustomToken(auth, result.customToken);
      // Force the authenticated session/token to be fully available before redirecting.
      await credential.user.getIdToken(true);
      sessionStorage.setItem('rebatifyBetaPortalLoginAt', String(Date.now()));
      location.replace('beta-portal.html');
    } catch (error) {
      isCompletingSignIn = false;
      showError(error.message || 'That verification code could not be verified.');
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  });
}

if (useDifferent) {
  useDifferent.addEventListener('click', () => {
    clearError();
    pendingEmail = '';
    codeInput.value = '';
    codeForm.hidden = true;
    form.hidden = false;
    emailInput.focus();
  });
}


function setSupportMessage(message='', tone='') {
  if (!supportMessage) return;
  supportMessage.textContent = message;
  supportMessage.className = 'portal-device-message' + (tone ? ` ${tone}` : '');
}

if (supportToggle && supportPanel) {
  supportToggle.addEventListener('click', () => {
    supportPanel.hidden = !supportPanel.hidden;
    supportToggle.textContent = supportPanel.hidden ? 'Need help signing in?' : 'Hide account & access help';
    if (!supportPanel.hidden) {
      if (supportEmail && !supportEmail.value) supportEmail.value = String(emailInput?.value || prefill || '').trim().toLowerCase();
      setTimeout(() => supportEmail?.focus(), 50);
    }
  });
}

if (supportForm) {
  supportForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!validWorkerUrl()) return;
    if (!supportForm.checkValidity()) { supportForm.reportValidity(); return; }
    const button = document.getElementById('portalSupportSubmit');
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = 'Sending…';
    setSupportMessage('');
    try {
      await workerPost({
        type: 'public-support-request',
        email: String(supportEmail?.value || '').trim().toLowerCase(),
        issue: String(supportIssue?.value || '').trim(),
        details: String(supportDetails?.value || '').trim()
      });
      setSupportMessage('Your request was submitted. If this email matches your RebataTrack Beta application or tester account, you will receive a confirmation email and the RebataTrack team has been notified.', 'success');
      supportIssue.value = '';
      supportDetails.value = '';
    } catch (error) {
      setSupportMessage(error.message || 'We could not send your support request right now. Please try again.', 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  });
}
