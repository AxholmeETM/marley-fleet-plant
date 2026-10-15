const express = require('express');
const bcrypt = require('bcryptjs');
const { all, get, run, transaction, isUniqueViolation } = require('../db');
const { listVehicles, syncCardVehicles } = require('../queries');
const { requireAdmin, UserError, text } = require('../auth');
const { EMPLOYEE_TYPES, FUEL_CARD_STATUSES } = require('../categories');

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
  res.render('users', { title: 'Employees', users, show, counts });
});

const userForm = (res, title, item) => res.render('user-form', { title, crumbs: [['Employees', '/users'], ...(item.id ? [[item.name, `/users/${item.id}`], ['Edit']] : [[title]])], item, EMPLOYEE_TYPES });

router.get('/users/new', async (req, res) => {
  const role = req.query.role === 'admin' ? 'admin' : 'driver';
  const type = EMPLOYEE_TYPES[req.query.type] ? req.query.type : 'driver';
  userForm(res, role === 'admin' ? 'Add admin user' : 'Add employee', { role, employee_type: type, active: 1 });
});

// Employees without an email have no login; admin users always need one.
function readUser(body, existing) {
  const name = text(body.name);
  const email = text(body.email);
  const role = body.role === 'admin' ? 'admin' : 'driver';
  if (!name) throw new UserError('Please enter their name.');
  if (role === 'admin' && !email) throw new UserError('Admin users need an email to sign in with.');
  const password = body.password ? String(body.password) : '';
  if (password && password.length < 8) throw new UserError('Password must be at least 8 characters.');
  if (email && !password && !(existing && existing.password_hash)) throw new UserError('Set a password so they can sign in, or leave the email blank.');
  const employeeType = role === 'admin' ? null : body.employee_type;
  if (role !== 'admin' && !EMPLOYEE_TYPES[employeeType]) throw new UserError('Please choose fleet driver or site manager.');
  return { name, email, phone: text(body.phone), role, employee_type: employeeType, job_title: text(body.job_title), active: body.active === '0' ? 0 : 1, password };
}

const saveError = (err) => {
  if (isUniqueViolation(err)) throw new UserError('Someone already uses that email.');
  throw err;
};

