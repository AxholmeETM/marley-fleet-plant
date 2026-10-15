const express = require('express');
const { all, get, run } = require('../db');
const { listVehicles } = require('../queries');
const { requireAdmin, UserError, text } = require('../auth');
const { isValidDate, dueStatus } = require('../status');
const { FUEL_CARD_PROVIDERS, FUEL_CARD_STATUSES } = require('../categories');

const router = express.Router();
// Fuel card pages: every admin can see and manage them; nobody else can.
router.use('/fuel-cards', requireAdmin);

const CARD_SQL = `SELECT c.*, v.reg, v.id AS vehicle_id, u.name AS user_name,
    (SELECT MAX(fill_date) FROM fuel_entries f WHERE f.fuel_card_id = c.id) AS last_used
  FROM fuel_cards c LEFT JOIN vehicles v ON v.id = c.vehicle_id LEFT JOIN users u ON u.id = c.user_id`;

const cardLabel = (c) => `${c.provider}${c.card_ref ? ' #' + c.card_ref : ''}${c.last4 ? ' ••' + c.last4 : ''}`;

function decorate(c) {
  // Cards expire at the end of the month printed on them.
  const expiry = c.expiry ? c.expiry.slice(0, 7) + '-28' : null;
  return {
    ...c,
    label: cardLabel(c),
    // The app user the card is assigned to wins; otherwise the name typed on the card record.
    holder_display: c.user_name || c.holder,
    expiryStatus: c.status === 'active' ? dueStatus(expiry, 45) : { level: 'none', text: FUEL_CARD_STATUSES[c.status] },
  };
}

const activeUsers = async () => await all("SELECT id, name, role FROM users WHERE active = 1 ORDER BY role = 'admin', name");

async function checkUser(value) {
  const id = Number(value) || null;
  if (id && !await get('SELECT id FROM users WHERE id = ? AND active = 1', id)) throw new UserError('That person is not an active user.');
  return id;
}

async function readCard(body) {
  const provider = text(body.provider);
  if (!provider) throw new UserError('Please choose the fuel card company.');
  // The full number is only shown to admins; everyone else sees the last 4 digits.
  const cardNumber = String(body.card_number || '').replace(/[^\dA-Za-z]/g, '');
  const last4 = cardNumber ? cardNumber.slice(-4) : null;
  const expiry = text(body.expiry);
  if (expiry && !/^\d{4}-\d{2}$/.test(expiry) && !isValidDate(expiry)) throw new UserError('Expiry must be a month, e.g. 2027-06.');
  const vehicleId = Number(body.vehicle_id) || null;
  return {
    provider,
    card_ref: text(body.card_ref),
    last4,
    card_number: cardNumber || null,
    holder: text(body.holder),
    // No longer on the form (fuel cards are admin-only); keep any existing link unless one is sent.
    ...(body.user_id !== undefined ? { user_id: await checkUser(body.user_id) } : {}),
    vehicle_id: vehicleId,
    card_type: text(body.card_type),
    expiry: expiry ? expiry.slice(0, 7) : null,
    status: FUEL_CARD_STATUSES[body.status] ? body.status : 'active',
    notes: text(body.notes),
  };
}

router.get('/fuel-cards', async (req, res) => {
  const show = req.query.show === 'all' ? 'all' : 'active';
  const cards = (await all(`${CARD_SQL} ${show === 'active' ? "WHERE c.status = 'active'" : ''} ORDER BY c.provider, c.status, CASE WHEN c.card_ref ~ '^[0-9]+$' THEN c.card_ref::int END, c.card_ref`)).map(decorate);
  res.render('fuel-cards', { title: 'Fuel cards', cards, show, FUEL_CARD_STATUSES });
});

async function form(res, title, item) {
  res.render('fuel-card-form', { title, crumbs: [['Fuel cards', '/fuel-cards'], [item.id ? cardLabel(item) : 'Add card']], item, vehicles: await listVehicles(), users: await activeUsers(), FUEL_CARD_PROVIDERS, FUEL_CARD_STATUSES });
}

router.get('/fuel-cards/new', async (req, res) => await form(res, 'Add fuel card', { status: 'active', vehicle_id: Number(req.query.vehicle) || null }));

router.post('/fuel-cards', async (req, res) => {
  const c = await readCard(req.body);
  await run(`INSERT INTO fuel_cards (${Object.keys(c).join(', ')}) VALUES (${Object.keys(c).map(() => '?').join(', ')})`, ...Object.values(c));
  req.flash('success', `${c.provider} card added.`);
  res.redirect('/fuel-cards');
});

router.get('/fuel-cards/:id/edit', async (req, res) => {
  const item = await get('SELECT * FROM fuel_cards WHERE id = ?', Number(req.params.id));
  if (!item) return res.status(404).render('error', { title: 'Not found', message: 'Fuel card not found.' });
  await form(res, 'Edit fuel card', item);
});

router.post('/fuel-cards/:id', async (req, res) => {
  const c = await readCard(req.body);
  await run(`UPDATE fuel_cards SET ${Object.keys(c).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(c), Number(req.params.id));
  req.flash('success', 'Fuel card updated.');
  res.redirect('/fuel-cards');
});

module.exports = { router, CARD_SQL, decorate, cardLabel };
