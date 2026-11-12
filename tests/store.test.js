import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createStore, drawPairs } from '../src/store.js';
const rows=Array.from({length:12},(_,i)=>({name:`สมาชิก ${i+1}`,email:`member${i+1}@example.com`}));

test('draw produces one recipient per giver, no self matches, for 1000 draws',()=>{
  const ids=rows.map((_,i)=>i);
  for(let i=0;i<1000;i++) {
    const pairs=drawPairs(ids);
    assert.equal(new Set(pairs.map((p)=>p.recipient)).size,12);
    assert.ok(pairs.every((p)=>p.giver!==p.recipient));
  }
});
test('draw is locked, roster immutable, reveals stable and expose only recipient profile',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    const store=createStore(db);
    store.saveMembers(rows);
    store.draw();
    assert.throws(()=>store.draw(),/จับบัดดี้ไปแล้ว/);
    assert.throws(()=>store.saveMembers(rows),/ไม่สามารถเปลี่ยนรายชื่อ/);
    const revealed=rows.map((m)=>store.reveal(m.email));
    assert.equal(new Set(revealed.map((m)=>m.name)).size,12);
    revealed.forEach((recipient,i)=>{
      assert.notEqual(recipient.name,rows[i].name);
      assert.deepEqual(Object.keys(recipient).sort(),['avoids','likes','name']);
      assert.deepEqual(store.reveal(rows[i].email),recipient);
    });
    assert.ok(store.list().every((m)=>m.opened_at));
    assert.throws(()=>store.reveal('outsider@example.com'),/ไม่พบสมาชิก/);
  }finally{db.close();}
});
test('roster validates all members, rejects duplicate email regardless of case, preserves wishlists',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    const store=createStore(db);
    assert.throws(()=>store.draw(),/ครบ 12/);
    assert.throws(()=>store.saveMembers(rows.slice(1)),/ครบ 12/);
    assert.throws(()=>store.saveMembers(rows.map((m,i)=>i===1?{...m,email:rows[0].email.toUpperCase()}:m)),/ไม่ซ้ำ/);
    store.saveMembers(rows);
    store.wishlist(rows[0].email,'กาแฟ','ไม่ทานถั่ว');
    store.saveMembers([...rows].reverse());
    assert.equal(store.member(rows[0].email).likes,'กาแฟ');
    assert.throws(()=>store.wishlist(rows[0].email,'a'.repeat(501),''),/500/);
    assert.throws(()=>store.wishlist('outsider@example.com','',''),/ไม่พบสมาชิก/);
    assert.throws(()=>store.reveal(rows[0].email),/ยังไม่ได้จับ/);
  }finally{db.close();}
});
