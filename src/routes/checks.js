const express = require('express');
const { all, get, run, transaction } = require('../db');
const { listProjects, listPlant, listVehicles, getPlant, getVehicle } = require('../queries');
const { VEHICLE_ITEMS, PLANT_ITEMS, RESULTS } = require('../checklists');
const { requireAdmin, requirePlantAccess, isAdmin, canUsePlant, canUseVehicle, UserError, numberField, text } = require('../auth');
const { isoDate, isValidDate, addDays, ukDate } = require('../status');

const router = express.Router();

function readResults(body, items) {
  return items.map((item, i) => {
    const result = body[`item_${i}`];
    if (!RESULTS.includes(result)) throw new UserError(`Please answer every item on the check (missing: ${item}).`);
    return { item, result };
  });
}

function checkDate(value) {
  const d = value || isoDate();
  if (!isValidDate(d) || d > isoDate()) throw new UserError('Check date must be today or earlier.');
  return d;
}

const SEVERITIES = ['minor', 'major', 'unsafe'];

// ---- Vehicle daily walk-around ----

router.get('/checks/vehicle/new', async (req, res) => {
  // Employees only see the vehicles assigned to them.
  const vehicles = await listVehicles({ driverId: isAdmin(req.user) ? null : req.user.id });
  const mine = vehicles.filter((v) => v.driver_id === req.user.id);
  const selectedId = Number(req.query.vehicle) || (mine[0] && mine[0].id) || null;
  const vehicle = selectedId ? vehicles.find((v) => v.id === selectedId) : null;
  res.render('check-form', {
    title: 'Daily walk-around check', kind: 'vehicle', items: VEHICLE_ITEMS,
    assets: vehicles, mineIds: isAdmin(req.user) ? mine.map((v) => v.id) : [], asset: vehicle,
  });
});

