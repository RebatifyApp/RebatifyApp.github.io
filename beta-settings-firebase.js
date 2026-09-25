// RebataTrack Beta Tester Settings - Website Build 88
import { firebaseConfigured, auth, db, friendlyFirebaseError } from './firebase-core.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { doc, getDoc, updateDoc, serverTimestamp, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const loading=document.getElementById('settingsLoading');
const app=document.getElementById('settingsApp');
const form=document.getElementById('settingsDeviceForm');
const message=document.getElementById('settingsMessage');
const PORTAL_ACTIVITY_KEY='rebatifyBetaPortalLastActivity';
const PORTAL_INACTIVITY_MS=6*60*60*1000;
let profile=null;
let inactivityTimer=null;
let sessionEnding=false;
let lastActivityWrite=0;
let profileUnsubscribe=null;

function fail(reason='session'){sessionEnding=true;clearTimeout(inactivityTimer);if(profileUnsubscribe){profileUnsubscribe();profileUnsubscribe=null;}signOut(auth).catch(()=>{}).finally(()=>location.replace('beta-login.html?error='+encodeURIComponent(reason)));}
function endEmailChangedSession(newEmail=''){if(sessionEnding)return;sessionEnding=true;clearTimeout(inactivityTimer);if(profileUnsubscribe){profileUnsubscribe();profileUnsubscribe=null;}const target=String(newEmail||'').trim().toLowerCase();signOut(auth).catch(()=>{}).finally(()=>{const params=new URLSearchParams();params.set('notice','email-changed');if(target)params.set('email',target);location.replace('beta-login.html?'+params.toString());});}
function detectedScreenSize(){try{return `${window.screen.width}×${window.screen.height} @ ${window.devicePixelRatio||1}x`;}catch(_){return '';}}
function detectedOsVersion(){const ua=navigator.userAgent||'';const ios=ua.match(/OS ([0-9_]+) like Mac OS X/i);if(ios)return 'iOS '+ios[1].replaceAll('_','.');const android=ua.match(/Android\s+([^;\)]+)/i);if(android)return 'Android '+android[1].trim();return '';}
function normalizedStage(value){if(value==='deviceReady')return 'setupComplete';if(['approved','setupComplete','inviteSent','activeTesting'].includes(value))return value;return 'approved';}
function distributionAccountConfirmed(p=profile||{}){return !!String(p.distributionAccountEmail||'').trim()&&!!p.distributionAccountConfirmedAt;}
function testFlightPrepared(p=profile||{}){if(String(p.platform||'')!=='iOS')return true;return !!p.testFlightPreparedAt||['setupComplete','inviteSent','activeTesting'].includes(normalizedStage(p.timelineStage))||!!p.deviceSetupCompletedAt;}
function applyPlatformCopy(p=profile||{}){
  const ios=String(p.platform||'')==='iOS';const email=String(p.email||auth.currentUser?.email||'').trim();
  const os=document.getElementById('settingsOsVersion');if(os)os.placeholder=ios?'Example: iOS 27':'Example: Android 17';
  const label=document.getElementById('settingsDistributionEmailLabel');if(label)label.textContent=ios?'Apple Account email':'Google Play account email';
  const input=document.getElementById('settingsDistributionEmail');if(input)input.value=email;
  const help=document.getElementById('settingsDistributionEmailHelp');if(help)help.textContent=ios?'This approved beta email must match the Apple Account signed in for the App Store/TestFlight on your testing iPhone or iPad.':'This is the Google Account expected in Google Play on your testing Android device.';
  const text=document.getElementById('settingsDistributionConfirmText');if(text)text.textContent=ios?'I confirm this approved beta email matches the Apple Account signed in on my testing iPhone or iPad.':'I confirm this is the Google Account selected in Google Play on my testing Android device.';
  const requirement=document.getElementById('settingsTestFlightRequirement');if(requirement)requirement.hidden=!ios;
  const check=document.getElementById('settingsDistributionConfirm');if(check){const confirmed=distributionAccountConfirmed(p);check.checked=confirmed;check.required=!confirmed;check.disabled=confirmed;}
}
function setMessage(text,tone=''){message.textContent=text||'';message.className='portal-device-message'+(tone?' '+tone:'');}
function scheduleInactivityLogout(){
  clearTimeout(inactivityTimer);
  const last=Number(sessionStorage.getItem(PORTAL_ACTIVITY_KEY)||Date.now());
  const remaining=PORTAL_INACTIVITY_MS-(Date.now()-last);
  if(remaining<=0){fail('inactive');return;}
  inactivityTimer=setTimeout(()=>fail('inactive'),remaining+250);
}
function touchActivity(forceWrite=false){
  if(sessionEnding)return;
  const now=Date.now();
  sessionStorage.setItem(PORTAL_ACTIVITY_KEY,String(now));
  scheduleInactivityLogout();
  if(auth.currentUser&&(forceWrite||now-lastActivityWrite>5*60*1000)){
    lastActivityWrite=now;
    updateDoc(doc(db,'betaUsers',auth.currentUser.uid),{lastPortalActivity:serverTimestamp(),updatedAt:serverTimestamp()}).catch(()=>{});
  }
}
function startInactivityWatcher(){
  touchActivity(true);
  ['pointerdown','keydown','touchstart','scroll'].forEach(name=>window.addEventListener(name,()=>touchActivity(false),{passive:true}));
  window.addEventListener('focus',()=>{const last=Number(sessionStorage.getItem(PORTAL_ACTIVITY_KEY)||0);if(last&&Date.now()-last>=PORTAL_INACTIVITY_MS)fail('inactive');else touchActivity(false);});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){const last=Number(sessionStorage.getItem(PORTAL_ACTIVITY_KEY)||0);if(last&&Date.now()-last>=PORTAL_INACTIVITY_MS)fail('inactive');else scheduleInactivityLogout();}});
}
function installSettingsTextEntryCompatibility(){
  document.querySelectorAll('#settingsDeviceForm input[type="text"],#settingsDeviceForm input[type="email"],#settingsDeviceForm textarea').forEach(field=>{
    const sync=()=>field.setCustomValidity('');
    field.addEventListener('input',sync);field.addEventListener('change',sync);field.addEventListener('compositionend',sync);field.addEventListener('paste',()=>requestAnimationFrame(sync));
  });
}

