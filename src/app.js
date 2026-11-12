import express from 'express';
import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { getMigrations } from 'better-auth/db/migration';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createStore, normalizeEmail, AppError } from './store.js';

export async function createApp({ db, baseURL, secret, adminEmail, sendMail, production = false, testMode = false }) {
  if (testMode && (production || !['localhost','127.0.0.1','[::1]'].includes(new URL(baseURL).hostname))) throw new Error('Test login is only available on local development servers');
  const origin = new URL(baseURL).origin;
  adminEmail = normalizeEmail(adminEmail);
  const store = createStore(db);
  const eligible = (email) => normalizeEmail(email) === adminEmail || Boolean(store.member(email));
  const options = {
    appName: 'ORION Secret Buddy', baseURL, secret, database: db,
    trustedOrigins: [origin],
    session: { expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: production },
    // Office members may share one public IP; allow the whole team to sign in.
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 120,
      customRules: { '/email-otp/send-verification-otp': { window: 60, max: 30 }, '/sign-in/email-otp': { window: 60, max: 30 } } },
    databaseHooks: { user: { create: { before: async (user) => eligible(user.email) ? { data: user } : false } } },
    plugins: [emailOTP({
      otpLength: 6, expiresIn: 300, allowedAttempts: 5, storeOTP: 'hashed',
      async sendVerificationOTP({ email, otp, type }) {
        // No emails sent to addresses outside the roster; response stays generic.
        if (type !== 'sign-in' || !eligible(email)) return;
        await sendMail({ email, otp });
      },
    })],
  };
  const { runMigrations } = await getMigrations(options);
  await runMigrations();
  const auth = betterAuth(options);
  const app = express();
  const testSessions = new Map();
  const testCookie = (req) => req.headers.cookie?.split(';').map((c)=>c.trim()).find((c)=>c.startsWith('orion-test='))?.slice(11);
  const localRequest = (req) => ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  app.disable('x-powered-by');
  app.use((req,res,next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
    if (req.path.startsWith('/api/')) res.set('Cache-Control','no-store');
    next();
  });
  // Offer only the auth endpoints needed by this application.
  const authPaths = new Set(['/email-otp/send-verification-otp','/sign-in/email-otp','/get-session','/sign-out','/ok']);
  app.use('/api/auth',(req,res,next) => {
    if (!authPaths.has(req.path)) return res.sendStatus(404);
    next();
  });
  app.all('/api/auth/*splat',toNodeHandler(auth));
  app.use(express.json({ limit: '24kb' }));
  if (testMode) {
    app.use('/api/dev',(req,res,next)=> {
      if (!localRequest(req)) return res.sendStatus(403);
      if (req.method !== 'GET' && req.headers.origin !== origin) return res.sendStatus(403);
      next();
    });
    app.get('/api/dev/accounts',(_req,res)=>res.json({accounts:[{name:'ผู้จัดกิจกรรม',email:adminEmail},...store.list().filter((m)=>m.email!==adminEmail).map(({name,email})=>({name,email}))]}));
    app.post('/api/dev/login',(req,res)=> {
      const email=normalizeEmail(req.body.email);
      if (!eligible(email)) return res.status(403).json({error:'เลือกบัญชีที่อยู่ในรายชื่อทดสอบ'});
      for (const [key,value] of testSessions) if(value.expires<Date.now())testSessions.delete(key);
      const token=randomBytes(32).toString('hex');
      testSessions.set(token,{email,expires:Date.now()+3600000});
      res.cookie('orion-test',token,{httpOnly:true,sameSite:'strict',maxAge:3600000,path:'/'}).json({ok:true});
    });
    app.post('/api/dev/logout',(req,res)=> {testSessions.delete(testCookie(req));res.clearCookie('orion-test',{path:'/'}).json({ok:true});});
  }
  // Keep disabled test routes inaccessible, rather than passing them to auth.
  app.use('/api/dev',(_req,res)=>res.sendStatus(404));
  app.get('/api/event',(_req,res) => res.json({ team: 'ORION', count: 12, budget: 300,
    giftDate: '2026-11-27', time: '09.30–11.00 น.', room: 'ห้อง 4', drawn: Boolean(store.event().drawn_at), testMode }));
  app.use('/api',async (req,res,next) => {
    if (!['GET','HEAD'].includes(req.method) && req.headers.origin !== origin) return res.status(403).json({ error: 'คำขอไม่ถูกต้อง กรุณาเปิดเว็บนี้โดยตรง' });
    const testSession = testMode && localRequest(req) ? testSessions.get(testCookie(req)) : null;
    if (testSession?.expires > Date.now()) req.email=testSession.email;
    else {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session?.user?.emailVerified) return res.status(401).json({ error: 'กรุณายืนยันอีเมลก่อน' });
      req.email = normalizeEmail(session.user.email);
    }
    req.isAdmin = req.email === adminEmail;
    if (!eligible(req.email)) return res.status(403).json({ error: 'อีเมลนี้ไม่อยู่ในรายชื่อทีม ORION' });
    next();
  });
  app.get('/api/me',(req,res) => {
    const member = store.member(req.email);
    res.json({ email: req.email, isAdmin: req.isAdmin, member: member ? {
      name: member.name, likes: member.likes, avoids: member.avoids, opened: Boolean(member.opened_at),
    } : null, drawn: Boolean(store.event().drawn_at) });
  });
  app.put('/api/wishlist',(req,res) => { store.wishlist(req.email,req.body.likes,req.body.avoids); res.json({ ok:true }); });
  app.post('/api/reveal',(req,res) => res.json({ recipient: store.reveal(req.email) }));
  app.use('/api/admin',(req,res,next) => req.isAdmin ? next() : res.status(403).json({ error: 'เฉพาะผู้จัดกิจกรรม' }));
  app.get('/api/admin/members',(_req,res) => res.json({ members: store.list(), drawn: Boolean(store.event().drawn_at) }));
  app.put('/api/admin/members',(req,res) => { store.saveMembers(req.body.members); res.json({ ok:true }); });
  app.post('/api/admin/draw',(_req,res) => { store.draw(); res.json({ ok:true }); });
  app.use('/api',(_req,res) => res.sendStatus(404));
  app.use(express.static(fileURLToPath(new URL('../public',import.meta.url))));
  app.use((error,_req,res,_next) => {
    if (!(error instanceof AppError)) console.error('Request failed:',error.name);
    res.status(error.status ?? 500).json({ error: error instanceof AppError ? error.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  });
  return { app, store, auth };
}
