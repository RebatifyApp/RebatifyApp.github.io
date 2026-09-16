(function(){
  const endpoint=(window.REBATIFY_BETA_ENDPOINT||'').trim();
  const loading=document.getElementById('portalLoading');
  const app=document.getElementById('portalApp');
  const content=document.getElementById('portalContent');
  const passwordGate=document.getElementById('passwordRequired');
  const logout=document.getElementById('portalLogout');
  const changeForm=document.getElementById('changePasswordForm');
  const feedbackForm=document.getElementById('portalFeedbackForm');
  const feedbackMessage=document.getElementById('feedbackMessage');
  let sessionToken='';

  function randomRequestId(){
    const bytes=new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  }

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

  function jsonp(action,args){
    return new Promise((resolve,reject)=>{
      const cb='rebatifyPortal_'+Date.now()+'_'+Math.floor(Math.random()*100000);
      const script=document.createElement('script');
      const timer=setTimeout(()=>{cleanup();reject(new Error('timeout'));},10000);
      function cleanup(){clearTimeout(timer);delete window[cb];script.remove();}
      window[cb]=data=>{cleanup();resolve(data);};
      script.onerror=()=>{cleanup();reject(new Error('network'));};
      const params=new URLSearchParams(Object.assign({action,callback:cb,_:Date.now()},args||{}));
      script.src=endpoint+'?'+params.toString();
      document.head.appendChild(script);
    });
  }

  async function postAndPoll(postAction,resultAction,fields){
    const requestId=randomRequestId();
    const params=new URLSearchParams(Object.assign({action:postAction,requestId},fields||{}));
    await fetch(endpoint,{
      method:'POST',
      mode:'no-cors',
      headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:params.toString()
    });
    for(let i=0;i<24;i++){
      await new Promise(r=>setTimeout(r,i<3?250:500));
      const result=await jsonp(resultAction,{requestId});
      if(result&&result.ready)return result;
    }
    throw new Error('timeout');
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
      const data=await jsonp('session',{token:sessionToken});
      if(!data||!data.authenticated){fail();return;}
      document.getElementById('portalFirstName').textContent=firstName(data.name);
      document.getElementById('portalEmail').textContent=data.email||'';
      document.getElementById('portalPlatform').textContent=data.platform||'';
      document.getElementById('changePasswordToken').value=sessionToken;

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

  changeForm.addEventListener('submit',async e=>{
    e.preventDefault();
    const p=document.getElementById('newPassword').value;
    const c=document.getElementById('confirmPassword').value;
    if(p.length<10||!/[A-Za-z]/.test(p)||!/[0-9]/.test(p)||p!==c){
      alert('Your new password must be at least 10 characters, include a letter and a number, and both entries must match.');
      return;
    }
    const button=changeForm.querySelector('button[type="submit"]');
    const original=button.textContent;
    button.disabled=true;button.textContent='Saving…';
    try{
      const result=await postAndPoll('changePassword','changepasswordresult',{token:sessionToken,newPassword:p,confirmPassword:c});
      if(!result.ok){
        if(result.error==='session'||result.error==='access'){fail();return;}
        alert('Your password could not be changed. Please try again.');
        return;
      }
      changeForm.reset();
      passwordGate.hidden=true;
      content.classList.remove('portal-locked-content');
    }catch(err){
      alert('The password update did not finish. Please try again.');
    }finally{
      button.disabled=false;button.textContent=original;
    }
  });

  feedbackForm.addEventListener('submit',async e=>{
    e.preventDefault();
    if(!feedbackForm.checkValidity()){feedbackForm.reportValidity();return;}
    const button=feedbackForm.querySelector('button[type="submit"]');
    const original=button.innerHTML;
    button.disabled=true;button.innerHTML='Submitting…';
    feedbackMessage.textContent='';feedbackMessage.className='portal-feedback-message';
    const fields={token:sessionToken};
    new FormData(feedbackForm).forEach((v,k)=>fields[k]=v);
    try{
      const result=await postAndPoll('feedback','feedbackresult',fields);
      if(!result.ok){
        if(result.error==='session'||result.error==='access'){fail();return;}
        throw new Error(result.error||'submit');
      }
      feedbackForm.reset();
      feedbackMessage.textContent='Thank you — your feedback was submitted.';
      feedbackMessage.className='portal-feedback-message success';
    }catch(err){
      feedbackMessage.textContent='We could not submit your feedback right now. Please try again.';
      feedbackMessage.className='portal-feedback-message error';
    }finally{
      button.disabled=false;button.innerHTML=original;
    }
  });

  init();
})();
