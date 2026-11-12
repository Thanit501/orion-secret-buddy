const $ = (id) => document.getElementById(id);
let me, roster, saved = false, testMode = false;
function notice(message,error=false) { $('notice').textContent=message; $('notice').classList.toggle('error',error); $('notice').hidden=false; }
async function request(path,body,method=body ? 'POST' : 'GET') {
  const response=await fetch(`/api${path}`,{method,credentials:'same-origin',headers:body ? {'Content-Type':'application/json'} : {},body:body ? JSON.stringify(body) : undefined});
  const data=await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(response.status===429 ? 'มีการขอรหัสหลายครั้ง กรุณารอ 1 นาทีแล้วลองใหม่' : data.error || (path.startsWith('/auth') ? 'ยืนยันไม่สำเร็จ รหัสอาจไม่ถูกต้องหรือหมดอายุ กรุณาลองใหม่' : 'ไม่สามารถดำเนินการได้ กรุณาลองใหม่'));
  return data;
}
async function busy(button,fn) { button.disabled=true; try{await fn();}catch(e){notice(e.message,true);}finally{button.disabled=false;} }
function node(tag,text,className) { const el=document.createElement(tag); if(text)el.textContent=text; if(className)el.className=className; return el; }
async function load() {
  try { me=await request('/me'); }
  catch { $('login').hidden=false; $('dashboard').hidden=true; $('logout').hidden=true; return; }
  $('login').hidden=true; $('dashboard').hidden=false; $('logout').hidden=false;
  $('greeting').textContent=`สวัสดี ${me.member?.name || 'ผู้จัดกิจกรรม'} ✧`;
  $('draw-status').textContent=me.drawn ? 'จับบัดดี้แล้ว · เก็บเป็นความลับนะ' : 'กำลังเตรียมความเซอร์ไพรส์';
  $('member-panel').hidden=!me.member;
  if(me.member) {
    $('likes').value=me.member.likes; $('avoids').value=me.member.avoids;
    $('reveal').disabled=!me.drawn;
    if(!me.drawn) $('gift-description').textContent='ผู้จัดยังไม่ได้จับบัดดี้ ระหว่างนี้มาเขียนคำใบ้กันก่อน';
    else $('gift-description').textContent='เปิดการ์ด แล้วเริ่มเตรียมเซอร์ไพรส์ให้เพื่อนในทีม';
  }
  $('admin-panel').hidden=!me.isAdmin;
  if(me.isAdmin) await loadRoster();
}
async function loadRoster() {
  const data=await request('/admin/members');
  roster=data.members; saved=roster.length===12;
  $('roster').replaceChildren();
  $('member-count').textContent=`${roster.length} / 12 คน`;
  for(let i=0;i<12;i++) {
    const row=node('div',null,'roster-row');
    const name=node('input'); name.value=roster[i]?.name || ''; name.placeholder=`ชื่อสมาชิก ${i+1}`; name.required=true; name.maxLength=80; name.disabled=data.drawn; name.setAttribute('aria-label',`ชื่อสมาชิก ${i+1}`); name.dataset.field='name';
    const email=node('input'); email.type='email'; email.value=roster[i]?.email || ''; email.placeholder='name@company.com'; email.required=true; email.maxLength=254; email.disabled=data.drawn; email.setAttribute('aria-label',`อีเมลสมาชิก ${i+1}`); email.dataset.field='email';
    row.append(name,email);
    if(data.drawn) row.append(node('span',roster[i]?.opened_at ? '✦ เปิดการ์ดแล้ว' : '○ ยังไม่เปิดการ์ด','status'));
    $('roster').append(row);
  }
  $('save-roster').hidden=data.drawn; $('draw').hidden=data.drawn; $('draw').disabled=!saved;
}
$('email-form').addEventListener('submit',(e)=>{e.preventDefault();busy(e.submitter,async()=>{
  await request('/auth/email-otp/send-verification-otp',{email:$('email').value.trim().toLowerCase(),type:'sign-in'});
  $('email-form').hidden=true; $('otp-form').hidden=false;
  $('otp-hint').textContent=`หาก ${$('email').value} อยู่ในรายชื่อทีม ระบบจะส่งรหัสให้ ใช้ได้ 5 นาที`;
  $('otp').focus();
});});
$('otp-form').addEventListener('submit',(e)=>{e.preventDefault();busy(e.submitter,async()=>{
  await request('/auth/sign-in/email-otp',{email:$('email').value.trim().toLowerCase(),otp:$('otp').value});
  $('notice').hidden=true; await load();
});});
$('back').onclick=()=>{$('email-form').hidden=false;$('otp-form').hidden=true;$('otp').value='';$('email').focus();};
$('logout').onclick=()=>busy($('logout'),async()=>{if(testMode)await request('/dev/logout',{});await request('/auth/sign-out',{});location.reload();});
$('wishlist-form').addEventListener('submit',(e)=>{e.preventDefault();busy(e.submitter,async()=>{await request('/wishlist',{likes:$('likes').value,avoids:$('avoids').value},'PUT');notice('บันทึกคำใบ้แล้ว บัดดี้ของคุณจะเห็นข้อความนี้ ✧');});});
$('reveal').onclick=()=>busy($('reveal'),async()=>{
  const {recipient}=await request('/reveal',{});
  $('recipient-name').textContent=recipient.name;
  $('recipient-likes').textContent=recipient.likes || 'ยังไม่ได้ใส่คำใบ้ ลองเลือกสิ่งที่คิดว่าเขาจะชอบได้เลย';
  $('recipient-avoids').textContent=recipient.avoids || 'ไม่ได้ระบุ';
  $('gift-heading').textContent='คนที่คุณจะส่งต่อรอยยิ้มให้คือ'; $('gift-description').hidden=true;
  $('reveal').hidden=true;$('recipient').hidden=false;
});
$('roster').addEventListener('input',()=>{saved=false;$('draw').disabled=true;});
$('roster-form').addEventListener('submit',(e)=>{e.preventDefault();busy(e.submitter,async()=>{
  const members=[...document.querySelectorAll('.roster-row')].map((row)=>({name:row.querySelector('[data-field=name]').value,email:row.querySelector('[data-field=email]').value}));
  await request('/admin/members',{members},'PUT'); await load();notice('บันทึกสมาชิกครบแล้ว ให้สมาชิกเข้ามาเขียนคำใบ้ก่อนสุ่มได้เลย');
});});
$('draw').onclick=()=>{if(saved)$('draw-dialog').showModal();};
$('cancel-draw').onclick=()=>$('draw-dialog').close();
$('confirm-draw').onclick=()=>busy($('confirm-draw'),async()=>{
  await request('/admin/draw',{});$('draw-dialog').close();await load();notice('สุ่มและล็อกบัดดี้เรียบร้อย! สมาชิกเข้าสู่ระบบเพื่อเปิดการ์ดได้เลย ✦');
});
async function init() {
  const event=await request('/event');
  testMode=event.testMode;
  if(testMode) {
    const banner=node('div','โหมดทดสอบในเครื่อง · เลือกบัญชีเพื่อเข้าใช้งานได้ทันที ไม่ต้องใช้ OTP','notice');
    $('login').before(banner);
    const {accounts}=await request('/dev/accounts');
    const form=node('form');
    const label=node('label','เลือกบัญชีที่ต้องการทดสอบ');label.htmlFor='test-account';
    const select=node('select');select.id='test-account';
    for(const account of accounts) {const option=node('option',`${account.name} · ${account.email}`);option.value=account.email;select.append(option);}
    const button=node('button','เข้าใช้งานทดสอบ ↗','primary');button.type='submit';
    form.append(label,select,button);
    form.addEventListener('submit',(e)=>{e.preventDefault();busy(button,async()=>{await request('/dev/login',{email:select.value});$('notice').hidden=true;await load();});});
    $('email-form').before(form);$('email-form').hidden=true;
    document.querySelector('.login-form > .muted').textContent='เริ่มจากผู้จัดเพื่อเพิ่มรายชื่อ แล้วออกจากระบบเพื่อเลือกสมาชิกคนอื่น';
  }
  await load();
}
init().catch((e)=>notice(e.message,true));
