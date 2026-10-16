const express = require('express');
const cookieSession = require('cookie-session');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { ready, all, get, run, ON_WORKERS } = require('./db');
const status = require('./status');
const { originTrail } = require('./crumbs');
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
    // Site managers see the plant on the projects assigned to them.
    if (req.user && req.user.role === 'driver' && req.user.employee_type === 'site_manager') {
      req.user.projects = (await all('SELECT code FROM projects WHERE manager_id = ?', req.user.id)).map((p) => p.code);
    }
    res.locals.user = req.user;
    // Managers see the admin menus and pages read-only: isAdmin shows the pages, canEdit the buttons and forms.
    const manager = !!(req.user && req.user.role === 'driver' && req.user.employee_type === 'manager');
    res.locals.canEdit = !!(req.user && req.user.role === 'admin');
    res.locals.isAdmin = res.locals.canEdit || manager;
    res.locals.isManager = manager;
    res.locals.flash = req.session.flash || null;
    if (req.session.flash) req.session.flash = null;
    res.locals.path = req.path;
    res.locals.today = status.isoDate();
    Object.assign(res.locals, { escapeHtml, ukDate: status.ukDate, ukDateTime: status.ukDateTime, money, num, fmtHours: status.fmtHours, FUEL_LABELS, SEVERITY_LABELS, pill, userLabel });
    req.flash = (type, msg) => { req.session.flash = { type, msg }; };
    // Breadcrumb for the page this one was opened from (see src/crumbs.js).
    res.locals.origin = req.user && req.method === 'GET' && req.query.from ? await originTrail(String(req.query.from)) : null;
    // Managers can't change anything except their own password.
    if (manager && !['GET', 'HEAD'].includes(req.method) && !['/logout', '/account/password'].includes(req.path)) {
      return res.status(403).render('error', { title: 'View only', message: 'Managers can view everything but not make changes.' });
    }
    next();
  });

  // One-off data job: create employees from the names on the fuel cards (see routes/users.js).
  app.use(async (req, res, next) => {
    try { await require('./routes/users').employeesFromCardsOnce(); } catch (err) { console.error('Employees from fuel cards:', err); }
    next();
  });
  app.use(require('./routes/auth'));
  app.use((req, res, next) => (req.user ? next() : res.redirect('/login')));

  app.use(require('./routes/home'));
  app.use(require('./routes/checks'));
  app.use(require('./routes/fuel'));
  app.use(require('./routes/fuel-cards').router);
  app.use(require('./documents').router);
  app.use(require('./routes/defects'));
  app.use(require('./routes/plant'));
  app.use(require('./routes/vehicles'));
  app.use(require('./routes/users'));
  app.use(require('./routes/projects'));
  app.use(require('./routes/reports'));
  app.use(require('./routes/training'));
  app.use(require('./routes/admin'));

  app.use((req, res) => res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // Bad ids or numbers in the address or a form (e.g. /plant/abc) are the visitor's mistake, not a crash.
    if (['22P02', '22003', '22007', '22008'].includes(err.code)) {
      return res.status(req.method === 'GET' ? 404 : 400).render('error', { title: 'Not found', message: req.method === 'GET' ? 'That page does not exist.' : 'Some of the details entered were not valid. Please go back and check the form.' });
    }
    if (!err.expose && err.code !== 'LIMIT_FILE_SIZE') console.error(err);
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large (15 MB maximum).' : (err.expose ? err.message : 'Something went wrong.');
    res.status(err.status || 500).render('error', { title: 'Error', message });
  });
  return app;
}

module.exports = { createApp };