router.post('/users', async (req, res) => {
  const u = readUser(req.body, null);
  let id;
  try {
    id = (await run('INSERT INTO users (name, email, phone, role, employee_type, job_title, active, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      u.name, u.email, u.phone, u.role, u.employee_type, u.job_title, u.active, u.email ? bcrypt.hashSync(u.password, 10) : null)).lastInsertRowid;
  } catch (err) { saveError(err); }
  req.flash('success', u.email ? `${u.name} added. Give them their email and password to sign in.` : `${u.name} added.`);
  res.redirect(`/users/${id}`);
});

// Add an employee (fleet driver, no login) for each full name on a fuel card, then link each card to its person.
// Shared cards ("Jim and Keith", "A / B", "A - B") are skipped; a first name alone links only if exactly one employee has it.
// Cards already linked to an employee are left alone; cards linked to an admin user move to the named employee.
const CARD_NAME = `trim(regexp_replace(c.holder, '\\s*\\(.*\\)\\s*$', ''))`;
const CARD_FILTER = `c.holder IS NOT NULL AND trim(c.holder) <> '' AND c.holder !~* '( and |/| - )'`;
async function employeesFromCards() {
  return transaction(async () => {
    const added = (await run(`INSERT INTO users (name, role, employee_type, active)
      SELECT DISTINCT ON (lower(n)) initcap(n), 'driver', 'driver', 1
      FROM (SELECT ${CARD_NAME} AS n FROM fuel_cards c WHERE ${CARD_FILTER}) x
      WHERE n LIKE '% %' AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(trim(u.name)) = lower(n))
      ORDER BY lower(n) RETURNING id`)).changes;
    const linked = (await run(`UPDATE fuel_cards c SET user_id = o.user_id
      FROM (SELECT c.id AS card_id, COALESCE(
          (SELECT u.id FROM users u WHERE lower(trim(u.name)) = lower(${CARD_NAME}) ORDER BY u.active DESC, u.id LIMIT 1),
          (SELECT MIN(u.id) FROM users u WHERE ${CARD_NAME} NOT LIKE '% %' AND u.active = 1 AND u.role = 'driver'
             AND lower(split_part(trim(u.name), ' ', 1)) = lower(${CARD_NAME}) HAVING COUNT(*) = 1)) AS user_id
        FROM fuel_cards c WHERE ${CARD_FILTER}) o
      WHERE c.id = o.card_id AND o.user_id IS NOT NULL AND o.user_id IS DISTINCT FROM c.user_id
        AND (c.user_id IS NULL OR c.user_id IN (SELECT id FROM users WHERE role = 'admin'))`)).changes;
    return { added, linked };
  });
}

// One-off data jobs, each run once per database on the first request after it was deployed.
let fromCardsDone = false;
async function employeesFromCardsOnce() {
  if (fromCardsDone) return;
  const claimed = (await run("INSERT INTO settings (key, value) VALUES ('employees_from_fuel_cards', 'done') ON CONFLICT (key) DO NOTHING")).changes;
  if (claimed) await employeesFromCards();
  // Once: point each person's fuel cards at the vehicle already assigned to them.
  if ((await run("INSERT INTO settings (key, value) VALUES ('cards_follow_vehicles', 'done') ON CONFLICT (key) DO NOTHING")).changes) {
    for (const u of await all('SELECT DISTINCT driver_id AS id FROM vehicles WHERE driver_id IS NOT NULL AND active = 1')) await syncCardVehicles(u.id);
  }
  fromCardsDone = true;
}

// Employee page: their details, plus the vehicles and fuel cards assigned to them.
router.get('/users/:id', async (req, res) => {
  const item = await get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!item) return res.status(404).render('error', { title: 'Not found', message: 'Employee not found.' });
  const vehicles = await listVehicles();
  const cards = await all(`SELECT c.*, v.reg, u.name AS user_name FROM fuel_cards c LEFT JOIN vehicles v ON v.id = c.vehicle_id LEFT JOIN users u ON u.id = c.user_id
    ORDER BY c.provider, CASE WHEN c.card_ref ~ '^[0-9]+$' THEN c.card_ref::int END, c.card_ref`);
  res.render('user-view', {
    title: item.name, crumbs: [['Employees', '/users'], [item.name]], item, EMPLOYEE_TYPES, FUEL_CARD_STATUSES,
    myVehicles: vehicles.filter((v) => v.driver_id === item.id), otherVehicles: vehicles.filter((v) => v.driver_id !== item.id && v.active),
    myCards: cards.filter((c) => c.user_id === item.id), otherCards: cards.filter((c) => c.user_id !== item.id && c.status === 'active'),
  });
});

router.post('/users/:id/vehicles', async (req, res) => {
  const id = Number(req.params.id);
  if (!await get('SELECT id FROM users WHERE id = ?', id)) throw new UserError('Employee not found.', 404);
  const v = await get('SELECT id, reg, driver_id FROM vehicles WHERE id = ?', Number(req.body.vehicle_id));
  if (!v) throw new UserError('Please choose a vehicle.');
  await transaction(async () => {
    await run('UPDATE vehicles SET driver_id = ?, user_name = NULL WHERE id = ?', id, v.id);
    if (v.driver_id && v.driver_id !== id) await syncCardVehicles(v.driver_id, v.id);
    await syncCardVehicles(id);
  });
  req.flash('success', `${v.reg} assigned.`);
  res.redirect(`/users/${id}`);
});

router.post('/users/:id/vehicles/:vid/remove', async (req, res) => {
  await transaction(async () => {
    await run('UPDATE vehicles SET driver_id = NULL WHERE id = ? AND driver_id = ?', Number(req.params.vid), Number(req.params.id));
    await syncCardVehicles(Number(req.params.id), Number(req.params.vid));
  });
  req.flash('success', 'Vehicle unassigned.');
  res.redirect(`/users/${Number(req.params.id)}`);
});

router.post('/users/:id/cards', async (req, res) => {
  const id = Number(req.params.id);
  if (!await get('SELECT id FROM users WHERE id = ?', id)) throw new UserError('Employee not found.', 404);
  const c = await get('SELECT id FROM fuel_cards WHERE id = ?', Number(req.body.card_id));
  if (!c) throw new UserError('Please choose a fuel card.');
  await run('UPDATE fuel_cards SET user_id = ? WHERE id = ?', id, c.id);
  await syncCardVehicles(id);
  req.flash('success', 'Fuel card assigned.');
  res.redirect(`/users/${id}`);
});

router.post('/users/:id/cards/:cid/remove', async (req, res) => {
  await run('UPDATE fuel_cards SET user_id = NULL WHERE id = ? AND user_id = ?', Number(req.params.cid), Number(req.params.id));
  req.flash('success', 'Fuel card unassigned.');
  res.redirect(`/users/${Number(req.params.id)}`);
});

router.get('/users/:id/edit', async (req, res) => {
  const item = await get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!item) return res.status(404).render('error', { title: 'Not found', message: 'User not found.' });
  userForm(res, `Edit ${item.name}`, item);
});

router.post('/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await get('SELECT * FROM users WHERE id = ?', id);
  if (!existing) throw new UserError('Employee not found.', 404);
  const u = readUser(req.body, existing);
  if (id === req.user.id && (u.role !== 'admin' || !u.active)) throw new UserError('You cannot remove your own admin access.');
  // A new password, or no email (no login), changes the stored password; otherwise it stays.
  const hash = !u.email ? null : u.password ? bcrypt.hashSync(u.password, 10) : existing.password_hash;
  try {
    await run('UPDATE users SET name = ?, email = ?, phone = ?, role = ?, employee_type = ?, job_title = ?, active = ?, password_hash = ? WHERE id = ?',
      u.name, u.email, u.phone, u.role, u.employee_type, u.job_title, u.active, hash, id);
  } catch (err) { saveError(err); }
  req.flash('success', `${u.name} updated.`);
  res.redirect(`/users/${id}`);
});

module.exports = router;
module.exports.employeesFromCards = employeesFromCards;
module.exports.employeesFromCardsOnce = employeesFromCardsOnce;
