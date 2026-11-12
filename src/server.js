import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { createApp } from './app.js';

const production = process.env.NODE_ENV === 'production';
const testMode = process.env.DEV_SKIP_OTP === 'true';
if (testMode && production) throw new Error('DEV_SKIP_OTP must be disabled in production');
const port = Number(process.env.PORT || 3012);
const baseURL = process.env.APP_URL || `http://localhost:${port}`;
const secret = process.env.BETTER_AUTH_SECRET || (production ? '' : randomBytes(32).toString('hex'));
const adminEmail = process.env.ADMIN_EMAIL;
if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new Error('Set ADMIN_EMAIL in .env');
if (secret.length < 32) throw new Error('Set BETTER_AUTH_SECRET to at least 32 characters');
if (production && !baseURL.startsWith('https://')) throw new Error('Production APP_URL must use HTTPS');
const dbPath = resolve(process.env.DATABASE_PATH || './data/orion.sqlite');
mkdirSync(dirname(dbPath),{ recursive:true, mode:0o700 });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode=WAL;');
const mode = process.env.MAIL_MODE || 'smtp';
if (!['smtp','outbox'].includes(mode)) throw new Error('MAIL_MODE must be smtp or outbox');
if (production && mode !== 'smtp') throw new Error('Production requires MAIL_MODE=smtp');
if (mode === 'smtp' && (!process.env.SMTP_HOST || !process.env.MAIL_FROM)) throw new Error('Set SMTP_HOST and MAIL_FROM');
const transport = mode === 'smtp' ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true', requireTLS: process.env.SMTP_SECURE !== 'true',
  auth: process.env.SMTP_USER ? {user:process.env.SMTP_USER,pass:process.env.SMTP_PASS} : undefined,
}) : null;
const sendMail = async ({email,otp}) => {
  const message = {from:process.env.MAIL_FROM,to:email,subject:'รหัสเข้า ORION Secret Buddy',
    text:`รหัสยืนยันของคุณคือ ${otp}\nใช้ได้ 5 นาที ห้ามแชร์รหัสนี้กับผู้อื่น\nORION Secret Buddy`};
  if (transport) await transport.sendMail(message);
  else {
    const folder = resolve(dirname(dbPath),'outbox');
    mkdirSync(folder,{recursive:true,mode:0o700});
    writeFileSync(resolve(folder,`${Date.now()}-${randomUUID()}.json`),JSON.stringify(message,null,2),{mode:0o600});
    console.log('Local test email written to data/outbox/ (not delivered).');
  }
};
const { app } = await createApp({db,baseURL,secret,adminEmail,sendMail,production,testMode});
const server = app.listen(port,process.env.HOST || '127.0.0.1',() => console.log(`ORION Secret Buddy: ${baseURL} (${mode === 'outbox' ? 'LOCAL OUTBOX — no email delivery' : 'SMTP'})`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => server.close(() => {db.close();process.exit(0);}));