if(!firebaseConfigured){loading.innerHTML='<div class="portal-alert warning">The Beta Portal is not connected yet. Please check back shortly.</div>';}
else onAuthStateChanged(auth,async user=>{
  if(!user){fail('session');return;}
  const last=Number(sessionStorage.getItem(PORTAL_ACTIVITY_KEY)||0);if(last&&Date.now()-last>=PORTAL_INACTIVITY_MS){fail('inactive');return;}
  try{
    const snap=await getDoc(doc(db,'betaUsers',user.uid));if(!snap.exists())throw new Error('access');profile={id:snap.id,...snap.data()};
    if(profile.accessStatus!=='Enabled'||!['Approved','Active'].includes(profile.status))throw new Error('access');
    document.getElementById('settingsEmail').textContent=profile.email||user.email||'';
    document.getElementById('settingsPlatform').textContent=profile.platform||'';
    document.getElementById('settingsDeviceModel').value=profile.deviceModel||'';
    document.getElementById('settingsOsVersion').value=profile.osVersion||'';
    document.getElementById('settingsScreenSize').value=detectedScreenSize()||profile.screenSize||'';
    applyPlatformCopy(profile);
    if(profileUnsubscribe)profileUnsubscribe();
    const sessionEmail=String(user.email||'').trim().toLowerCase();
    profileUnsubscribe=onSnapshot(doc(db,'betaUsers',user.uid),snap=>{
      if(!snap.exists()){fail('access');return;}
      const next={id:snap.id,...snap.data()};
      if(next.accessStatus!=='Enabled'||!['Approved','Active'].includes(next.status)){fail('access');return;}
      const profileEmail=String(next.email||'').trim().toLowerCase();
      if(sessionEmail&&profileEmail&&sessionEmail!==profileEmail){endEmailChangedSession(profileEmail);return;}
      profile=next;document.getElementById('settingsEmail').textContent=profile.email||user.email||'';applyPlatformCopy(profile);
    },err=>console.warn('Settings profile listener failed:',err));
    installSettingsTextEntryCompatibility();startInactivityWatcher();loading.hidden=true;app.hidden=false;
  }catch(err){fail(err.message==='access'?'access':'session');}
});

