(function(){
  const endpoint=(window.REBATIFY_BETA_ENDPOINT||'').trim();
  const loading=document.getElementById('portalLoading');
  const app=document.getElementById('portalApp');
  const content=document.getElementById('portalContent');
  const passwordGate=document.getElementById('passwordRequired');
  const logout=document.getElementById('portalLogout');
  let sessionToken='';

  function parseHash(){
    const raw=location.hash.replace(/^#/,'');
    const params=new URLSearchParams(raw);
    const token=params.get('session');
    if(token){localStorage.setItem('rebatifyBetaSession',token);}
    return token||localStorage.getItem('rebatifyBetaSession')||'';
  }

  function fail(){
    localStorage.removeItem('rebatifyBetaSession');
    location.replace('beta-login.html?error=session');
  }

  function jsonpSession(token){
    return new Promise((resolve,reject)=>{
      const cb='rebatifySession_'+Date.now()+'_'+Math.floor(Math.random()*100000);
      const script=document.createElement('script');
      const timer=setTimeout(()=>{cleanup();reject(new Error('timeout'));},10000);
      function cleanup(){clearTimeout(timer);delete window[cb];script.remove();}
      window[cb]=data=>{cleanup();resolve(data);};
      script.onerror=()=>{cleanup();reject(new Error('network'));};
      script.src=endpoint+'?action=session&token='+encodeURIComponent(token)+'&callback='+encodeURIComponent(cb)+'&_='+Date.now();
      document.head.appendChild(script);
    });
  }

  function firstName(name){return (name||'Tester').trim().split(/\s+/)[0]||'Tester';}

  async function init(){
    if(!endpoint || endpoint.indexOf('script.google.com')===-1){
      loading.innerHTML='<div class="portal-alert warning">The beta portal has not been connected to the backend yet.</div>';
      return;
    }
    sessionToken=parseHash();
    if(!sessionToken){fail();return;}
    try{
      const data=await jsonpSession(sessionToken);
      if(!data||!data.authenticated){fail();return;}
      document.getElementById('portalFirstName').textContent=firstName(data.name);
      document.getElementById('portalEmail').textContent=data.email||'';
      document.getElementById('portalPlatform').textContent=data.platform||'';
      document.getElementById('changePasswordToken').value=sessionToken;
      const changeForm=document.getElementById('changePasswordForm');
      changeForm.action=endpoint;

      if(data.platform==='iOS'){
        document.getElementById('platformInstallCopy').textContent='Use the latest Rebatify beta build delivered through TestFlight.';
        document.getElementById('platformInstallMeta').textContent='Your TestFlight invitation and current build information will be provided as beta access is distributed.';
      }else if(data.platform==='Android'){
        document.getElementById('platformInstallCopy').textContent='Use the latest Rebatify beta build delivered through Google Play testing.';
        document.getElementById('platformInstallMeta').textContent='Your Google Play testing invitation and current build information will be provided as beta access is distributed.';
      }

      loading.hidden=true;
      app.hidden=false;
      if(data.mustChangePassword){
        passwordGate.hidden=false;
        content.classList.add('portal-locked-content');
        setTimeout(()=>passwordGate.scrollIntoView({behavior:'smooth',block:'start'}),150);
      }else{
        passwordGate.hidden=true;
        content.classList.remove('portal-locked-content');
      }
    }catch(e){fail();}
  }

  logout.addEventListener('click',()=>{
    localStorage.removeItem('rebatifyBetaSession');
    location.replace('beta-login.html');
  });

  const changeForm=document.getElementById('changePasswordForm');
  changeForm.addEventListener('submit',e=>{
    const p=document.getElementById('newPassword').value;
    const c=document.getElementById('confirmPassword').value;
    if(p.length<10 || !/[A-Za-z]/.test(p) || !/\d/.test(p) || p!==c){
      e.preventDefault();
      alert('Your new password must be at least 10 characters, include a letter and a number, and both entries must match.');
    }
  });

  const feedbackForm=document.getElementById('portalFeedbackForm');
  const feedbackMessage=document.getElementById('feedbackMessage');
  feedbackForm.addEventListener('submit',async e=>{
    e.preventDefault();
    if(!feedbackForm.checkValidity()){feedbackForm.reportValidity();return;}
    const button=feedbackForm.querySelector('button[type="submit"]');
    const original=button.innerHTML;
    button.disabled=true;button.innerHTML='Submitting…';
    feedbackMessage.textContent='';feedbackMessage.className='portal-feedback-message';
    const data=new FormData(feedbackForm);
    data.append('action','feedback');data.append('token',sessionToken);
    const params=new URLSearchParams();data.forEach((v,k)=>params.append(k,v));
    try{
      await fetch(endpoint,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:params.toString()});
      feedbackForm.reset();
      feedbackMessage.textContent='Thank you — your feedback was submitted.';
      feedbackMessage.className='portal-feedback-message success';
    }catch(err){
      feedbackMessage.textContent='We could not submit your feedback right now. Please try again.';
      feedbackMessage.className='portal-feedback-message error';
    }finally{button.disabled=false;button.innerHTML=original;}
  });

  init();
})();