router.post('/checks/vehicle', async (req, res) => {
  const vehicle = await getVehicle(Number(req.body.asset_id));
  if (!vehicle || !vehicle.active) throw new UserError('Please choose a vehicle.');
  if (!canUseVehicle(req.user, vehicle)) throw new UserError('That vehicle is not assigned to you.', 403);
  const results = readResults(req.body, VEHICLE_ITEMS);
  const date = checkDate(req.body.check_date);
  const mileage = numberField(req.body.reading, 'Mileage', { integer: true });
  const defectItems = results.filter((r) => r.result === 'defect');
  const details = text(req.body.defect_details);
  if (defectItems.length && !details) throw new UserError('Please describe the defects you found.');
  const severity = SEVERITIES.includes(req.body.severity) ? req.body.severity : 'minor';

  const id = await transaction(async () => {
    const { lastInsertRowid } = await run(
      'INSERT INTO vehicle_checks (vehicle_id, user_id, check_date, mileage, results, defects_found, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      vehicle.id, req.user.id, date, mileage, JSON.stringify(results), defectItems.length, text(req.body.notes));
    if (mileage != null) await run('UPDATE vehicles SET mileage = GREATEST(COALESCE(mileage, 0), ?) WHERE id = ?', mileage, vehicle.id);
    if (defectItems.length) {
      await run('INSERT INTO defects (asset_type, asset_id, check_id, description, severity, reported_by) VALUES (?, ?, ?, ?, ?, ?)',
        'vehicle', vehicle.id, lastInsertRowid, `${defectItems.map((r) => r.item).join('; ')}: ${details}`, severity, req.user.id);
    }
    return lastInsertRowid;
  });
  req.flash(defectItems.length ? 'warning' : 'success',
    defectItems.length ? `Walk-around saved for ${vehicle.reg}. Defects have been reported to the office.` : `Walk-around saved for ${vehicle.reg}. No defects.`);
  res.redirect(req.user.role === 'admin' ? `/checks/vehicle/${id}` : '/');
});

// ---- Plant weekly check sheet ----

router.get('/checks/plant/new', requirePlantAccess, async (req, res) => {
  const plant = (await listPlant()).filter((p) => p.weekly_checks && p.status !== 'repair');
  const selectedId = Number(req.query.plant) || null;
  res.render('check-form', {
    title: 'Plant check sheet', kind: 'plant', items: PLANT_ITEMS, projects: await listProjects(),
    assets: plant, mineIds: [], asset: selectedId ? plant.find((p) => p.id === selectedId) : null,
  });
});

router.post('/checks/plant', requirePlantAccess, async (req, res) => {
  const plant = await getPlant(Number(req.body.asset_id));
  if (!plant || !plant.active) throw new UserError('Please choose a piece of plant.');
  const results = readResults(req.body, PLANT_ITEMS);
  const date = checkDate(req.body.check_date);
  const hours = numberField(req.body.reading, 'Running hours');
  if (hours == null && plant.tracks_hours) throw new UserError('Please enter the running hours from the hour meter.');
  const jobRef = text(req.body.job_ref) || plant.job_ref;
  if (text(req.body.job_ref) && jobRef !== plant.job_ref && !await get('SELECT code FROM projects WHERE code = ? AND active = 1', jobRef)) throw new UserError('Please choose a project from the list.');
  const defectItems = results.filter((r) => r.result === 'defect');
  const details = text(req.body.defect_details);
  if (defectItems.length && !details) throw new UserError('Please describe the defects you found.');
  const severity = SEVERITIES.includes(req.body.severity) ? req.body.severity : 'minor';

  const id = await transaction(async () => {
    const { lastInsertRowid } = await run(
      'INSERT INTO plant_checks (plant_id, user_id, check_date, hours, job_ref, results, defects_found, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      plant.id, req.user.id, date, hours, jobRef, JSON.stringify(results), defectItems.length, text(req.body.notes));
    await run('UPDATE plant SET running_hours = GREATEST(running_hours, COALESCE(?::double precision, 0)), job_ref = COALESCE(?, job_ref) WHERE id = ?', hours, jobRef, plant.id);
    if (defectItems.length) {
      await run('INSERT INTO defects (asset_type, asset_id, check_id, description, severity, reported_by) VALUES (?, ?, ?, ?, ?, ?)',
        'plant', plant.id, lastInsertRowid, `${defectItems.map((r) => r.item).join('; ')}: ${details}`, severity, req.user.id);
    }
    return lastInsertRowid;
  });
  const warn = hours != null && hours < plant.running_hours ? ` Note: the hours you entered are lower than the last reading (${plant.running_hours}).` : '';
  req.flash(defectItems.length || warn ? 'warning' : 'success',
    `Check sheet saved for ${plant.plant_no}.${defectItems.length ? ' Defects have been reported to the office.' : ''}${warn}`);
  res.redirect(req.user.role === 'admin' ? `/checks/plant/${id}` : '/');
});

// ---- Viewing checks ----

router.get('/checks', requireAdmin, async (req, res) => {
  const type = req.query.type === 'vehicle' ? 'vehicle' : 'plant';
  const from = isValidDate(req.query.from) ? req.query.from : addDays(isoDate(), -13);
  const to = isValidDate(req.query.to) ? req.query.to : isoDate();
  const rows = type === 'vehicle'
    ? await all(`SELECT c.id, c.check_date, c.mileage AS reading, c.defects_found, c.created_at, v.reg AS asset, v.id AS asset_id, u.name AS user_name
           FROM vehicle_checks c JOIN vehicles v ON v.id = c.vehicle_id JOIN users u ON u.id = c.user_id
           WHERE c.check_date BETWEEN ? AND ? ORDER BY c.check_date DESC, c.id DESC`, from, to)
    : await all(`SELECT c.id, c.check_date, c.hours AS reading, c.job_ref, c.defects_found, c.created_at, p.plant_no || ' – ' || p.description AS asset, p.id AS asset_id, u.name AS user_name
           FROM plant_checks c JOIN plant p ON p.id = c.plant_id JOIN users u ON u.id = c.user_id
           WHERE c.check_date BETWEEN ? AND ? ORDER BY c.check_date DESC, c.id DESC`, from, to);
  const missing = type === 'vehicle'
    ? (await listVehicles()).filter((v) => v.walkaround.level === 'overdue')
    : (await listPlant()).filter((p) => p.check.level === 'overdue' || p.check.level === 'soon');
  res.render('checks', { title: 'Site Checks', type, from, to, rows, missing });
});

router.get('/checks/:type/:id', async (req, res) => {
  const { type } = req.params;
  let check;
  if (type === 'vehicle') {
    check = await get(`SELECT c.*, c.mileage AS reading, v.reg AS asset, v.id AS asset_id, u.name AS user_name FROM vehicle_checks c
      JOIN vehicles v ON v.id = c.vehicle_id JOIN users u ON u.id = c.user_id WHERE c.id = ?`, Number(req.params.id));
  } else if (type === 'plant') {
    check = await get(`SELECT c.*, c.hours AS reading, p.plant_no || ' – ' || p.description AS asset, p.id AS asset_id, u.name AS user_name FROM plant_checks c
      JOIN plant p ON p.id = c.plant_id JOIN users u ON u.id = c.user_id WHERE c.id = ?`, Number(req.params.id));
  }
  // Admins see every check, site managers every plant check, everyone else only their own.
  const allowed = check && (isAdmin(req.user) || check.user_id === req.user.id || (type === 'plant' && canUsePlant(req.user)));
  if (!allowed) {
    return res.status(404).render('error', { title: 'Not found', message: 'Check not found.' });
  }
  const defect = await get('SELECT * FROM defects WHERE asset_type = ? AND check_id = ?', type, check.id);
  const title = type === 'vehicle' ? 'Walk-around check' : 'Plant check sheet';
  const crumbs = isAdmin(req.user) ? [['Plant', '/plant'], ['Site Checks', `/checks?type=${type}`], [`${title} · ${ukDate(check.check_date)}`]] : [['Home', '/'], [title]];
  res.render('check-view', { title, crumbs, type, check, results: JSON.parse(check.results), defect });
});

module.exports = router;
