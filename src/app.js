const express = require('express');
const cookieSession = require('cookie-session');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { ready, get, run, ON_WORKERS } = require('./db');
const status = require('./status');
const { userLabel } = require('./categories');
const views = require('./views');

async function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  // Keep a generated secret in the database so restarts and redeploys don't sign everyone out.
  await run("INSERT INTO settings (key, value) VALUES ('session_secret', ?) ON CONFLICT (key) DO NOTHING", crypto.randomBytes(32).toString('hex'));
  return (await get("SELECT value FROM settings WHERE key = 'session_secret'")).value;
}

// First run: create an admin account so someone can sign in.
async function ensureAdmin() {
  const { n } = await get('SELECT COUNT(*) AS n FROM users');
  if (n > 0) return;
  const email = process.env.ADMIN_EMAIL || 'admin@marley.local';
  const password = process.env.ADMIN_PASSWORD || 'changeme';
  await run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    'Administrator', email, bcrypt.hashSync(password, 10), 'admin');
  console.log(`Created first admin account: ${email}${process.env.ADMIN_PASSWORD ? '' : ' / changeme'}  (change this password after signing in)`);
}

const money = (n) => (n == null ? '—' : '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const num = (n, dp = 0) => (n == null || n === '' ? '—' : Number(n).toLocaleString('en-GB', { maximumFractionDigits: dp }));
const FUEL_LABELS = { diesel: 'Diesel', unleaded: 'Unleaded', adblue: 'AdBlue' };
const SEVERITY_LABELS = { minor: 'Minor', major: 'Major', unsafe: 'Unsafe – do not use' };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pill = (s) => `<span class="pill ${s.level}">${escapeHtml(s.text)}</span>`;

async function createApp() {
  await ready;
  await ensureAdmin();
  const secret = await sessionSecret();
  const app = express();
  // Behind Cloudflare's proxy, which says whether the visitor used HTTPS.
  app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
  app.disable('x-powered-by');

  // On Cloudflare the files in public/ are served before requests reach the app.
  if (!ON_WORKERS) app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', index: false }));
  // Templates are pre-built (scripts/build-views.js) because Cloudflare Workers can't compile them.
  app.use((req, res, next) => {
    res.render = (name, locals) => {
      try {
        res.send(views.render(name, { ...app.locals, ...res.locals, ...locals }));
      } catch (err) {
        next(err);
      }
    };
    next();
  });
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieSession({
    name: 'marley_session',
    keys: [secret],
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
  }));

  app.use(async (req, res, next) => {
    const uid = req.session && req.session.uid;
    req.user = uid ? await get('SELECT id, name, email, role, employee_type, job_title FROM users WHERE id = ? AND active = 1', uid) : null;
    res.locals.user = req.user;
    res.locals.isAdmin = !!(req.user && req.user.role === 'admin');
    res.locals.flash = req.session.flash || null;
    if (req.session.flash) req.session.flash = null;
    res.locals.path = req.path;
    res.locals.today = status.isoDate();
    Object.assign(res.locals, { ukDate: status.ukDate, ukDateTime: status.ukDateTime, money, num, fmtHours: status.fmtHours, FUEL_LABELS, SEVERITY_LABELS, pill, userLabel });
    req.flash = (type, msg) => { req.session.flash = { type, msg }; };
    next();
  });

  app.use(require('./routes/auth'));
  app.use((req, res, next) => (req.user ? next() : res.redirect('/login')));

  app.use(require('./routes/home'));
  app.use(require('./routes/checks'));
  app.use(require('./routes/fuel'));
  app.use(require('./routes/fuel-cards').router);
  app.use(require('./routes/defects'));
  app.use(require('./routes/plant'));
  app.use(require('./routes/vehicles'));
  app.use(require('./routes/users'));
  app.use(require('./routes/projects'));
  app.use(require('./routes/admin'));

  app.use((req, res) => res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (!err.expose && err.code !== 'LIMIT_FILE_SIZE') console.error(err);
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large (15 MB maximum).' : (err.expose ? err.message : 'Something went wrong.');
    res.status(err.status || 500).render('error', { title: 'Error', message });
  });
  return app;
}

module.exports = { createApp };
