import { randomInt } from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();

// Rejection-sampled Fisher–Yates: every valid assignment is equally likely.
export function drawPairs(ids) {
  if (ids.length < 2 || new Set(ids).size !== ids.length) throw new AppError('ต้องมีสมาชิกอย่างน้อย 2 คนและไม่ซ้ำกัน');
  let recipients;
  do {
    recipients = [...ids];
    for (let i = recipients.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [recipients[i], recipients[j]] = [recipients[j], recipients[i]];
    }
  } while (recipients.some((id, i) => id === ids[i]));
  return ids.map((id, i) => ({ giver: id, recipient: recipients[i] }));
}

export function createStore(db) {
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS orion_event (id INTEGER PRIMARY KEY CHECK(id=1), drawn_at TEXT);
    INSERT OR IGNORE INTO orion_event(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS orion_members (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      likes TEXT NOT NULL DEFAULT '', avoids TEXT NOT NULL DEFAULT '', opened_at TEXT);
    CREATE TABLE IF NOT EXISTS orion_pairs (
      giver INTEGER PRIMARY KEY REFERENCES orion_members(id),
      recipient INTEGER NOT NULL UNIQUE REFERENCES orion_members(id), CHECK(giver != recipient));`);
  const event = () => db.prepare('SELECT drawn_at FROM orion_event WHERE id=1').get();
  const member = (email) => db.prepare('SELECT * FROM orion_members WHERE email=?').get(normalizeEmail(email));
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return {
    event, member,
    list: () => db.prepare('SELECT id,name,email,opened_at FROM orion_members ORDER BY id').all(),
    saveMembers(rows) {
      if (!Array.isArray(rows) || rows.length !== 12) throw new AppError('กรุณาใส่สมาชิกให้ครบ 12 คน');
      const clean = rows.map((m) => ({name: String(m?.name ?? '').trim(), email: normalizeEmail(m?.email)}));
      if (clean.some((m) => !m.name || m.name.length > 80 || m.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email))) throw new AppError('ตรวจสอบชื่อและอีเมลของสมาชิกทุกคน');
      if (new Set(clean.map((m) => m.email)).size !== 12) throw new AppError('อีเมลสมาชิกต้องไม่ซ้ำกัน');
      return transaction(() => {
        if (event().drawn_at) throw new AppError('จับบัดดี้แล้ว ไม่สามารถเปลี่ยนรายชื่อได้', 409);
        // Preserve existing wishlists when an organizer edits the roster.
        const old = new Map(db.prepare('SELECT * FROM orion_members').all().map((m) => [m.email,m]));
        db.exec('DELETE FROM orion_members');
        const insert = db.prepare('INSERT INTO orion_members(name,email,likes,avoids) VALUES(?,?,?,?)');
        for (const m of clean) insert.run(m.name,m.email,old.get(m.email)?.likes ?? '',old.get(m.email)?.avoids ?? '');
      });
    },
    wishlist(email, likes, avoids) {
      if (typeof likes !== 'string' || typeof avoids !== 'string' || likes.length > 500 || avoids.length > 500) throw new AppError('ข้อความแต่ละช่องยาวได้ไม่เกิน 500 ตัวอักษร');
      const result = db.prepare('UPDATE orion_members SET likes=?,avoids=? WHERE email=?').run(likes.trim(),avoids.trim(),normalizeEmail(email));
      if (!result.changes) throw new AppError('ไม่พบสมาชิกในทีม',403);
    },
    draw() {
      return transaction(() => {
        if (event().drawn_at) throw new AppError('จับบัดดี้ไปแล้ว ผลเดิมถูกล็อกไว้',409);
        const ids = db.prepare('SELECT id FROM orion_members ORDER BY id').all().map((m) => m.id);
        if (ids.length !== 12) throw new AppError('ต้องมีสมาชิกครบ 12 คนก่อนจับบัดดี้');
        const insert = db.prepare('INSERT INTO orion_pairs(giver,recipient) VALUES(?,?)');
        for (const pair of drawPairs(ids)) insert.run(pair.giver,pair.recipient);
        db.prepare('UPDATE orion_event SET drawn_at=? WHERE id=1').run(new Date().toISOString());
      });
    },
    reveal(email) {
      return transaction(() => {
        const giver = member(email);
        if (!giver) throw new AppError('ไม่พบสมาชิกในทีม',403);
        const recipient = db.prepare(`SELECT m.name,m.likes,m.avoids FROM orion_pairs p
          JOIN orion_members m ON m.id=p.recipient WHERE p.giver=?`).get(giver.id);
        if (!recipient) throw new AppError('ผู้จัดยังไม่ได้จับบัดดี้',409);
        db.prepare('UPDATE orion_members SET opened_at=COALESCE(opened_at,?) WHERE id=?').run(new Date().toISOString(),giver.id);
        return recipient;
      });
    },
  };
}
