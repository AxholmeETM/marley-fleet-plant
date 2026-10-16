const express = require('express');
const { all, run, get, transaction, isUniqueViolation } = require('../db');
const { listVehicles, getVehicle, listDefects, listDrivers, syncCardVehicles } = require('../queries');
const { upload: docUpload, saveDocs, listDocs, DOC_KINDS } = require('../documents');
const { requireAdmin, isAdmin, canUseVehicle, UserError, numberField, text } = require('../auth');
const { isValidDate, isoDate, addMonths, addDays } = require('../status');
const { OWNERS, VEHICLE_CATEGORIES, VEHICLE_STATUSES, VEHICLE_INACTIVE, TRACKED, FUEL_CARD_STATUSES } = require('../categories');

const LOOKUPS = { OWNERS, VEHICLE_CATEGORIES, VEHICLE_STATUSES, TRACKED, FUEL_CARD_STATUSES };

async function nextVanNumber(owner = 'MCL') {
  const prefix = `${owner}-VAN-`;
  const n = (await all('SELECT asset_no FROM vehicles WHERE asset_no LIKE ?', prefix + '%'))
    .reduce((m, r) => Math.max(m, parseInt(r.asset_no.slice(prefix.length), 10) || 0), 0);
  return prefix + String(n + 1).padStart(4, '0');
}

const router = express.Router();
// Employees may open the page of a vehicle assigned to them (read-only). Everything else is for admin users.
router.use('/vehicles', async (req, res, next) => {
  const own = req.method === 'GET' && /^\/\d+$/.test(req.path) && canUseVehicle(req.user, await get('SELECT id, driver_id FROM vehicles WHERE id = ?', Number(req.path.slice(1))));
  return own ? next() : requireAdmin(req, res, next);
});

function dateField(v, label) {
  if (!v) return null;
  if (!isValidDate(v)) throw new UserError(`${label} is not a valid date.`);
  return v;
}

async function readVehicle(body) {
  const reg = text(body.reg);
  if (!reg) throw new UserError('Registration is required.');
  const driverId = Number(body.driver_id) || null;
  if (driverId && !await get('SELECT id FROM users WHERE id = ?', driverId)) throw new UserError('Unknown driver.');
  const status = VEHICLE_STATUSES[body.status] ? body.status : 'active';
  return {
    reg: reg.toUpperCase().replace(/\s+/g, ' '),
    asset_no: text(body.asset_no) && text(body.asset_no).toUpperCase(),
    owner: OWNERS[body.owner] ? body.owner : 'MCL',
    category: VEHICLE_CATEGORIES[body.category] ? body.category : 'van',
    status,
    colour: text(body.colour),
    tracked: TRACKED[body.tracked] ? body.tracked : null,
    purchase_price: numberField(body.purchase_price, 'Purchase price'),
    purchase_date: dateField(body.purchase_date, 'Purchase date'),
    make: text(body.make),
    model: text(body.model),
    vehicle_type: text(body.vehicle_type),
    fuel_type: ['diesel', 'unleaded'].includes(body.fuel_type) ? body.fuel_type : 'diesel',
    driver_id: driverId,
    mileage: numberField(body.mileage, 'Mileage', { integer: true }),
    last_service_date: dateField(body.last_service_date, 'Last service date'),
    service_interval_months: numberField(body.service_interval_months, 'Service interval', { integer: true, min: 1 }) ?? 12,
    mot_due: dateField(body.mot_due, 'MOT due date'),
    tax_due: dateField(body.tax_due, 'Tax due date'),
    notes: text(body.notes),
    active: VEHICLE_INACTIVE.includes(status) ? 0 : 1,
  };
}

function saveError(err) {
  if (isUniqueViolation(err)) throw new UserError('Another vehicle already has that registration.');
  throw err;
}

