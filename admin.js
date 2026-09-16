(function(){
  'use strict';
  window.__REBATIFY_ADMIN_STARTED=true;
  const endpoint=(window.REBATIFY_BETA_ENDPOINT||'').trim();
  const loading=document.getElementById('adminLoading');
  const app=document.getElementById('adminApp');
  const portalContent=document.getElementById('adminPortalContent');
  const passwordGate=document.getElementById('adminPasswordGate');
  const toast=document.getElementById('adminToast');
  let sessionToken='';
  let state={metrics:{},applications:[],feedback:[],testers:[]};
  let activeView='overview';

  function showFatal(message,detail){
    window.__REBATIFY_ADMIN_READY=true;
    const safeMessage=String(message||'The admin portal could not open.');
    const safeDetail=String(detail||'');
    loading.innerHTML='<div class="admin-loading-mark"><img src="app-icon.png" alt=""></div>'+
      '<div style="max-width:560px;text-align:center;padding:0 24px">'+
      '<h2 style="margin:10px 0 8px;color:#0b1831">Admin portal could not open</h2>'+
      '<p style="margin:0 0 8px;color:#5f6f86;font-weight:700">'+esc(safeMessage)+'</p>'+
      (safeDetail?'<p style="margin:0 0 18px;color:#7c8798;font-size:.92rem">'+esc(safeDetail)+'</p>':'')+
      '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">'+
      '<button type="button" onclick="location.reload()" class="admin-primary-button">Try Again</button>'+
      '<a href="admin-login.html" class="admin-secondary-button" style="text-decoration:none;display:inline-flex;align-items:center">Return to Sign In</a>'+
      '</div></div>';
  }

  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function parseHash(){
    const raw=location.hash.replace(/^#/,'');
    const params=new URLSearchParams(raw);
    const token=params.get('session');
    if(token){localStorage.setItem('rebatifyAdminSession',token);}
    return token||localStorage.getItem('rebatifyAdminSession')||'';
  }
  function fail(){localStorage.removeItem('rebatifyAdminSession');location.replace('admin-login.html?error=session');}
  function jsonp(action,args){
    return new Promise((resolve,reject)=>{
      const cb='rebatifyAdmin_'+Date.now()+'_'+Math.floor(Math.random()*100000);
      const script=document.createElement('script');
      const timer=setTimeout(()=>{cleanup();reject(new Error('timeout'));},15000);
      function cleanup(){clearTimeout(timer);delete window[cb];script.remove();}
      window[cb]=data=>{cleanup();resolve(data);};
      script.onerror=()=>{cleanup();reject(new Error('network'));};
      const p=new URLSearchParams(Object.assign({action,token:sessionToken,callback:cb,_:Date.now()},args||{}));
      script.src=endpoint+'?'+p.toString();
      document.head.appendChild(script);
    });
  }
  function showToast(message,type){
    toast.textContent=message;
    toast.className='admin-toast '+(type||'success');
    toast.hidden=false;
    clearTimeout(showToast.timer);
    showToast.timer=setTimeout(()=>{toast.hidden=true;},3600);
  }

  function confirmAction(message,tone){
    return new Promise(resolve=>{
      const back=document.getElementById('adminConfirmBackdrop');
      const msg=document.getElementById('adminConfirmMessage');
      const icon=document.getElementById('adminConfirmIcon');
      const ok=document.getElementById('adminConfirmOk');
      const cancel=document.getElementById('adminConfirmCancel');
      msg.textContent=message;
      icon.textContent=tone==='danger'?'!':'✓';
      icon.className='admin-confirm-icon '+(tone==='danger'?'danger':'');
      ok.textContent=tone==='danger'?'Confirm':'Continue';
      ok.className='admin-primary-button'+(tone==='danger'?' admin-confirm-danger':'');
      back.hidden=false;
      function done(value){back.hidden=true;ok.removeEventListener('click',yes);cancel.removeEventListener('click',no);back.removeEventListener('click',outside);resolve(value);}
      function yes(){done(true);} function no(){done(false);} function outside(e){if(e.target===back)done(false);}
      ok.addEventListener('click',yes);cancel.addEventListener('click',no);back.addEventListener('click',outside);
    });
  }
  function formatDate(value){
    if(!value)return '—';
    const d=new Date(value); if(Number.isNaN(d.getTime()))return String(value);
    return d.toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  }
  function relativeDate(value){
    if(!value)return '—'; const d=new Date(value); if(Number.isNaN(d.getTime()))return String(value);
    const diff=Date.now()-d.getTime(); const m=Math.floor(diff/60000); if(m<1)return 'Just now'; if(m<60)return m+'m ago'; const h=Math.floor(m/60); if(h<24)return h+'h ago'; const days=Math.floor(h/24); if(days<8)return days+'d ago'; return d.toLocaleDateString([], {month:'short',day:'numeric'});
  }
  function statusClass(status){return 'status-'+String(status||'').toLowerCase().replace(/[^a-z]+/g,'-');}
  function typeIcon(type){
    if(type==='Feature Request')return '✦'; if(type==='Crash / Performance')return '⚡'; if(type==='Confusing Experience')return '?'; if(type==='General Feedback')return '💬'; return '●';
  }

  async function init(){
    if(!endpoint || endpoint.indexOf('script.google.com')===-1){showFatal('The Rebatify admin portal has not been connected to its backend.');return;}
    sessionToken=parseHash(); if(!sessionToken){fail();return;}
    try{
      const data=await jsonp('admindata');
      if(!data||data.authenticated===false){fail();return;}
      if(data.ok===false){showFatal(data.message||'Could not load beta administration data.');return;}
      const admin=data.admin||{};
      document.getElementById('adminIdentityEmail').textContent=admin.email||'support.rebatifyapp@gmail.com';
      document.getElementById('adminPasswordToken').value=sessionToken;
      if(admin.mustChangePassword){passwordGate.hidden=false;portalContent.classList.add('admin-content-locked');}
      state=data; renderAll();
      loading.hidden=true;app.hidden=false;window.__REBATIFY_ADMIN_READY=true;
    }catch(err){showFatal('The browser could not open your administrator session.', err && err.message ? err.message : 'Backend connection failed.');}
  }

  async function loadData(silent){
    try{
      if(!silent)document.getElementById('adminRefresh').classList.add('is-spinning');
      const data=await jsonp('admindata');
      if(!data||data.authenticated===false){fail();return;}
      if(data.ok===false){showToast(data.message||'Could not load admin data.','error');return;}
      state=data;
      renderAll();
    }catch(err){showToast('Could not refresh beta data. Please try again.','error');}
    finally{document.getElementById('adminRefresh').classList.remove('is-spinning');}
  }

  function renderAll(){
    const m=state.metrics||{};
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v==null?0:v;};
    set('metricApplied',m.applied);set('metricApproved',m.approved);set('metricActive',m.active);set('metricFeedback',m.newFeedback);
    set('metricWaitlist',m.waitlist);set('metricDeclined',m.declined);set('metricInactive',m.inactive);
    set('iosCount',m.ios);set('androidCount',m.android);set('navPendingCount',m.applied);set('navFeedbackCount',m.newFeedback);
    const total=Number(m.total||0); set('platformTotal',total+' applicant'+(total===1?'':'s'));
    document.getElementById('iosBar').style.width=(total?Math.round(Number(m.ios||0)/total*100):0)+'%';
    document.getElementById('androidBar').style.width=(total?Math.round(Number(m.android||0)/total*100):0)+'%';
    renderOverview();renderApplications();renderTesters();renderFeedback();
  }

  function renderOverview(){
    const apps=(state.applications||[]).slice(0,5);
    const container=document.getElementById('overviewApplications');
    container.innerHTML=apps.length?apps.map(a=>`<button type="button" class="admin-recent-row" data-open-app="${a.row}"><span class="admin-person-dot">${esc((a.name||'?').slice(0,1).toUpperCase())}</span><span><strong>${esc(a.name)}</strong><small>${esc(a.platform)} · ${relativeDate(a.submittedAt)}</small></span><span class="admin-status-pill ${statusClass(a.status)}">${esc(a.status)}</span></button>`).join(''):'<div class="admin-empty-inline">No applications yet.</div>';
    const fb=(state.feedback||[]).slice(0,5);
    const fbc=document.getElementById('overviewFeedback');
    fbc.innerHTML=fb.length?fb.map(f=>`<button class="admin-feedback-preview" type="button" data-open-feedback="${f.row}"><span class="admin-feedback-icon">${typeIcon(f.type)}</span><span class="admin-feedback-preview-copy"><strong>${esc(f.subject)}</strong><small>${esc(f.name)} · ${esc(f.type)} · ${relativeDate(f.submittedAt)}</small></span><span class="admin-status-pill ${statusClass(f.status)}">${esc(f.status)}</span></button>`).join(''):'<div class="admin-empty-inline">No tester feedback yet.</div>';
  }

  function applicationFiltered(){
    const q=document.getElementById('applicationSearch').value.trim().toLowerCase();
    const status=document.getElementById('applicationStatusFilter').value;
    const platform=document.getElementById('applicationPlatformFilter').value;
    return (state.applications||[]).filter(a=>(!q||(a.name+' '+a.email).toLowerCase().includes(q))&&(!status||a.status===status)&&(!platform||a.platform===platform));
  }
  function renderApplications(){
    const data=applicationFiltered(); const body=document.getElementById('applicationsTableBody');
    body.innerHTML=data.map(a=>`<tr><td><div class="admin-table-person"><span>${esc((a.name||'?').slice(0,1).toUpperCase())}</span><div><strong>${esc(a.name)}</strong><small>${esc(a.email)}</small></div></div></td><td><span class="admin-platform-pill">${esc(a.platform)}</span></td><td>${esc(relativeDate(a.submittedAt))}</td><td><span class="admin-status-pill ${statusClass(a.status)}">${esc(a.status)}</span></td><td>${esc(a.portalAccess||'Not Enabled')}</td><td><button type="button" class="admin-row-button" data-open-app="${a.row}">Review</button></td></tr>`).join('');
    document.getElementById('applicationsEmpty').hidden=!!data.length;
  }

  function testerFiltered(){
    const q=document.getElementById('testerSearch').value.trim().toLowerCase(); const access=document.getElementById('testerAccessFilter').value;
    return (state.testers||[]).filter(t=>(!q||(t.name+' '+t.email).toLowerCase().includes(q))&&(!access||t.accessStatus===access));
  }
  function renderTesters(){
    const data=testerFiltered(); const body=document.getElementById('testersTableBody');
    body.innerHTML=data.map(t=>`<tr><td><div class="admin-table-person"><span>${esc((t.name||'?').slice(0,1).toUpperCase())}</span><div><strong>${esc(t.name)}</strong><small>${esc(t.email)}</small></div></div></td><td><span class="admin-platform-pill">${esc(t.platform)}</span></td><td><span class="admin-status-pill ${t.accessStatus==='Enabled'?'status-active':'status-inactive'}">${esc(t.accessStatus)}</span></td><td>${esc(t.lastLogin?formatDate(t.lastLogin):'Never')}</td><td>${t.mustChangePassword?'Temporary':'Set'}</td><td><button type="button" class="admin-row-button" data-open-tester="${esc(t.email)}">Manage</button></td></tr>`).join('');
    document.getElementById('testersEmpty').hidden=!!data.length;
  }

  function feedbackFiltered(){
    const q=document.getElementById('feedbackSearch').value.trim().toLowerCase(); const status=document.getElementById('feedbackStatusFilter').value; const type=document.getElementById('feedbackTypeFilter').value;
    return (state.feedback||[]).filter(f=>(!q||(f.subject+' '+f.details+' '+f.name+' '+f.email).toLowerCase().includes(q))&&(!status||f.status===status)&&(!type||f.type===type));
  }
  function renderFeedback(){
    const data=feedbackFiltered(); const list=document.getElementById('feedbackList');
    list.innerHTML=data.map(f=>`<button type="button" class="admin-feedback-card" data-open-feedback="${f.row}"><span class="admin-feedback-card-icon">${typeIcon(f.type)}</span><span class="admin-feedback-card-main"><span class="admin-feedback-card-top"><strong>${esc(f.subject)}</strong><span class="admin-status-pill ${statusClass(f.status)}">${esc(f.status)}</span></span><small>${esc(f.type)} · ${esc(f.name)} · ${esc(f.platform)} · ${relativeDate(f.submittedAt)}</small><p>${esc((f.details||'').slice(0,220))}${(f.details||'').length>220?'…':''}</p></span><span class="admin-feedback-arrow">›</span></button>`).join('');
    document.getElementById('feedbackEmpty').hidden=!!data.length;
  }

  function switchView(view){
    activeView=view;
    document.querySelectorAll('.admin-nav-item').forEach(b=>b.classList.toggle('is-active',b.dataset.adminView===view));
    document.querySelectorAll('.admin-view').forEach(p=>p.classList.toggle('is-active',p.dataset.adminPanel===view));
    const titles={overview:'Overview',applications:'Applications',testers:'Testers',feedback:'Feedback'};
    document.getElementById('adminViewTitle').textContent=titles[view]||'Rebatify Admin';
    document.body.classList.remove('admin-nav-open');
    window.scrollTo({top:0,behavior:'smooth'});
  }

  function openDrawer(kicker,title,html){
    document.getElementById('drawerKicker').textContent=kicker;document.getElementById('drawerTitle').textContent=title;document.getElementById('adminDrawerContent').innerHTML=html;
    document.getElementById('adminDrawerBackdrop').hidden=false;const d=document.getElementById('adminDrawer');d.classList.add('is-open');d.setAttribute('aria-hidden','false');
  }
  function closeDrawer(){document.getElementById('adminDrawerBackdrop').hidden=true;const d=document.getElementById('adminDrawer');d.classList.remove('is-open');d.setAttribute('aria-hidden','true');}

  function findApp(row){return (state.applications||[]).find(a=>String(a.row)===String(row));}
  function findFeedback(row){return (state.feedback||[]).find(f=>String(f.row)===String(row));}
  function findTester(email){return (state.testers||[]).find(t=>t.email===email);}

  function openApplication(row){
    const a=findApp(row);if(!a)return;
    openDrawer('Beta Application',a.name,`<div class="admin-detail-stack">
      <div class="admin-detail-status-row"><span class="admin-status-pill ${statusClass(a.status)}">${esc(a.status)}</span><span class="admin-platform-pill">${esc(a.platform)}</span></div>
      <div class="admin-detail-grid"><div><span>Email</span><strong>${esc(a.email)}</strong></div><div><span>Submitted</span><strong>${esc(formatDate(a.submittedAt))}</strong></div><div><span>Terms</span><strong>${esc(a.termsAccepted)}</strong></div><div><span>Portal Access</span><strong>${esc(a.portalAccess||'Not Enabled')}</strong></div><div><span>Last Updated</span><strong>${esc(a.lastUpdated?formatDate(a.lastUpdated):'—')}</strong></div><div><span>Decision Email</span><strong>${esc(a.lastDecisionEmail?formatDate(a.lastDecisionEmail):'—')}</strong></div></div>
      <div><label class="admin-detail-label" for="drawerApplicantNotes">Private admin notes</label><textarea id="drawerApplicantNotes" class="admin-detail-textarea" placeholder="Notes only administrators can see">${esc(a.notes||'')}</textarea><button class="admin-secondary-button admin-save-notes" data-save-app-notes="${a.row}" type="button">Save Notes</button></div>
      <div class="admin-drawer-actions">
        <button class="admin-action-button approve" data-app-action="approve" data-row="${a.row}" type="button">Approve & Send Invite</button>
        <button class="admin-action-button" data-app-action="waitlist" data-row="${a.row}" type="button">Waitlist</button>
        <button class="admin-action-button danger" data-app-action="decline" data-row="${a.row}" type="button">Decline</button>
        <button class="admin-action-button" data-app-action="active" data-row="${a.row}" type="button">Mark Active</button>
        <button class="admin-action-button" data-app-action="resend" data-row="${a.row}" type="button">Resend Portal Invite</button>
        <button class="admin-action-button danger-soft" data-app-action="inactive" data-row="${a.row}" type="button">Disable Access</button>
      </div>
    </div>`);
  }

  function openTester(email){
    const t=findTester(email);if(!t)return;
    const appRecord=(state.applications||[]).find(a=>a.email===email);
    openDrawer('Tester Access',t.name,`<div class="admin-detail-stack"><div class="admin-detail-status-row"><span class="admin-status-pill ${t.accessStatus==='Enabled'?'status-active':'status-inactive'}">${esc(t.accessStatus)}</span><span class="admin-platform-pill">${esc(t.platform)}</span></div><div class="admin-detail-grid"><div><span>Email</span><strong>${esc(t.email)}</strong></div><div><span>Created</span><strong>${esc(formatDate(t.createdAt))}</strong></div><div><span>Last Login</span><strong>${esc(t.lastLogin?formatDate(t.lastLogin):'Never')}</strong></div><div><span>Password</span><strong>${t.mustChangePassword?'Temporary — change required':'Tester-set password'}</strong></div></div><div class="admin-drawer-actions"><button class="admin-action-button approve" data-app-action="resend" data-row="${appRecord?appRecord.row:''}" type="button">Generate New Invite</button><button class="admin-action-button" data-app-action="active" data-row="${appRecord?appRecord.row:''}" type="button">Enable / Mark Active</button><button class="admin-action-button danger-soft" data-app-action="inactive" data-row="${appRecord?appRecord.row:''}" type="button">Disable Access</button></div></div>`);
  }

  function openFeedback(row){
    const f=findFeedback(row);if(!f)return;
    const statuses=['New','Reviewing','Planned','Fixed','Closed','Declined'];
    openDrawer('Tester Feedback',f.subject,`<div class="admin-detail-stack">
      <div class="admin-detail-status-row"><span class="admin-feedback-type-chip">${esc(f.type)}</span><span class="admin-platform-pill">${esc(f.platform)}</span></div>
      <div class="admin-detail-grid"><div><span>Tester</span><strong>${esc(f.name)}</strong><small>${esc(f.email)}</small></div><div><span>Submitted</span><strong>${esc(formatDate(f.submittedAt))}</strong></div><div><span>App Version / Build</span><strong>${esc(f.appVersion||'Not provided')}</strong></div><div><span>Device / OS</span><strong>${esc(f.deviceDetails||'Not provided')}</strong></div><div><span>Page / Feature</span><strong>${esc(f.pageFeature||'Not provided')}</strong></div></div>
      <div class="admin-feedback-detail"><span>Feedback</span><p>${esc(f.details)}</p></div>
      <div class="beta-field"><label for="drawerFeedbackStatus">Status</label><select id="drawerFeedbackStatus" class="admin-detail-select">${statuses.map(s=>`<option${s===f.status?' selected':''}>${s}</option>`).join('')}</select></div>
      <div><label class="admin-detail-label" for="drawerFeedbackNotes">Private admin notes</label><textarea id="drawerFeedbackNotes" class="admin-detail-textarea" placeholder="Internal notes, next steps, reproduction details…">${esc(f.adminNotes||'')}</textarea></div>
      <button class="admin-primary-button" data-save-feedback="${f.row}" type="button">Save Feedback Update</button>
    </div>`);
  }

  async function performAction(task,args,successMessage){
    try{
      const data=await jsonp('adminaction',Object.assign({task},args||{}));
      if(!data||!data.ok){showToast((data&&data.message)||'That action could not be completed.','error');return false;}
      showToast(successMessage||data.message||'Saved.');
      await loadData(true);return true;
    }catch(err){showToast('That action could not be completed. Please try again.','error');return false;}
  }

  async function performPostAction(task,args,successMessage){
    try{
      const params=new URLSearchParams(Object.assign({action:'adminAction',token:sessionToken,task},args||{}));
      await fetch(endpoint,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:params.toString()});
      await new Promise(r=>setTimeout(r,350));
      await loadData(true);
      showToast(successMessage||'Saved.');
      return true;
    }catch(err){showToast('That update could not be completed. Please try again.','error');return false;}
  }

  document.addEventListener('click',async e=>{
    const nav=e.target.closest('[data-admin-view]');if(nav){switchView(nav.dataset.adminView);return;}
    const jump=e.target.closest('[data-jump-view]');if(jump){switchView(jump.dataset.jumpView);return;}
    const appBtn=e.target.closest('[data-open-app]');if(appBtn){openApplication(appBtn.dataset.openApp);return;}
    const testerBtn=e.target.closest('[data-open-tester]');if(testerBtn){openTester(testerBtn.dataset.openTester);return;}
    const feedbackBtn=e.target.closest('[data-open-feedback]');if(feedbackBtn){openFeedback(feedbackBtn.dataset.openFeedback);return;}
    const noteBtn=e.target.closest('[data-save-app-notes]');if(noteBtn){const notes=document.getElementById('drawerApplicantNotes').value;await performPostAction('applicantNotes',{row:noteBtn.dataset.saveAppNotes,notes},'Private notes saved.');return;}
    const fbSave=e.target.closest('[data-save-feedback]');if(fbSave){const status=document.getElementById('drawerFeedbackStatus').value;const notes=document.getElementById('drawerFeedbackNotes').value;if(await performPostAction('feedbackUpdate',{row:fbSave.dataset.saveFeedback,status,notes},'Feedback updated.'))openFeedback(fbSave.dataset.saveFeedback);return;}
    const actionBtn=e.target.closest('[data-app-action]');if(actionBtn){
      const task=actionBtn.dataset.appAction;const row=actionBtn.dataset.row;if(!row){showToast('Could not find the tester application record.','error');return;}
      const confirmation={approve:'Approve this tester and send a new portal invitation?',waitlist:'Move this applicant to the waitlist and notify them?',decline:'Decline this application and notify them?',resend:'Generate a new temporary password and send a fresh portal invitation?',inactive:'Disable this tester’s portal access?',active:'Enable access and mark this tester active?'}[task];
      if(confirmation && !(await confirmAction(confirmation,(task==='decline'||task==='inactive')?'danger':'')))return;
      if(await performAction(task,{row},task==='approve'?'Tester approved and invitation sent.':task==='resend'?'New portal invitation sent.':'Tester record updated.'))closeDrawer();return;
    }
  });

  document.getElementById('adminDrawerClose').addEventListener('click',closeDrawer);
  document.getElementById('adminDrawerBackdrop').addEventListener('click',closeDrawer);
  document.getElementById('adminRefresh').addEventListener('click',()=>loadData());
  document.getElementById('adminMenuToggle').addEventListener('click',()=>document.body.classList.toggle('admin-nav-open'));
  document.getElementById('adminLogout').addEventListener('click',async()=>{try{await jsonp('adminaction',{task:'logout'});}catch(e){}localStorage.removeItem('rebatifyAdminSession');location.replace('admin-login.html');});

  ['applicationSearch','applicationStatusFilter','applicationPlatformFilter'].forEach(id=>document.getElementById(id).addEventListener('input',renderApplications));
  ['testerSearch','testerAccessFilter'].forEach(id=>document.getElementById(id).addEventListener('input',renderTesters));
  ['feedbackSearch','feedbackStatusFilter','feedbackTypeFilter'].forEach(id=>document.getElementById(id).addEventListener('input',renderFeedback));

  const passwordForm=document.getElementById('adminPasswordForm');
  passwordForm.addEventListener('submit',e=>{const p=document.getElementById('adminNewPassword').value;const c=document.getElementById('adminConfirmPassword').value;if(p.length<12||!/[A-Za-z]/.test(p)||!/[0-9]/.test(p)||p!==c){e.preventDefault();showToast('Use at least 12 characters with a letter and a number, and make sure both entries match.','error');}});

  init();
})();
