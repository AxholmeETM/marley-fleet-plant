const express = require('express');
const { all, run, get, transaction } = require('../db');
const { listPlant, getPlant, listDefects } = require('../queries');
const { requireAdmin, UserError, numberField, text } = require('../auth');
const { isValidDate, isoDate } = require('../status');

const router = express.Router();
router.use('/plant', requireAdmin);

const DEFAULT_SERVICE_HOURS = Number(process.env.DEFAULT_SERVICE_HOURS || 250);

function dateField(v, label) {
  if (!v) return null;
  if (!isValidDate(v)) throw new UserError(`${label} is not a valid date.`);
  return v;
}

function readPlant(body) {
  const plantNo = text(body.plant_no);
  const description = text(body.description);
  if (!plantNo) throw new UserError('Plant ID is required.');
  if (!description) throw new UserError('Description is required.');
  return {
    plant_no: plantNo.toUpperCase(),
    description,
    make: text(body.make),
    model: text(body.model),
    serial_no: text(body.serial_no),
    job_ref: text(body.job_ref),
    location: text(body.location),
    running_hours: numberField(body.running_hours, 'Running hours') ?? 0,
    service_interval_hours: numberField(body.service_interval_hours, 'Service interval', { min: 1 }) ?? DEFAULT_SERVICE_HOURS,
    last_service_hours: numberField(body.last_service_hours, 'Hours at last service'),
    last_service_date: dateField(body.last_service_date, 'Last service date'),
    loler_required: body.loler_required ? 1 : 0,
    loler_interval_months: Number(body.loler_interval_months) === 6 ? 6 : 12,
    last_loler_date: dateField(body.last_loler_date, 'Last LOLER date'),
    notes: text(body.notes),
    active: body.active === undefined ? 1 : body.active === '1' ? 1 : 0,
  };
}

function saveError(err) {
  if (String(err.message).includes('UNIQUE')) throw new UserError('Another item of plant already has that Plant ID.');
  throw err;
}

router.get('/plant', (req, res) => {
  const filter = req.query.filter || '';
  let plant = listPlant({ includeInactive: filter === 'inactive' });
  if (filter === 'inactive') plant = plant.filter((p) => !p.active);
  if (filter === 'attention') plant = plant.filter((p) => [p.service, p.loler, p.check].some((s) => s.level === 'overdue' || s.level === 'soon') || p.open_defects);
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q) plant = plant.filter((p) => [p.plant_no, p.description, p.job_ref, p.make, p.model, p.location].some((f) => f && f.toLowerCase().includes(q)));
  res.render('plant-list', { title: 'Plant register', plant, filter, q: req.query.q || '' });
});

router.get('/plant/new', (req, res) => {
  res.render('plant-form', { title: 'Add plant', item: { service_interval_hours: DEFAULT_SERVICE_HOURS, loler_required: 1, loler_interval_months: 12, active: 1 } });
});

router.post('/plant', (req, res) => {
  const p = readPlant(req.body);
  const cols = Object.keys(p);
  let id;
  try {
    id = run(`INSERT INTO plant (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...Object.values(p)).lastInsertRowid;
  } catch (err) { saveError(err); }
  req.flash('success', `${p.plant_no} added to the plant register.`);
  res.redirect(`/plant/${id}`);
});

router.get('/plant/:id', (req, res) => {
  const item = getPlant(Number(req.params.id));
  if (!item) return res.status(404).render('error', { title: 'Not found', message: 'Plant not found.' });
  const checks = all(`SELECT c.*, u.name AS user_name FROM plant_checks c JOIN users u ON u.id = c.user_id
    WHERE c.plant_id = ? ORDER BY c.check_date DESC, c.id DESC LIMIT 20`, item.id);
  const records = all(`SELECT * FROM service_records WHERE asset_type = 'plant' AND asset_id = ? ORDER BY record_date DESC, id DESC`, item.id);
  const defects = listDefects({ status: 'all', assetType: 'plant', assetId: item.id, limit: 50 });
  res.render('plant-view', { title: `${item.plant_no} – ${item.description}`, item, checks, records, defects });
});

router.get('/plant/:id/edit', (req, res) => {
  const item = get('SELECT * FROM plant WHERE id = ?', Number(req.params.id));
  if (!item) return res.status(404).render('error', { title: 'Not found', message: 'Plant not found.' });
  res.render('plant-form', { title: `Edit ${item.plant_no}`, item });
});

router.post('/plant/:id', (req, res) => {
  const id = Number(req.params.id);
  const p = readPlant(req.body);
  try {
    run(`UPDATE plant SET ${Object.keys(p).map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...Object.values(p), id);
  } catch (err) { saveError(err); }
  req.flash('success', `${p.plant_no} updated.`);
  res.redirect(`/plant/${id}`);
});

router.post('/plant/:id/records', (req, res) => {
  const item = get('SELECT * FROM plant WHERE id = ?', Number(req.params.id));
  if (!item) throw new UserError('Plant not found.', 404);
  const kind = req.body.kind === 'loler' ? 'loler' : 'service';
  const date = req.body.record_date || isoDate();
  if (!isValidDate(date)) throw new UserError('Please enter a valid date.');
  const hours = numberField(req.body.reading, 'Hours') ?? (kind === 'service' ? item.running_hours : null);
  transaction(() => {
    run(`INSERT INTO service_records (asset_type, asset_id, kind, record_date, reading, done_by, notes, user_id) VALUES ('plant', ?, ?, ?, ?, ?, ?, ?)`,
      item.id, kind, date, hours, text(req.body.done_by), text(req.body.notes), req.user.id);
    if (kind === 'service') {
      run('UPDATE plant SET last_service_date = ?, last_service_hours = ?, running_hours = MAX(running_hours, ?) WHERE id = ?', date, hours, hours, item.id);
    } else {
      run('UPDATE plant SET last_loler_date = ? WHERE id = ?', date, item.id);
    }
  });
  req.flash('success', kind === 'service' ? 'Service recorded.' : 'LOLER inspection recorded.');
  res.redirect(`/plant/${item.id}`);
});

module.exports = router;