router.get('/vehicles', async (req, res) => {
  const filter = req.query.filter || '';
  let vehicles = await listVehicles({ includeInactive: filter === 'inactive' });
  if (filter === 'inactive') vehicles = vehicles.filter((v) => !v.active);
  if (filter === 'sorn') vehicles = vehicles.filter((v) => v.status === 'sorn' || v.status === 'off_road');
  const category = VEHICLE_CATEGORIES[req.query.category] ? req.query.category : '';
  const counts = {};
  for (const v of vehicles) counts[v.category] = (counts[v.category] || 0) + 1;
  if (category) vehicles = vehicles.filter((v) => v.category === category);
  if (filter === 'attention') vehicles = vehicles.filter((v) => [v.mot, v.tax, v.service, v.walkaround].some((s) => s.level === 'overdue' || s.level === 'soon') || v.open_defects);
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q) vehicles = vehicles.filter((v) => [v.reg, v.asset_no, v.make, v.model, v.driver_display, v.vehicle_type].some((f) => f && f.toLowerCase().includes(q)));
  res.render('vehicle-list', { title: 'Fleet register', vehicles, filter, category, counts, q: req.query.q || '', ...LOOKUPS });
});

router.get('/vehicles/new', async (req, res) => {
  res.render('vehicle-form', { title: 'Add vehicle', crumbs: [['Fleet', '/vehicles'], ['Add vehicle']], item: { fuel_type: 'diesel', service_interval_months: 12, active: 1, owner: 'MCL', category: 'van', status: 'active', asset_no: await nextVanNumber() }, drivers: await listDrivers(), ...LOOKUPS });
});

