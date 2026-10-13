const express = require('express');
const bcrypt = require('bcryptjs');
const { all, get, run, isUniqueViolation } = require('../db');
const { requireAdmin, UserError, text } = require('../auth');
const { EMPLOYEE_TYPES } = require('../categories');

const router = express.Router();
router.use('/users', requireAdmin);

const SHOW = { employees: "u.role = 'driver'", drivers: "u.role = 'driver' AND u.employee_type = 'driver'",
  site_managers: "u.role = 'driver' AND u.employee_type = 'site_manager'", admins: "u.role = 'admin'" };

router.get('/users', async (req, res) => {
  const show = SHOW[req.query.show] ? req.query.show : '';
  const users = await all(`SELECT u.*, (SELECT string_agg(reg, ', ' ORDER BY reg) FROM vehicles v WHERE v.driver_id = u.id AND v.active = 1) AS vehicles,
      (SELECT COUNT(*) FROM fuel_cards c WHERE c.user_id = u.id AND c.status = 'active') AS cards
    FROM users u ${show ? 'WHERE ' + SHOW[show] : ''} ORDER BY u.active DESC, u.role = 'admin', u.name`);
  const counts = await get(`SELECT COUNT(*) AS all_users, COUNT(*) FILTER (WHERE role = 'driver') AS employees, COUNT(*) FILTER (WHERE role = 'driver' AND employee_type = 'driver') AS drivers,
    COUNT(*) FILTER (WHERE role = 'driver' AND employee_type = 'site_manager') AS site_managers, COUNT(*) FILTER (WHERE role = 'admin') AS admins FROM users`);
  res.render('users', { title: 'Users', users, show, counts });
});

const userForm = (res, title, item) => res.render('user-form', { title, item, EMPLOYEE_TYPES });

router.get('/users/new', async (req, res) => {
  const role = req.query.role === 'admin' ? 'admin' : 'driver';
  const type = EMPLOYEE_TYPES[req.query.type] ? req.query.type : 'driver';
  userForm(res, role === 'admin' ? 'Add admin user' : 'Add employee', { role, employee_type: type, active: 1 });
});

function readUser(body, isNew) {
  const name = text(body.name);
  const email = text(body.email);
  if (!name || !email) throw new UserError('Name and email are required.');
  if (isNew && (!body.password || body.password.length < 8)) throw new UserError('Password must be at least 8 characters.');
  if (!isNew && body.password && body.password.length < 8) throw new UserError('Password must be at least 8 characters.');
  const role = body.role === 'admin' ? 'admin' : 'driver';
  const employeeType = role === 'admin' ? null : body.employee_type;
  if (role !== 'admin' && !EMPLOYEE_TYPES[employeeType]) throw new UserError('Please choose fleet driver or site manager.');
  return { name, email, phone: text(body.phone), role, employee_type: employeeType, job_title: text(body.job_title), active: body.active === '0' ? 0 : 1 };
}

router.post('/users', async (req, res) => {
  const u = readUser(req.body, true);
  try {
    await run('INSERT INTO users (name, email, phone, role, employee_type, job_title, active, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      u.name, u.email, u.phone, u.role, u.employee_type, u.job_title, u.active, bcrypt.hashSync(req.body.password, 10));
  } catch (err) {
    if (isUniqueViolation(err)) throw new UserError('A user with that email already exists.');
    throw err;
  }
  req.flash('success', `${u.name} added. Give them their email and password to sign in.`);
  res.redirect('/users');
});

router.get('/users/:id/edit', async (req, res) => {
  const item = await get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!item) return res.status(404).render('error', { title: 'Not found', message: 'User not found.' });
  userForm(res, `Edit ${item.name}`, item);
});

router.post('/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const u = readUser(req.body, false);
  if (id === req.user.id && (u.role !== 'admin' || !u.active)) throw new UserError('You cannot remove your own admin access.');
  try {
    await run('UPDATE users SET name = ?, email = ?, phone = ?, role = ?, employee_type = ?, job_title = ?, active = ? WHERE id = ?',
      u.name, u.email, u.phone, u.role, u.employee_type, u.job_title, u.active, id);
  } catch (err) {
    if (isUniqueViolation(err)) throw new UserError('A user with that email already exists.');
    throw err;
  }
  if (req.body.password) await run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(req.body.password, 10), id);
  req.flash('success', `${u.name} updated.`);
  res.redirect('/users');
});

module.exports = router;
