import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  setPersistence,
  browserSessionPersistence
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const config = window.REBATIFY_FIREBASE_CONFIG || {};
const settings = window.REBATIFY_BETA_SETTINGS || {};
const required = ['apiKey','authDomain','projectId','appId'];
const missing = required.filter(k => !String(config[k] || '').trim());

export const firebaseConfigured = missing.length === 0;
export const firebaseMissingFields = missing;
export const adminEmail = String(settings.adminEmail || 'support.rebatifyapp@gmail.com').trim().toLowerCase();
export const emailAutomationEnabled = settings.emailAutomationEnabled === true;
export const testerPortalUrl = String(settings.testerPortalUrl || 'https://rebatifyapp.github.io/beta-login.html').trim();

let app = null;
let auth = null;
let db = null;
let authPersistenceReady = Promise.resolve();

if (firebaseConfigured) {
  app = getApps().find(a => a.name === '[DEFAULT]') || initializeApp(config);
  auth = getAuth(app);
  authPersistenceReady = setPersistence(auth, browserSessionPersistence).catch(() => {});
  db = getFirestore(app);
}

export { app, auth, db, authPersistenceReady };

export function isAdminUser(user) {
  return !!user && String(user.email || '').trim().toLowerCase() === adminEmail;
}

export function timestampToDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function timestampToIso(value) {
  const d = timestampToDate(value);
  return d ? d.toISOString() : '';
}

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(String(text || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
}

export function friendlyFirebaseError(error) {
  const code = String(error && error.code || '');
  const map = {
    'auth/invalid-credential': 'That email or password was not recognized.',
    'auth/invalid-login-credentials': 'That email or password was not recognized.',
    'auth/user-disabled': 'This account is currently disabled.',
    'auth/too-many-requests': 'Too many attempts were made. Please wait a moment and try again.',
    'auth/email-already-in-use': 'An authentication account already exists for this email address.',
    'auth/weak-password': 'Please use a stronger password.',
    'auth/network-request-failed': 'The connection could not be completed. Please check your connection and try again.',
    'auth/unauthorized-continue-uri': 'The password email could not open the requested return page. Refresh the website and try again.',
    'permission-denied': 'This action could not be completed because access is not permitted.',
    'failed-precondition': 'This feature is not fully configured yet.',
    'rebatify/email-not-configured': 'The RebataTrack email service has not been connected yet.',
    'rebatify/email-send-failed': 'The RebataTrack invitation email could not be sent.',
    'rebatify/invite-expired': 'This beta invitation has expired.',
    'rebatify/invite-invalid': 'This beta invitation is invalid or has already been used.'
  };
  return map[code] || (error && error.message ? error.message : 'Something went wrong. Please try again.');
}

// Build 73 — make native text replacement, composition, dictation, paste, and autofill
// visible to all RebataTrack Beta/Admin form logic without depending on key events.
function isCompatibleTextField(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return ['text','email','search','url','tel','number'].includes(String(target.type || 'text').toLowerCase());
}
function resyncNativeField(target) {
  if (!isCompatibleTextField(target)) return;
  target.setCustomValidity('');
  target.dataset.rebatifyLiveValue = target.value;
}
document.addEventListener('input', event => resyncNativeField(event.target), true);
document.addEventListener('change', event => resyncNativeField(event.target), true);
document.addEventListener('compositionend', event => {
  const target = event.target;
  if (!isCompatibleTextField(target)) return;
  requestAnimationFrame(() => {
    resyncNativeField(target);
    target.dispatchEvent(new Event('input', { bubbles:true }));
  });
}, true);
document.addEventListener('paste', event => {
  const target = event.target;
  if (!isCompatibleTextField(target)) return;
  requestAnimationFrame(() => resyncNativeField(target));
}, true);
