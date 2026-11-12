import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app.js';

test('email OTP, roster authorization, isolated results, no redraw and no identity spoofing',async()=>{
  const db=new DatabaseSync(':memory:');
  const mailbox=new Map();
  const baseURL='http://localhost:3012';
  const {app,store}=await createApp({db,baseURL,secret:'orion-test-secret-which-is-longer-than-32-characters',adminEmail:'admin@example.com',sendMail:async({email,otp})=>mailbox.set(email,otp)});
  const server=app.listen(0,'127.0.0.1');
  await new Promise((resolve)=>server.once('listening',resolve));
  const endpoint=`http://127.0.0.1:${server.address().port}`;
  async function call(path,body,cookie='',method=body?'POST':'GET',origin=baseURL) {
    const response=await fetch(`${endpoint}/api${path}`,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie},body:body?JSON.stringify(body):undefined});
    return {status:response.status,body:await response.json().catch(()=>null),cookie:response.headers.getSetCookie().map((c)=>c.split(';')[0]).join('; ')};
  }
  async function login(email) {
    assert.equal((await call('/auth/email-otp/send-verification-otp',{email,type:'sign-in'})).status,200);
    assert.ok(mailbox.has(email));
    const result=await call('/auth/sign-in/email-otp',{email,otp:mailbox.get(email)});
    assert.equal(result.status,200,JSON.stringify(result.body));
    assert.ok(result.cookie);
    return result.cookie;
  }
  try{
    assert.equal((await call('/dev/accounts')).status,404);
    assert.equal((await call('/dev/login',{email:'admin@example.com'})).status,404);
    assert.equal((await call('/me')).status,401);
    assert.equal((await call('/reveal',{email:'admin@example.com'})).status,401);
    await call('/auth/email-otp/send-verification-otp',{email:'outsider@example.com',type:'sign-in'});
    assert.equal(mailbox.has('outsider@example.com'),false);
    const admin=await login('admin@example.com');
    const rows=Array.from({length:12},(_,i)=>({name:`คนที่ ${i}`,email:`member${i}@example.com`}));
    assert.equal((await call('/admin/members',{members:rows},admin,'PUT')).status,200);
    const member=await login(rows[0].email);
    assert.equal((await call('/admin/members',undefined,member)).status,403);
    assert.equal((await call('/admin/draw',{},member)).status,403);
    assert.equal((await call('/wishlist',{likes:'กาแฟ',avoids:'ถั่ว'},member,'PUT','https://evil.example')).status,403);
    assert.equal((await call('/reveal',{},member)).status,409);
    assert.equal((await call('/admin/draw',{},admin)).status,200);
    assert.equal((await call('/admin/draw',{},admin)).status,409);
    const result=await call('/reveal',{},member);
    assert.equal(result.status,200);
    assert.notEqual(result.body.recipient.name,rows[0].name);
    assert.deepEqual((await call('/reveal',{email:rows[1].email},member)).body,result.body);
    const roster=await call('/admin/members',undefined,admin);
    assert.equal(roster.body.members.filter((m)=>m.opened_at).length,1);
    assert.ok(roster.body.members.every((m)=>!('recipient' in m)));
    const otp=mailbox.get(rows[0].email);
    assert.notEqual((await call('/auth/sign-in/email-otp',{email:rows[0].email,otp})).status,200);
    assert.equal(store.list().length,12);
  }finally{
    server.closeAllConnections();await new Promise((resolve)=>server.close(resolve));db.close();
  }
});
