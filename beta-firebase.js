import { firebaseConfigured, firebaseMissingFields, db, sha256Hex, friendlyFirebaseError } from './firebase-core.js';
import { doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const form = document.getElementById('betaApplicationForm');
const message = document.getElementById('betaFormMessage');
const success = document.getElementById('betaSuccess');

const iosEnrollmentNote = document.getElementById('betaIosEnrollmentNote');
function syncPlatformEnrollmentNote() {
  if (!iosEnrollmentNote || !form) return;
  const selected = form.querySelector('input[name="platform"]:checked');
  iosEnrollmentNote.hidden = !selected || selected.value !== 'iOS';
}
if (form) {
  form.querySelectorAll('input[name="platform"]').forEach(input => input.addEventListener('change', syncPlatformEnrollmentNote));
  syncPlatformEnrollmentNote();
}

function setMessage(text, type) {
  if (!message) return;
  message.textContent = text || '';
  message.className = 'beta-form-message' + (type ? ' ' + type : '');
}

if (form) {
  if (!firebaseConfigured) {
    setMessage('Beta signup is being configured. Please check back shortly.', 'error');
    const button = form.querySelector('.beta-submit');
    if (button) button.disabled = true;
    console.warn('Missing beta service configuration:', firebaseMissingFields);
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    setMessage('', '');
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (!firebaseConfigured) return;

    const data = new FormData(form);
    const honeypot = String(data.get('website') || '').trim();
    if (honeypot) {
      form.hidden = true;
      if (success) success.hidden = false;
      return;
    }

    const fullName = String(data.get('fullName') || '').trim();
    const email = String(data.get('email') || '').trim().toLowerCase();
    const platform = String(data.get('platform') || '').trim();
    const termsAccepted = data.get('termsAccepted') === 'yes';
    const button = form.querySelector('.beta-submit');
    const original = button ? button.innerHTML : '';

    if (!fullName || !email || !['iOS','Android'].includes(platform) || !termsAccepted) {
      setMessage('Please complete all required fields and acknowledge the beta terms.', 'error');
      return;
    }

    try {
      if (button) {
        button.disabled = true;
        button.innerHTML = 'Submitting…';
      }
      const id = await sha256Hex(email);
      await setDoc(doc(db, 'betaApplications', id), {
        fullName,
        email,
        platform,
        status: 'Applied',
        termsAccepted: true,
        source: 'rebatifyapp.github.io/beta.html',
        notes: '',
        portalAccess: 'Not Enabled',
        testerUid: '',
        submittedAt: serverTimestamp(),
        lastUpdated: serverTimestamp(),
        lastDecisionEmail: null
      });

      // Best-effort private notification to the RebataTrack owner. The application
      // is already safely stored before this runs, so an email-delivery issue
      // never causes the applicant to see a failed submission.
      try {
        const endpoint = String(window.REBATIFY_BETA_SETTINGS?.emailWorkerUrl || '').trim();
        if (endpoint) {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'beta-application-submitted', applicationId: id })
          });
          if (!response.ok) console.warn('Beta application owner notification could not be sent.', await response.text().catch(() => ''));
        }
      } catch (notifyError) {
        console.warn('Beta application owner notification failed.', notifyError);
      }

      form.hidden = true;
      if (success) {
        success.hidden = false;
        success.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } catch (error) {
      const code = String(error && error.code || '');
      if (code === 'permission-denied') {
        setMessage('An application for that email may already exist. If you believe this is an error, contact RebataTrack Support.', 'error');
      } else {
        setMessage('We could not submit your application right now. ' + friendlyFirebaseError(error), 'error');
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = original;
      }
    }
  });
}