router.post('/vehicles', async (req, res) => {
  const v = await readVehicle(req.body);
  const cols = Object.keys(v);
  let id;
  try {
    id = (await run(`INSERT INTO vehicles (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...Object.values(v))).lastInsertRowid;
  } catch (err) { saveError(err); }
  await syncCardVehicles(v.driver_id);
  req.flash('success', `${v.reg} added to the fleet register.`);
  res.redirect(`/vehicles/${id}`);
});

router.get('/vehicles/:id', async (req, res) => {
  const item = await getVehicle(Number(req.params.id));
  if (!item) return res.status(404).render('error', { title: 'Not found', message: 'Vehicle not found.' });
  const checks = await all(`SELECT c.*, u.name AS user_name FROM vehicle_checks c JOIN users u ON u.id = c.user_id
    WHERE c.vehicle_id = ? ORDER BY c.check_date DESC, c.id DESC LIMIT 30`, item.id);
  const records = await all(`SELECT * FROM service_records WHERE asset_type = 'vehicle' AND asset_id = ? ORDER BY record_date DESC, id DESC`, item.id);
  const defects = await listDefects({ status: 'all', assetType: 'vehicle', assetId: item.id, limit: 50 });
  const cards = await all('SELECT * FROM fuel_cards WHERE vehicle_id = ? ORDER BY status, provider', item.id);
  const documents = await listDocs('vehicle', item.id);
  const crumbs = isAdmin(req.user) ? [['Fleet', '/vehicles'], [VEHICLE_CATEGORIES[item.category] || 'Vehicles', `/vehicles?category=${item.category}`], [item.reg]] : [['Home', '/'], [item.reg]];
  res.render('vehicle-view', { title: item.reg, crumbs, item, checks, records, defects, cards, documents, DOC_KINDS, addMonths, addDays, ...LOOKUPS });
});

router.get('/vehicles/:id/edit', async (req, res) => {
  const item = await get('SELECT * FROM vehicles WHERE id = ?', Number(req.params.id));
  if (!item) return res.status(404).render('error', { title: 'Not found', message: 'Vehicle not found.' });
  res.render('vehicle-form', { title: `Edit ${item.reg}`, crumbs: [['Fleet', '/vehicles'], [item.reg, `/vehicles/${item.id}`], ['Edit']], item, drivers: await listDrivers(item.driver_id), ...LOOKUPS });
});

router.post('/vehicles/:id', async (req, res) => {
  const id = Number(req.params.id);
  const v = await readVehicle(req.body);
  const before = await get('SELECT driver_id FROM vehicles WHERE id = ?', id);
  try {
    await run(`UPDATE vehicles SET ${Object.keys(v).map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...Object.values(v), id);
  } catch (err) { saveError(err); }
  // Once a vehicle has a driver, the old typed name is dropped so every page shows the same person.
  if (v.driver_id) await run('UPDATE vehicles SET user_name = NULL WHERE id = ?', id);
  // The assigned driver's fuel cards follow the vehicle (and leave it if the driver changed).
  if (before && before.driver_id && before.driver_id !== v.driver_id) await syncCardVehicles(before.driver_id, id);
  await syncCardVehicles(v.driver_id);
  req.flash('success', `${v.reg} updated.`);
  res.redirect(`/vehicles/${id}`);
});

// Record a service, MOT pass, tax renewal, repair or defect, with any documents; updates the vehicle's due dates.
router.post('/vehicles/:id/records', docUpload, async (req, res) => {
  const item = await get('SELECT * FROM vehicles WHERE id = ?', Number(req.params.id));
  if (!item) throw new UserError('Vehicle not found.', 404);
  const kind = ['service', 'mot', 'tax', 'repair', 'defect'].includes(req.body.kind) ? req.body.kind : 'service';
  const date = req.body.record_date || isoDate();
  if (!isValidDate(date) || date > isoDate()) throw new UserError('Please enter a valid date, today or earlier.');
  const docs = { assetType: 'vehicle', assetId: item.id, kind, userId: req.user.id };
  if (kind === 'defect') {
    const description = text(req.body.notes);
    if (!description) throw new UserError('Please describe the defect.');
    const severity = ['minor', 'major', 'unsafe'].includes(req.body.severity) ? req.body.severity : 'minor';
    await transaction(async () => {
      const defectId = (await run('INSERT INTO defects (asset_type, asset_id, description, severity, reported_by) VALUES (?, ?, ?, ?, ?)',
        'vehicle', item.id, description, severity, req.user.id)).lastInsertRowid;
      await saveDocs(req.files, { ...docs, defectId });
    });
    req.flash('success', 'Defect reported.');
    return res.redirect(`/vehicles/${item.id}`);
  }
  let nextDue = dateField(req.body.next_due, 'Next due date');
  if (kind === 'mot' && !nextDue) nextDue = addDays(addMonths(date, 12), -1);
  if (kind === 'tax' && !nextDue) throw new UserError('Please enter the date the new tax runs until.');
  const mileage = numberField(req.body.reading, 'Mileage', { integer: true });
  await transaction(async () => {
    const recordId = (await run(`INSERT INTO service_records (asset_type, asset_id, kind, record_date, reading, next_due, done_by, notes, user_id) VALUES ('vehicle', ?, ?, ?, ?, ?, ?, ?, ?)`,
      item.id, kind, date, mileage, nextDue, text(req.body.done_by), text(req.body.notes), req.user.id)).lastInsertRowid;
    await saveDocs(req.files, { ...docs, recordId });
    // Backdated paperwork goes into the history without pulling the vehicle's dates backwards.
    if (kind === 'service') await run('UPDATE vehicles SET last_service_date = ? WHERE id = ? AND (last_service_date IS NULL OR last_service_date <= ?)', date, item.id, date);
    if (kind === 'mot') await run('UPDATE vehicles SET mot_due = ? WHERE id = ? AND (mot_due IS NULL OR mot_due <= ?)', nextDue, item.id, nextDue);
    if (kind === 'tax') await run('UPDATE vehicles SET tax_due = ? WHERE id = ? AND (tax_due IS NULL OR tax_due <= ?)', nextDue, item.id, nextDue);
    if (mileage != null) await run('UPDATE vehicles SET mileage = GREATEST(COALESCE(mileage, 0), ?) WHERE id = ?', mileage, item.id);
  });
  req.flash('success', { service: 'Service recorded.', mot: 'MOT recorded.', tax: 'Tax renewal recorded.', repair: 'Repair recorded.' }[kind]);
  res.redirect(`/vehicles/${item.id}`);
});

module.exports = router;
