import { firebaseConfigured, auth, db, friendlyFirebaseError, timestampToDate } from './firebase-core.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const loading=document.getElementById('activateLoading');
const invalid=document.getElementById('activateInvalid');
const content=document.getElementById('activateContent');
const form=document.getElementById('activateForm');
const message=document.getElementById('activateMessage');
const button=document.getElementById('activateButton');
const modeNote=document.getElementById('activateModeNote');
let invite=null;
let inviteId='';
let existingAccountMode=false;

function showMessage(text,type='error'){
  message.textContent=text;
  message.className='beta-activate-message '+type;
  message.hidden=false;
}
function showInvalid(){loading.hidden=true;content.hidden=true;invalid.hidden=false;}
function fmtDate(value){const d=timestampToDate(value);return d?d.toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'—';}

async function loadInvite(){
  if(!firebaseConfigured){showInvalid();return;}
  inviteId=new URLSearchParams(location.search).get('invite')||'';
  if(!/^[a-f0-9]{64}$/i.test(inviteId)){showInvalid();return;}
  try{
    if(auth.currentUser)await signOut(auth).catch(()=>{});
    const snap=await getDoc(doc(db,'betaInvites',inviteId));
    if(!snap.exists()){showInvalid();return;}
    invite=snap.data();
    const expiry=timestampToDate(invite.expiresAt);
    if(invite.status!=='Pending'||!expiry||expiry.getTime()<=Date.now()){showInvalid();return;}
    document.getElementById('activateName').textContent=invite.fullName||'Beta Tester';
    document.getElementById('activateEmail').textContent=invite.email||'';
    document.getElementById('activatePlatform').textContent=invite.platform||'';
    document.getElementById('activateExpiry').textContent=fmtDate(invite.expiresAt);
    loading.hidden=true;content.hidden=false;
  }catch(error){console.error(error);showInvalid();}
}

async function finishActivation(user){
  if(!invite||!user||String(user.email||'').toLowerCase()!==String(invite.email||'').toLowerCase())throw new Error('This login does not match the approved beta email.');
  const profile={
    name:invite.fullName||'Beta Tester',
    email:String(invite.email||'').toLowerCase(),
    platform:invite.platform||'',
    status:'Active',
    accessStatus:'Enabled',
    applicationId:invite.applicationId,
    inviteId,
    createdAt:serverTimestamp(),
    updatedAt:serverTimestamp(),
    lastLogin:serverTimestamp()
  };
  await setDoc(doc(db,'betaUsers',user.uid),profile);
  await updateDoc(doc(db,'betaInvites',inviteId),{status:'Claimed',claimedUid:user.uid,claimedAt:serverTimestamp()});
  await updateDoc(doc(db,'betaApplications',invite.applicationId),{status:'Active',portalAccess:'Enabled',testerUid:user.uid,lastUpdated:serverTimestamp()});
}

form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!invite)return;
  const password=document.getElementById('activatePassword').value;
  const confirm=document.getElementById('activatePasswordConfirm').value;
  message.hidden=true;
  if(password.length<8){showMessage('Use a password with at least 8 characters.');return;}
  if(password!==confirm){showMessage('The passwords do not match.');return;}
  button.disabled=true;const original=button.innerHTML;button.innerHTML=existingAccountMode?'Signing In & Activating…':'Activating…';
  try{
    let credential;
    if(existingAccountMode){
      credential=await signInWithEmailAndPassword(auth,invite.email,password);
    }else{
      try{credential=await createUserWithEmailAndPassword(auth,invite.email,password);}
      catch(error){
        if(String(error&&error.code)==='auth/email-already-in-use'){
          existingAccountMode=true;
          button.disabled=false;button.innerHTML='Sign In & Activate <span aria-hidden="true">→</span>';
          modeNote.textContent='An account already exists for this approved email. Enter that account’s existing password, then choose Sign In & Activate.';
          showMessage('This email already has a login. Enter the existing account password to activate this invitation.');
          return;
        }
        throw error;
      }
    }
    await finishActivation(credential.user);
    showMessage('Your beta access is active. Opening the Tester Portal…','success');
    setTimeout(()=>location.replace('beta-portal.html'),700);
  }catch(error){
    if(String(error&&error.code).includes('invalid-credential')){
      existingAccountMode=true;
      modeNote.textContent='This email already has a login. Enter the existing password for that account to finish activation.';
      showMessage('That password did not match the existing account. Try the existing account password, or contact Rebatify Support.');
    }else showMessage(friendlyFirebaseError(error));
  }finally{
    if(!message.classList.contains('success')){button.disabled=false;button.innerHTML=existingAccountMode?'Sign In & Activate <span aria-hidden="true">→</span>':original;}
  }
});

loadInvite();
