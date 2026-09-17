// Rebatify Beta Tester Settings - Website Build 68
import { firebaseConfigured, auth, db, friendlyFirebaseError } from './firebase-core.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { doc, getDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const loading=document.getElementById('settingsLoading');
const app=document.getElementById('settingsApp');
const form=document.getElementById('settingsDeviceForm');
const message=document.getElementById('settingsMessage');
const PORTAL_ACTIVITY_KEY='rebatifyBetaPortalLastActivity';
const PORTAL_INACTIVITY_MS=6*60*60*1000;
let profile=null;

function fail(reason='session'){signOut(auth).catch(()=>{}).finally(()=>location.replace('beta-login.html?error='+encodeURIComponent(reason)));}
function detectedScreenSize(){try{return `${window.screen.width}×${window.screen.height} @ ${window.devicePixelRatio||1}x`;}catch(_){return '';}}
function detectedOsVersion(){const ua=navigator.userAgent||'';const ios=ua.match(/OS ([0-9_]+) like Mac OS X/i);if(ios)return 'iOS '+ios[1].replaceAll('_','.');const android=ua.match(/Android\s+([^;\)]+)/i);if(android)return 'Android '+android[1].trim();return '';}
function normalizedStage(value){if(value==='deviceReady')return 'setupComplete';if(['approved','setupComplete','inviteSent','activeTesting'].includes(value))return value;return 'approved';}
function setMessage(text,tone=''){message.textContent=text||'';message.className='portal-device-message'+(tone?' '+tone:'');}
function touchActivity(){sessionStorage.setItem(PORTAL_ACTIVITY_KEY,String(Date.now()));if(auth.currentUser)updateDoc(doc(db,'betaUsers',auth.currentUser.uid),{lastPortalActivity:serverTimestamp(),updatedAt:serverTimestamp()}).catch(()=>{});}

if(!firebaseConfigured){loading.innerHTML='<div class="portal-alert warning">The beta portal is not connected yet. Please check back shortly.</div>';}
else onAuthStateChanged(auth,async user=>{
  if(!user){fail('session');return;}
  const last=Number(sessionStorage.getItem(PORTAL_ACTIVITY_KEY)||0);if(last&&Date.now()-last>=PORTAL_INACTIVITY_MS){fail('inactive');return;}
  try{
    const snap=await getDoc(doc(db,'betaUsers',user.uid));if(!snap.exists())throw new Error('access');profile={id:snap.id,...snap.data()};
    if(profile.accessStatus!=='Enabled'||!['Approved','Active'].includes(profile.status))throw new Error('access');
    document.getElementById('settingsEmail').textContent=profile.email||user.email||'';
    document.getElementById('settingsPlatform').textContent=profile.platform||'';
    document.getElementById('settingsDeviceModel').value=profile.deviceModel||'';
    document.getElementById('settingsOsVersion').value=profile.osVersion||detectedOsVersion();
    document.getElementById('settingsScreenSize').value=detectedScreenSize()||profile.screenSize||'';
    touchActivity();loading.hidden=true;app.hidden=false;
  }catch(err){fail(err.message==='access'?'access':'session');}
});

['pointerdown','keydown','touchstart','scroll'].forEach(name=>window.addEventListener(name,()=>{const last=Number(sessionStorage.getItem(PORTAL_ACTIVITY_KEY)||0);if(last&&Date.now()-last>=PORTAL_INACTIVITY_MS){fail('inactive');return;}sessionStorage.setItem(PORTAL_ACTIVITY_KEY,String(Date.now()));},{passive:true}));

if(form)form.addEventListener('submit',async e=>{
  e.preventDefault();if(!form.checkValidity()){form.reportValidity();return;}if(!auth.currentUser||!profile){fail('session');return;}
  const button=form.querySelector('button[type="submit"]');const original=button.innerHTML;button.disabled=true;button.innerHTML='Saving…';setMessage('');
  const deviceModel=String(document.getElementById('settingsDeviceModel').value||'').trim();
  const osVersion=String(document.getElementById('settingsOsVersion').value||'').trim();
  const screenSize=detectedScreenSize()||String(document.getElementById('settingsScreenSize').value||'').trim();
  const firstSetup=normalizedStage(profile.timelineStage)==='approved';
  const update={deviceModel,osVersion,screenSize,deviceUpdatedAt:serverTimestamp(),lastPortalActivity:serverTimestamp(),updatedAt:serverTimestamp()};
  if(firstSetup){update.timelineStage='setupComplete';update.timelineUpdatedAt=serverTimestamp();update.deviceSetupCompletedAt=serverTimestamp();}
  try{
    await updateDoc(doc(db,'betaUsers',auth.currentUser.uid),update);
    Object.assign(profile,{deviceModel,osVersion,screenSize});if(firstSetup)profile.timelineStage='setupComplete';
    document.getElementById('settingsScreenSize').value=screenSize;
    sessionStorage.setItem(PORTAL_ACTIVITY_KEY,String(Date.now()));
    setMessage(firstSetup?'Settings saved. Your Beta Program timeline has advanced.':'Settings saved.','success');
  }catch(err){setMessage('We could not save your settings. '+friendlyFirebaseError(err),'error');}
  finally{button.disabled=false;button.innerHTML=original;}
});
