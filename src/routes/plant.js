const express = require('express');
const { all, run, get, transaction } = require('../db');
const { listPlant, getPlant, listDefects } = require('../queries');
const { requireAdmin, requirePlantAccess, UserError, numberField, text } = require('../auth');
const { isValidDate, isoDate } = require('../status');
const { serviceWork, SECTIONS, CATEGORIES, CATEGORY, OWNERS, PLANT_STATUSES, PLANT_INACTIVE, INSPECTION_TYPES } = require('../categories');

const router = express.Router();
// Site managers can see all plant and add checks, defects and service / inspection records.
// Adding or editing the asset record itself (prices, hire rates, ownership) stays with admin users.
router.use(['/plant', '/equipment'], requirePlantAccess);

const { DEFAULT_SERVICE_INTERVAL, parseSchedule, servicePlan } = require('../status');

function dateField(v, label) {
  if (!v) return null;
  if (!isValidDate(v)) throw new UserError(`${label} is not a valid date.`);
  return v;
}

function readPlant(body) {
  const plantNo = text(body.plant_no);
  if (!plantNo) throw new UserError('Asset number is required.');
  const category = CATEGORY[body.category] ? body.category : 'misc';
  const owner = OWNERS[body.owner] ? body.owner : 'MCL';
  const status = PLANT_STATUSES[body.status] ? body.status : 'in_use';
  const make = text(body.make);
  const model = text(body.model);
  const inspectionType = INSPECTION_TYPES[body.inspection_type] ? body.inspection_type : 'none';
  return {
    plant_no: plantNo.toUpperCase(),
    category,
    owner,
    status,
    description: text(body.description) || [make, model].filter(Boolean).join(' ') || CATEGORY[category].label.replace(/s$/, ''),
    make,
    model,
    serial_no: text(body.serial_no),
    registered: text(body.registered),
    swl: text(body.swl),
    job_ref: text(body.job_ref),
    location: text(body.location),
    purchase_price: numberField(body.purchase_price, 'Purchase price'),
    purchase_date: dateField(body.purchase_date, 'Purchase date'),
    transfer_price: owner === 'MPL' ? numberField(body.transfer_price, 'Agreed price from MCL') : null,
    weekly_hire_rate: numberField(body.weekly_hire_rate, 'Weekly hire rate'),
    service_plan: body.service_plan ? 1 : 0,
    tracks_hours: body.tracks_hours ? 1 : 0,
    weekly_checks: body.weekly_checks ? 1 : 0,
    running_hours: numberField(body.running_hours, 'Running hours') ?? 0,
    service_schedule: parseSchedule(body.service_schedule).join(', ') || null,
    service_interval_hours: numberField(body.service_interval_hours, 'Service interval', { min: 1 }) ?? DEFAULT_SERVICE_INTERVAL,
    service_months: numberField(body.service_months, 'Service months', { integer: true, min: 1 }),
    last_service_hours: numberField(body.last_service_hours, 'Hours at last service'),
    last_service_date: dateField(body.last_service_date, 'Last service date'),
    loler_required: inspectionType === 'none' ? 0 : 1,
    inspection_type: inspectionType,
    loler_interval_months: numberField(body.loler_interval_months, 'Inspection interval', { integer: true, min: 1 }) ?? 12,
    last_loler_date: dateField(body.last_loler_date, 'Last inspection date'),
    inspection_due: dateField(body.inspection_due, 'Inspection due date'),
    cert_no: text(body.cert_no),
    notes: text(body.notes),
    active: PLANT_INACTIVE.includes(status) ? 0 : 1,
  };
}

// Next free asset number for an owner and category, e.g. MCL-EX-0015.
function nextAssetNumbers() {
  const used = new Set(all('SELECT plant_no FROM plant').map((r) => r.plant_no.toUpperCase()));
  const out = {};
  for (const owner of Object.keys(OWNERS)) {
    for (const c of CATEGORIES) {
      let n = 1;
      const prefix = `${owner}-${c.code}-`;
      for (const no of used) if (no.startsWith(prefix)) n = Math.max(n, (parseInt(no.slice(prefix.length), 10) || 0) + 1);
      out[`${owner}:${c.key}`] = prefix + String(n).padStart(4, '0');
    }
  }
  return out;
}

function formLocals(item) {
  return { item, CATEGORIES, OWNERS, PLANT_STATUSES, INSPECTION_TYPES, nextNumbers: nextAssetNumbers() };
}

function saveError(err) {
  if (String(err.message).includes('UNIQUE')) throw new UserError('Another asset already has that asset number.');
  throw err;
}

