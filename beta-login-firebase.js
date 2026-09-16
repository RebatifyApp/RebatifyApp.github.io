import { firebaseConfigured, firebaseMissingFields, auth, friendlyFirebaseError } from './firebase-core.js';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const form = document.getElementById('portalLoginForm');
const errorBox = document.getElementById('portalLoginError');
const notConnected = document.getElementById('portalNotConnected');
const resetButton = document.getElementById('portalForgotPassword');

function showError(message, tone='error') {
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.className = 'portal-alert ' + tone;
  errorBox.hidden = false;
}
function clearError() { if (errorBox) errorBox.hidden = true; }

if (!firebaseConfigured) {
  if (notConnected) {
    notConnected.hidden = false;
    notConnected.textContent = 'The tester portal is not connected yet. Please check back shortly.';
  }
  if (form) form.querySelector('button[type="submit"]').disabled = true;
  if (resetButton) resetButton.disabled = true;
  console.warn('Missing beta service configuration:', firebaseMissingFields);
} else {
  onAuthStateChanged(auth, user => {
    if (user && location.pathname.endsWith('/beta-login.html')) {
      location.replace('beta-portal.html');
    }
  });
}

const params = new URLSearchParams(location.search);
if (params.get('error') === 'access') showError('Your beta portal access is currently disabled.');
if (params.get('error') === 'session') showError('Please sign in to continue.');

if (form) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!firebaseConfigured) return;
    if (!form.checkValidity()) { form.reportValidity(); return; }
    clearError();
    const button = form.querySelector('button[type="submit"]');
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = 'Signing In…';
    try {
      const email = document.getElementById('portalEmail').value.trim().toLowerCase();
      const password = document.getElementById('portalPassword').value;
      await signInWithEmailAndPassword(auth, email, password);
      location.replace('beta-portal.html');
    } catch (error) {
      try { await signOut(auth); } catch (_) {}
      showError(friendlyFirebaseError(error));
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  });
}

if (resetButton) {
  resetButton.addEventListener('click', async () => {
    if (!firebaseConfigured) return;
    clearError();
    const email = document.getElementById('portalEmail').value.trim().toLowerCase();
    if (!email) {
      showError('Enter your approved beta email address first, then choose Reset Password.');
      return;
    }
    resetButton.disabled = true;
    const original = resetButton.textContent;
    resetButton.textContent = 'Sending…';
    try {
      await sendPasswordResetEmail(auth, email, { url: 'https://rebatifyapp.github.io/beta-login.html' });
      showError('If that email has beta access, a password-reset message has been sent.', 'success');
    } catch (error) {
      showError(friendlyFirebaseError(error));
    } finally {
      resetButton.disabled = false;
      resetButton.textContent = original;
    }
  });
}
