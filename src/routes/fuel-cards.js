const express = require('express');
const { all, get, run } = require('../db');
const { listVehicles } = require('../queries');
const { requireAdmin, UserError, text } = require('../auth');
const { isValidDate, dueStatus } = require('../status');
const { FUEL_CARD_PROVIDERS, FUEL_CARD_STATUSES } = require('../categories');

const router = express.Router();
router.use('/fuel-cards', requireAdmin);

const CARD_SQL = `SELECT c.*, v.reg, v.id AS vehicle_id,
    (SELECT MAX(fill_date) FROM fuel_entries f WHERE f.fuel_card_id = c.id) AS last_used
  FROM fuel_cards c LEFT JOIN vehicles v ON v.id = c.vehicle_id`;

function decorate(c) {
  // Cards expire at the end of the month printed on them.
  const expiry = c.expiry ? c.expiry.slice(0, 7) + '-28' : null;
  return { ...c, expiryStatus: c.status === 'active' ? dueStatus(expiry, 45) : { level: 'none', text: FUEL_CARD_STATUSES[c.status] } };
}

function readCard(body) {
  const provider = text(body.provider);
  if (!provider) throw new UserError('Please choose the fuel card company.');
  const digits = String(body.last4 || '').replace(/\D/g, '');
  // Only ever keep the last 4 digits of the card number.
  const last4 = digits ? digits.slice(-4) : null;
  const expiry = text(body.expiry);
  if (expiry && !/^\d{4}-\d{2}$/.test(expiry) && !isValidDate(expiry)) throw new UserError('Expiry must be a month, e.g. 2027-06.');
  const vehicleId = Number(body.vehicle_id) || null;
  return {
    provider,
    card_ref: text(body.card_ref),
    last4,
    holder: text(body.holder),
    vehicle_id: vehicleId,
    card_type: text(body.card_type),
    expiry: expiry ? expiry.slice(0, 7) : null,
    status: FUEL_CARD_STATUSES[body.status] ? body.status : 'active',
    notes: text(body.notes),
  };
}

router.get('/fuel-cards', (req, res) => {
  const show = req.query.show === 'all' ? 'all' : 'active';
  const cards = all(`${CARD_SQL} ${show === 'active' ? "WHERE c.status = 'active'" : ''} ORDER BY c.provider, c.status, CAST(c.card_ref AS INTEGER), c.card_ref`).map(decorate);
  res.render('fuel-cards', { title: 'Fuel cards', cards, show, FUEL_CARD_STATUSES });
});

function form(res, title, item) {
  res.render('fuel-card-form', { title, item, vehicles: listVehicles(), FUEL_CARD_PROVIDERS, FUEL_CARD_STATUSES });
}

router.get('/fuel-cards/new', (req, res) => form(res, 'Add fuel card', { status: 'active', vehicle_id: Number(req.query.vehicle) || null }));

router.post('/fuel-cards', (req, res) => {
  const c = readCard(req.body);
  run(`INSERT INTO fuel_cards (${Object.keys(c).join(', ')}) VALUES (${Object.keys(c).map(() => '?').join(', ')})`, ...Object.values(c));
  req.flash('success', `${c.provider} card added.`);
  res.redirect('/fuel-cards');
});

router.get('/fuel-cards/:id/edit', (req, res) => {
  const item = get('SELECT * FROM fuel_cards WHERE id = ?', Number(req.params.id));
  if (!item) return res.status(404).render('error', { title: 'Not found', message: 'Fuel card not found.' });
  form(res, 'Edit fuel card', item);
});

router.post('/fuel-cards/:id', (req, res) => {
  const c = readCard(req.body);
  run(`UPDATE fuel_cards SET ${Object.keys(c).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(c), Number(req.params.id));
  req.flash('success', 'Fuel card updated.');
  res.redirect('/fuel-cards');
});

module.exports = { router, CARD_SQL, decorate };
