import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../src/app.js';

test('local test login skips OTP but retains roles, logout and membership checks',async()=>{
  const db=new DatabaseSync(':memory:');
  const baseURL='http://localhost:3012';
  const {app,store}=await createApp({db,baseURL,secret:'test-mode-secret-longer-than-thirty-two-characters',adminEmail:'admin@example.com',sendMail:async()=>assert.fail('must not send mail'),testMode:true});
  const server=app.listen(0,'127.0.0.1');await new Promise((resolve)=>server.once('listening',resolve));
  async function call(path,body,cookie='') {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method:body?'POST':'GET',headers:{Origin:baseURL,'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json().catch(()=>null),cookie:response.headers.getSetCookie().map((c)=>c.split(';')[0]).join('; ')};
  }
  try{
    assert.equal((await call('/event')).data.testMode,true);
    assert.equal((await call('/dev/login',{email:'unknown@example.com'})).status,403);
    const admin=await call('/dev/login',{email:'admin@example.com'});
    assert.equal(admin.status,200);assert.ok(admin.cookie);
    assert.equal((await call('/me',undefined,admin.cookie)).data.isAdmin,true);
    store.saveMembers(Array.from({length:12},(_,i)=>({name:`คน ${i}`,email:`member${i}@example.com`})));
    assert.equal((await call('/dev/accounts')).data.accounts.length,13);
    const member=await call('/dev/login',{email:'member0@example.com'});
    assert.equal((await call('/me',undefined,member.cookie)).data.isAdmin,false);
    assert.equal((await call('/admin/draw',{},member.cookie)).status,403);
    await call('/dev/logout',{},member.cookie);
    assert.equal((await call('/me',undefined,member.cookie)).status,401);
  }finally{server.closeAllConnections();await new Promise((resolve)=>server.close(resolve));db.close();}
});
test('test login cannot be configured on production or non-local origins',async()=>{
  for(const [production,baseURL] of [[true,'https://localhost'],[false,'https://orion.example.com']]) {
    await assert.rejects(()=>createApp({testMode:true,production,baseURL}),/only available on local/);
  }
});
