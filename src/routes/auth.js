const express = require('express');
const bcrypt = require('bcryptjs');
const { get, run } = require('../db');

const router = express.Router();

router.get('/login', async (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'Sign in', error: null, email: '' });
});

router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim();
  const user = await get('SELECT * FROM users WHERE lower(email) = lower(?) AND active = 1', email);
  if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password_hash)) {
    return res.status(401).render('login', { title: 'Sign in', error: 'Email or password is incorrect.', email });
  }
  req.session.uid = user.id;
  res.redirect('/');
});

router.post('/logout', async (req, res) => {
  req.session = null;
  res.redirect('/login');
});

router.get('/account', async (req, res) => {
  if (!req.user) return res.redirect('/login');
  res.render('account', { title: 'My account' });
});

router.post('/account/password', async (req, res) => {
  if (!req.user) return res.redirect('/login');
  const row = await get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
  const { current, password, confirm } = req.body;
  if (!bcrypt.compareSync(String(current || ''), row.password_hash)) {
    req.flash('error', 'Your current password is incorrect.');
  } else if (!password || password.length < 8) {
    req.flash('error', 'New password must be at least 8 characters.');
  } else if (password !== confirm) {
    req.flash('error', 'The new passwords do not match.');
  } else {
    await run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(password, 10), req.user.id);
    req.flash('success', 'Password changed.');
  }
  res.redirect('/account');
});

module.exports = router;