router.get(['/plant', '/equipment'], (req, res) => {
  const section = req.path === '/equipment' ? 'equipment' : 'plant';
  const categories = CATEGORIES.filter((c) => c.section === section);
  const filter = req.query.filter || '';
  const category = CATEGORY[req.query.category] && CATEGORY[req.query.category].section === section ? req.query.category : '';
  const owner = OWNERS[req.query.owner] ? req.query.owner : '';
  let plant = listPlant({ includeInactive: filter === 'inactive' }).filter((p) => (CATEGORY[p.category] || CATEGORY.misc).section === section);
  if (filter === 'inactive') plant = plant.filter((p) => !p.active);
  if (filter === 'attention') plant = plant.filter((p) => [p.service, p.loler, p.check].some((s) => s.level === 'overdue' || s.level === 'soon') || p.open_defects);
  if (filter === 'repair') plant = plant.filter((p) => p.status === 'repair');
  if (owner) plant = plant.filter((p) => p.owner === owner);
  const counts = {};
  for (const p of plant) counts[p.category] = (counts[p.category] || 0) + 1;
  if (category) plant = plant.filter((p) => p.category === category);
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q) plant = plant.filter((p) => [p.plant_no, p.description, p.job_ref, p.make, p.model, p.location, p.serial_no].some((f) => f && String(f).toLowerCase().includes(q)));
  const hireTotal = plant.filter((p) => p.active && p.weekly_hire_rate).reduce((t, p) => t + p.weekly_hire_rate, 0);
  res.render('plant-list', { title: SECTIONS[section].label, section: SECTIONS[section], plant, filter, category, owner, counts, hireTotal, q: req.query.q || '', CATEGORIES: categories, CATEGORY, OWNERS, PLANT_STATUSES, INSPECTION_TYPES });
});

router.get('/plant/new', requireAdmin, (req, res) => {
  const c = CATEGORY[req.query.category] || CATEGORIES[0];
  res.render('plant-form', {
    title: 'Add plant or equipment',
    ...formLocals({ category: c.key, owner: 'MCL', status: 'in_use', service_schedule: c.schedule, service_interval_hours: c.every, service_months: c.serviceMonths, tracks_hours: c.hours ? 1 : 0,
      weekly_checks: c.checks ? 1 : 0, inspection_type: c.inspection, loler_interval_months: c.months, active: 1 }),
  });
});

router.post('/plant', requireAdmin, (req, res) => {
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
  res.locals.navActive = SECTIONS[(CATEGORY[item.category] || CATEGORY.misc).section].href;
  res.render('plant-view', { title: `${item.plant_no} – ${item.description}`, item, checks, records, defects, plan: servicePlan(item, records), serviceWork, firstMark: parseSchedule(item.service_schedule)[0], CATEGORY, OWNERS, PLANT_STATUSES, INSPECTION_TYPES });
});

router.get('/plant/:id/edit', requireAdmin, (req, res) => {
  const item = get('SELECT * FROM plant WHERE id = ?', Number(req.params.id));
  if (!item) return res.status(404).render('error', { title: 'Not found', message: 'Plant not found.' });
  res.render('plant-form', { title: `Edit ${item.plant_no}`, ...formLocals(item) });
});

router.post('/plant/:id', requireAdmin, (req, res) => {
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
  const kind = ['service', 'loler', 'repair'].includes(req.body.kind) ? req.body.kind : 'service';
  const date = req.body.record_date || isoDate();
  if (!isValidDate(date)) throw new UserError('Please enter a valid date.');
  const hours = numberField(req.body.reading, 'Hours') ?? (kind === 'service' && item.tracks_hours ? item.running_hours : null);
  const nextDue = kind === 'loler' ? dateField(req.body.next_due, 'Next due date') : null;
  const certNo = text(req.body.cert_no);
  transaction(() => {
    run(`INSERT INTO service_records (asset_type, asset_id, kind, record_date, reading, next_due, done_by, notes, user_id) VALUES ('plant', ?, ?, ?, ?, ?, ?, ?, ?)`,
      item.id, kind, date, hours, nextDue, text(req.body.done_by), [certNo && `Cert ${certNo}`, text(req.body.notes)].filter(Boolean).join(' · ') || null, req.user.id);
    if (kind === 'service') {
      run('UPDATE plant SET last_service_date = ?, last_service_hours = ?, running_hours = MAX(running_hours, COALESCE(?, 0)) WHERE id = ?', date, hours, hours, item.id);
    } else if (kind === 'loler') {
      run('UPDATE plant SET last_loler_date = ?, inspection_due = ?, cert_no = COALESCE(?, cert_no) WHERE id = ?', date, nextDue, certNo, item.id);
    } else if (hours != null) {
      run('UPDATE plant SET running_hours = MAX(running_hours, ?) WHERE id = ?', hours, item.id);
    }
  });
  const label = INSPECTION_TYPES[item.inspection_type] || 'Inspection';
  req.flash('success', { service: 'Service recorded.', loler: `${label} recorded.`, repair: 'Repair recorded.' }[kind]);
  res.redirect(`/plant/${item.id}`);
});

module.exports = router;
