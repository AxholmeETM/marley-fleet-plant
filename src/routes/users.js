const express = require('express');
const bcrypt = require('bcryptjs');
const { all, get, run } = require('../db');
const { requireAdmin, UserError, text } = require('../auth');

const router = express.Router();
router.use('/users', requireAdmin);

router.get('/users', (req, res) => {
  const users = all(`SELECT u.*, (SELECT GROUP_CONCAT(reg, ', ') FROM vehicles v WHERE v.driver_id = u.id AND v.active = 1) AS vehicles
    FROM users u ORDER BY u.active DESC, u.name`);
  res.render('users', { title: 'Users', users });
});

router.get('/users/new', (req, res) => res.render('user-form', { title: 'Add user', item: { role: 'driver', active: 1 } }));

function readUser(body, isNew) {
  const name = text(body.name);
  const email = text(body.email);
  if (!name || !email) throw new UserError('Name and email are required.');
  if (isNew && (!body.password || body.password.length < 8)) throw new UserError('Password must be at least 8 characters.');
  if (!isNew && body.password && body.password.length < 8) throw new UserError('Password must be at least 8 characters.');
  return { name, email, phone: text(body.phone), role: body.role === 'admin' ? 'admin' : 'driver', active: body.active === '0' ? 0 : 1 };
}

router.post('/users', (req, res) => {
  const u = readUser(req.body, true);
  try {
    run('INSERT INTO users (name, email, phone, role, active, password_hash) VALUES (?, ?, ?, ?, ?, ?)',
      u.name, u.email, u.phone, u.role, u.active, bcrypt.hashSync(req.body.password, 10));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new UserError('A user with that email already exists.');
    throw err;
  }
  req.flash('success', `${u.name} added. Give them their email and password to sign in.`);
  res.redirect('/users');
});

router.get('/users/:id/edit', (req, res) => {
  const item = get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!item) return res.status(404).render('error', { title: 'Not found', message: 'User not found.' });
  res.render('user-form', { title: `Edit ${item.name}`, item });
});

router.post('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const u = readUser(req.body, false);
  if (id === req.user.id && (u.role !== 'admin' || !u.active)) throw new UserError('You cannot remove your own admin access.');
  try {
    run('UPDATE users SET name = ?, email = ?, phone = ?, role = ?, active = ? WHERE id = ?', u.name, u.email, u.phone, u.role, u.active, id);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new UserError('A user with that email already exists.');
    throw err;
  }
  if (req.body.password) run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(req.body.password, 10), id);
  req.flash('success', `${u.name} updated.`);
  res.redirect('/users');
});

module.exports = router;
