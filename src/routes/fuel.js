const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { all, get, run } = require('../db');
const storage = require('../storage');
const { listVehicles, getVehicle } = require('../queries');
const { requireAdmin, isAdmin, canUseVehicle, UserError, numberField, text } = require('../auth');
const { isoDate, isValidDate, addMonths, ukDate } = require('../status');
const { CARD_SQL, decorate: decorateCard } = require('./fuel-cards');

const router = express.Router();
const FUEL_TYPES = ['diesel', 'unleaded', 'adblue'];
const LITRES_PER_GALLON = 4.54609;

const MIME_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'image/heic': '.heic', 'image/heif': '.heif', 'application/pdf': '.pdf',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (MIME_EXT[file.mimetype]) return cb(null, true);
    cb(new UserError('Receipts must be a photo (JPG, PNG, HEIC) or a PDF.'));
  },
});

// ---- Driver: log fuel ----

router.get('/fuel/new', async (req, res) => {
  // Employees only see the vehicles assigned to them.
  const vehicles = await listVehicles({ driverId: isAdmin(req.user) ? null : req.user.id });
  const mine = vehicles.filter((v) => v.driver_id === req.user.id);
  const selected = vehicles.find((v) => v.id === Number(req.query.vehicle)) || mine[0] || null;
  const cards = (await all(`${CARD_SQL} WHERE c.status = 'active' ORDER BY c.provider, CASE WHEN c.card_ref ~ '^[0-9]+$' THEN c.card_ref::int END, c.card_ref`)).map(decorateCard);
  // The cards assigned to this person are shown first; any other active card can still be picked.
  const myCards = cards.filter((c) => c.user_id === req.user.id);
  const otherCards = cards.filter((c) => c.user_id !== req.user.id);
  res.render('fuel-form', { title: 'Log fuel', vehicles, mineIds: isAdmin(req.user) ? mine.map((v) => v.id) : [], selected, myCards, otherCards });
});