if(form)form.addEventListener('submit',async e=>{
  e.preventDefault();if(!form.checkValidity()){form.reportValidity();return;}if(!auth.currentUser||!profile){fail('session');return;}
  const button=form.querySelector('button[type="submit"]');const original=button.innerHTML;button.disabled=true;button.innerHTML='Saving…';setMessage('');
  const deviceModel=String(document.getElementById('settingsDeviceModel').value||'').trim();
  const osVersion=String(document.getElementById('settingsOsVersion').value||'').trim();
  const screenSize=detectedScreenSize()||String(document.getElementById('settingsScreenSize').value||'').trim();
  const firstSetup=normalizedStage(profile.timelineStage)==='approved';const needsAccountConfirmation=!distributionAccountConfirmed(profile);const ios=String(profile.platform||'')==='iOS';
  if(firstSetup&&ios&&!testFlightPrepared(profile)){setMessage('Complete Step 2 in Progress first by installing and confirming TestFlight before completing Testing Setup.','error');button.disabled=false;button.innerHTML=original;return;}
  const distributionConfirm=document.getElementById('settingsDistributionConfirm');if(needsAccountConfirmation&&(!distributionConfirm||!distributionConfirm.checked)){setMessage(ios?'Confirm that the Apple Account signed in on this iPhone or iPad matches your approved beta email before continuing.':'Confirm the Google Play account you use for beta distribution before continuing.','error');button.disabled=false;button.innerHTML=original;return;}
  const distributionAccountEmail=String(profile.email||auth.currentUser.email||'').trim();
  const update={deviceModel,osVersion,screenSize,deviceUpdatedAt:serverTimestamp(),lastPortalActivity:serverTimestamp(),updatedAt:serverTimestamp()};
  // Initial setup always refreshes the tester's account confirmation, including
  // after an Admin beta-email/account swap.
  if(firstSetup||needsAccountConfirmation){update.distributionAccountEmail=distributionAccountEmail;update.distributionAccountConfirmedAt=serverTimestamp();}
  if(firstSetup){update.timelineStage='setupComplete';update.timelineUpdatedAt=serverTimestamp();update.deviceSetupCompletedAt=serverTimestamp();}
  try{
    await updateDoc(doc(db,'betaUsers',auth.currentUser.uid),update);
    Object.assign(profile,{deviceModel,osVersion,screenSize});if(firstSetup||needsAccountConfirmation){profile.distributionAccountEmail=distributionAccountEmail;profile.distributionAccountConfirmedAt=new Date();}if(firstSetup)profile.timelineStage='setupComplete';applyPlatformCopy(profile);
    document.getElementById('settingsScreenSize').value=screenSize;
    touchActivity(true);
    setMessage(firstSetup?(ios?'Settings saved. Step 3 is complete and your Beta Program timeline advanced to Step 4.':'Settings saved. Step 2 is complete and your Beta Program timeline advanced to Step 3.'):'Settings saved.','success');
  }catch(err){setMessage('We could not save your settings. '+friendlyFirebaseError(err),'error');}
  finally{button.disabled=false;button.innerHTML=original;}
});
