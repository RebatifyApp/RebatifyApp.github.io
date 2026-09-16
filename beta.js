(function () {
  const form = document.getElementById('betaApplicationForm');
  const message = document.getElementById('betaFormMessage');
  const success = document.getElementById('betaSuccess');
  if (!form) return;
  const endpoint = (window.REBATIFY_BETA_ENDPOINT || '').trim();
  function setMessage(text,type){message.textContent=text||'';message.className='beta-form-message'+(type?' '+type:'');}
  function randomId(){const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
  function jsonpResult(requestId){return new Promise((resolve,reject)=>{const cb='rebatifyApply_'+Date.now()+'_'+Math.floor(Math.random()*100000);const script=document.createElement('script');const timer=setTimeout(()=>{cleanup();reject(new Error('timeout'));},10000);function cleanup(){clearTimeout(timer);delete window[cb];script.remove();}window[cb]=d=>{cleanup();resolve(d);};script.onerror=()=>{cleanup();reject(new Error('network'));};const q=new URLSearchParams({action:'applyresult',requestId,callback:cb,_:Date.now()});script.src=endpoint+'?'+q.toString();document.head.appendChild(script);});}
  async function poll(requestId){for(let i=0;i<24;i++){await new Promise(r=>setTimeout(r,i<3?250:500));const result=await jsonpResult(requestId);if(result&&result.ready)return result;}throw new Error('timeout');}
  form.addEventListener('submit', async function (event) {
    event.preventDefault();setMessage('','');if(!form.checkValidity()){form.reportValidity();return;}
    if(!endpoint||endpoint.indexOf('script.google.com')===-1){setMessage('Beta signup is not connected yet. Please check back soon or contact Rebatify Support.','error');return;}
    const button=form.querySelector('.beta-submit');const originalText=button.innerHTML;button.disabled=true;button.innerHTML='Submitting…';
    const requestId=randomId();const data=new FormData(form);data.append('action','apply');data.append('source','rebatifyapp.github.io/beta.html');data.append('submittedAtClient',new Date().toISOString());data.append('requestId',requestId);const params=new URLSearchParams();data.forEach((value,key)=>params.append(key,value));
    try{
      await fetch(endpoint,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:params.toString()});
      const result=await poll(requestId);
      if(!result.ok){if(result.error==='duplicate')setMessage('An application has already been submitted for that email address.','error');else setMessage('We could not submit your application right now. Please check the form and try again.','error');return;}
      form.hidden=true;success.hidden=false;success.scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch(error){setMessage('We could not confirm your application submission. Please try again in a moment.','error');}
    finally{button.disabled=false;button.innerHTML=originalText;}
  });
})();
