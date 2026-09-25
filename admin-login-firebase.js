import { firebaseConfigured, firebaseMissingFields, auth, isAdminUser, adminEmail, friendlyFirebaseError } from './firebase-core.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const form = document.getElementById('adminLoginForm');
const errorBox = document.getElementById('adminLoginError');
const notConnected = document.getElementById('adminNotConnected');
const resetButton = document.getElementById('adminForgotPassword');

function showError(message, tone='error') {
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.className = 'admin-alert admin-alert-' + tone;
  errorBox.hidden = false;
}
function clearError(){ if (errorBox) errorBox.hidden = true; }

if (!firebaseConfigured) {
  if (notConnected) {
    notConnected.hidden = false;
    notConnected.textContent = 'The admin portal is not connected to its data service yet.';
  }
  if (form) form.querySelector('button[type="submit"]').disabled = true;
  if (resetButton) resetButton.disabled = true;
  console.warn('Missing admin service configuration:', firebaseMissingFields);
} else {
  onAuthStateChanged(auth, async user => {
    if (!user) return;
    if (isAdminUser(user)) {
      location.replace('admin.html');
    } else {
      await signOut(auth).catch(() => {});
    }
  });
}

if (form) {
  const emailField = document.getElementById('adminEmail');
  if (emailField) emailField.value = adminEmail;

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
      const email = document.getElementById('adminEmail').value.trim().toLowerCase();
      const password = document.getElementById('adminPassword').value;
      const credential = await signInWithEmailAndPassword(auth, email, password);
      if (!isAdminUser(credential.user)) {
        await signOut(auth);
        showError('This account is not authorized for RebataTrack Beta Program administration.');
        return;
      }
      location.replace('admin.html');
    } catch (error) {
      await signOut(auth).catch(() => {});
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
    resetButton.disabled = true;
    const original = resetButton.textContent;
    resetButton.textContent = 'Sending…';
    try {
      await sendPasswordResetEmail(auth, adminEmail);
      showError('A password-reset email has been requested for the RebataTrack support account.', 'warning');
    } catch (error) {
      showError(friendlyFirebaseError(error));
    } finally {
      resetButton.disabled = false;
      resetButton.textContent = original;
    }
  });
}