router.post('/fuel', upload.single('receipt'), async (req, res) => {
  let saved = null;
  try {
    const vehicle = await getVehicle(Number(req.body.vehicle_id));
    if (!vehicle || !vehicle.active) throw new UserError('Please choose a vehicle.');
    if (!canUseVehicle(req.user, vehicle)) throw new UserError('That vehicle is not assigned to you.', 403);
    if (!FUEL_TYPES.includes(req.body.fuel_type)) throw new UserError('Please choose diesel, unleaded or AdBlue.');
    const date = req.body.fill_date || isoDate();
    if (!isValidDate(date) || date > isoDate()) throw new UserError('Date must be today or earlier.');
    const litres = numberField(req.body.litres, 'Litres');
    if (!litres) throw new UserError('Please enter how many litres you put in.');
    if (!req.file) throw new UserError('Please attach a photo of the receipt.');
    const mileage = numberField(req.body.mileage, 'Mileage', { integer: true });
    const card = Number(req.body.fuel_card_id) ? await get("SELECT id, user_id FROM fuel_cards WHERE id = ? AND status = 'active'", Number(req.body.fuel_card_id)) : null;
    if (Number(req.body.fuel_card_id) && !card) throw new UserError('That fuel card is no longer active. Please choose another.');
    const fileName = `receipt-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${MIME_EXT[req.file.mimetype]}`;
    await storage.save(fileName, req.file.buffer);
    saved = fileName;
    await run(`INSERT INTO fuel_entries (vehicle_id, user_id, driver_id, fill_date, fuel_type, litres, mileage, station, notes, fuel_card_id, receipt_file, receipt_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      vehicle.id, req.user.id, vehicle.driver_id || (card && card.user_id) || req.user.id, date, req.body.fuel_type, litres, mileage, text(req.body.station), text(req.body.notes), card ? card.id : null,
      fileName, req.file.originalname);
    if (mileage != null) await run('UPDATE vehicles SET mileage = GREATEST(COALESCE(mileage, 0), ?) WHERE id = ?', mileage, vehicle.id);
    req.flash('success', `Fuel logged: ${litres} L of ${req.body.fuel_type === 'adblue' ? 'AdBlue' : req.body.fuel_type} for ${vehicle.reg}.`);
    res.redirect(req.user.role === 'admin' ? '/fuel' : '/');
  } catch (err) {
    if (saved) await storage.remove(saved).catch(() => {});
    throw err;
  }
});

// Receipts are only served to signed-in users: admins see all, drivers their own.
router.get('/receipts/:file', async (req, res) => {
  const name = path.basename(req.params.file);
  const entry = await get('SELECT user_id, driver_id FROM fuel_entries WHERE receipt_file = ?', name);
  if (!entry || (req.user.role !== 'admin' && entry.user_id !== req.user.id && entry.driver_id !== req.user.id)) {
    return res.status(404).render('error', { title: 'Not found', message: 'Receipt not found.' });
  }
  const file = await storage.read(name);
  if (!file) return res.status(404).render('error', { title: 'Not found', message: 'The receipt file is missing.' });
  res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'private, max-age=3600');
  res.type(file.type).send(file.body);
});

// ---- Admin: fuel dashboard ----

function period(query) {
  const today = isoDate();
  const monthStart = today.slice(0, 8) + '01';
  const presets = {
    month: [monthStart, today],
    last: [addMonths(monthStart, -1), isoDateMinusOne(monthStart)],
    quarter: [addMonths(monthStart, -2), today],
    year: [today.slice(0, 5) + '01-01', today],
  };
  if (query.period === 'custom' && isValidDate(query.from) && isValidDate(query.to)) {
    return { key: 'custom', from: query.from, to: query.to };
  }
  const key = presets[query.period] ? query.period : 'month';
  return { key, from: presets[key][0], to: presets[key][1] };
}

function isoDateMinusOne(s) {
  const [y, m, d] = s.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d - 1));
}

async function leaderboard(groupCol, nameSql, joinSql, from, to) {
  return await all(`
    SELECT ${groupCol} AS id, ${nameSql} AS name,
      SUM(CASE WHEN f.fuel_type = 'diesel' THEN f.litres ELSE 0 END) AS diesel,
      SUM(CASE WHEN f.fuel_type = 'unleaded' THEN f.litres ELSE 0 END) AS unleaded,
      SUM(CASE WHEN f.fuel_type = 'adblue' THEN f.litres ELSE 0 END) AS adblue,
      SUM(CASE WHEN f.fuel_type != 'adblue' THEN f.litres ELSE 0 END) AS fuel,
      SUM(f.cost) AS cost, COUNT(*) FILTER (WHERE f.cost IS NULL) AS unpriced, COUNT(*) AS fills
    FROM fuel_entries f ${joinSql}
    WHERE f.fill_date BETWEEN ? AND ?
    GROUP BY ${groupCol}, ${nameSql}
    ORDER BY fuel DESC, adblue DESC`, from, to);
}

// Approximate MPG per vehicle from logged odometer readings (fuel after the first fill / miles covered).
async function approxMpg(from, to) {
  const rows = await all(`SELECT vehicle_id, fill_date, mileage, litres FROM fuel_entries
    WHERE fill_date BETWEEN ? AND ? AND fuel_type != 'adblue' ORDER BY vehicle_id, fill_date, id`, from, to);
  const byVehicle = {};
  for (const r of rows) (byVehicle[r.vehicle_id] ||= []).push(r);
  const out = {};
  for (const [id, list] of Object.entries(byVehicle)) {
    const withMiles = list.filter((r) => r.mileage != null);
    if (withMiles.length < 2) continue;
    const first = withMiles[0];
    const last = withMiles[withMiles.length - 1];
    const miles = last.mileage - first.mileage;
    const litres = list.filter((r) => r !== first && r.fill_date >= first.fill_date).reduce((s, r) => s + r.litres, 0);
    if (miles > 0 && litres > 0) out[id] = { miles, mpg: miles / (litres / LITRES_PER_GALLON) };
  }
  return out;
}

router.get('/fuel', requireAdmin, async (req, res) => {
  const p = period(req.query);
  const type = FUEL_TYPES.includes(req.query.type) ? req.query.type : '';
  const show = ['unpriced', 'unverified', 'verified'].includes(req.query.show) ? req.query.show : '';
  const where = ['f.fill_date BETWEEN ? AND ?'];
  const params = [p.from, p.to];
  if (type) { where.push('f.fuel_type = ?'); params.push(type); }
  if (show === 'unpriced') where.push('f.cost IS NULL');
  if (show === 'unverified') where.push('f.verified = 0');
  if (show === 'verified') where.push('f.verified = 1');
  const entries = await all(`
    SELECT f.*, v.reg, u.name AS driver_name, c.provider AS card_provider, c.card_ref, c.last4 AS card_last4 FROM fuel_entries f
    JOIN vehicles v ON v.id = f.vehicle_id JOIN users u ON u.id = COALESCE(f.driver_id, f.user_id) LEFT JOIN fuel_cards c ON c.id = f.fuel_card_id
    WHERE ${where.join(' AND ')} ORDER BY f.fill_date DESC, f.id DESC`, ...params);

  const byType = Object.fromEntries(FUEL_TYPES.map((t) => [t, { litres: 0, cost: 0, pricedLitres: 0, fills: 0 }]));
  for (const r of await all('SELECT fuel_type, litres, cost FROM fuel_entries WHERE fill_date BETWEEN ? AND ?', p.from, p.to)) {
    const t = byType[r.fuel_type];
    t.litres += r.litres; t.fills += 1;
    if (r.cost != null) { t.cost += r.cost; t.pricedLitres += r.litres; }
  }
  const counts = await get(`SELECT COUNT(*) AS fills, COUNT(*) FILTER (WHERE cost IS NULL) AS unpriced, COUNT(*) FILTER (WHERE verified = 0) AS unverified, SUM(cost) AS cost
    FROM fuel_entries WHERE fill_date BETWEEN ? AND ?`, p.from, p.to);

  const drivers = await leaderboard('COALESCE(f.driver_id, f.user_id)', 'u.name', 'JOIN users u ON u.id = COALESCE(f.driver_id, f.user_id)', p.from, p.to);
  const vehicles = await leaderboard('f.vehicle_id', "v.reg || COALESCE(' – ' || v.make || ' ' || v.model, '')", 'JOIN vehicles v ON v.id = f.vehicle_id', p.from, p.to);
  const mpg = await approxMpg(p.from, p.to);
  vehicles.forEach((v) => Object.assign(v, mpg[v.id] || {}));

  res.render('fuel-dashboard', {
    title: 'Fuel Logs', period: p, type, show, entries, byType, counts,
    board: req.query.board === 'vehicles' ? 'vehicles' : 'drivers', drivers, vehicles,
    query: req.query,
  });
});

router.get('/fuel/next', requireAdmin, async (req, res) => {
  const next = await get('SELECT id FROM fuel_entries WHERE verified = 0 ORDER BY fill_date, id LIMIT 1');
  if (next) return res.redirect(`/fuel/${next.id}`);
  req.flash('success', 'All receipts are checked.');
  res.redirect('/fuel');
});

router.get('/fuel/:id', requireAdmin, async (req, res) => {
  const entry = await get(`SELECT f.*, v.reg, v.make, v.model, u.name AS driver_name, a.name AS priced_by_name FROM fuel_entries f
    JOIN vehicles v ON v.id = f.vehicle_id JOIN users u ON u.id = COALESCE(f.driver_id, f.user_id) LEFT JOIN users a ON a.id = f.priced_by
    WHERE f.id = ?`, Number(req.params.id));
  if (!entry) return res.status(404).render('error', { title: 'Not found', message: 'Fuel entry not found.' });
  const remaining = (await get('SELECT COUNT(*) AS n FROM fuel_entries WHERE verified = 0 AND id != ?', entry.id)).n;
  const cards = await all('SELECT id, provider, card_ref, last4, holder, status FROM fuel_cards ORDER BY status, provider, card_ref');
  res.render('fuel-entry', { title: `Fuel receipt – ${entry.reg}`, crumbs: [['Fuel Logs', '/fuel'], [`${entry.reg} · ${ukDate(entry.fill_date)}`]], entry, remaining, FUEL_TYPES, cards });
});

router.post('/fuel/:id', requireAdmin, async (req, res) => {
  const entry = await get('SELECT * FROM fuel_entries WHERE id = ?', Number(req.params.id));
  if (!entry) throw new UserError('Fuel entry not found.', 404);
  const cost = numberField(req.body.cost, 'Price');
  const litres = req.body.litres === undefined ? entry.litres : numberField(req.body.litres, 'Litres');
  if (!litres) throw new UserError('Litres must be more than 0.');
  const fuelType = FUEL_TYPES.includes(req.body.fuel_type) ? req.body.fuel_type : entry.fuel_type;
  const date = isValidDate(req.body.fill_date) ? req.body.fill_date : entry.fill_date;
  const verified = req.body.verified ? 1 : 0;
  const cardId = req.body.fuel_card_id === undefined ? entry.fuel_card_id : (Number(req.body.fuel_card_id) || null);
  if (verified && cost == null) throw new UserError('Enter the price from the receipt before marking it as checked.');
  await run(`UPDATE fuel_entries SET cost = ?, litres = ?, fuel_type = ?, fill_date = ?, verified = ?, fuel_card_id = ?, admin_notes = ?,
       priced_by = ?, priced_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?`,
    cost, litres, fuelType, date, verified, cardId, req.body.admin_notes === undefined ? entry.admin_notes : text(req.body.admin_notes), req.user.id, entry.id);

  if (req.body.next) {
    const next = await get('SELECT id FROM fuel_entries WHERE verified = 0 AND id != ? ORDER BY fill_date, id LIMIT 1', entry.id);
    if (next) {
      req.flash('success', 'Saved. Here is the next receipt to check.');
      return res.redirect(`/fuel/${next.id}`);
    }
    req.flash('success', 'Saved. All receipts are checked.');
    return res.redirect('/fuel');
  }
  req.flash('success', 'Fuel entry saved.');
  res.redirect(req.body.return_to === 'dashboard' ? `/fuel${req.body.qs ? '?' + req.body.qs : ''}` : `/fuel/${entry.id}`);
});

module.exports = router;
