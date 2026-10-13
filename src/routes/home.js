const express = require('express');
const { all, get } = require('../db');
const { listPlant, listVehicles, listDefects } = require('../queries');
const { isoDate, dueStatus } = require('../status');
const { INSPECTION_TYPES } = require('../categories');
const fuelCards = require('./fuel-cards');
const { isSiteManager } = require('../auth');

const router = express.Router();

function monthStart() {
  return isoDate().slice(0, 8) + '01';
}

async function attentionList(plant, vehicles) {
  const items = [];
  const add = (asset, href, what, st) => {
    if (st.level === 'overdue' || st.level === 'soon') items.push({ asset, href, what, status: st });
  };
  for (const p of plant) {
    const name = `${p.plant_no} ${p.description}${p.location ? ' (' + p.location + ')' : ''}`;
    add(name, `/plant/${p.id}`, p.service.name || 'Service', p.service);
    add(name, `/plant/${p.id}`, INSPECTION_TYPES[p.inspection_type] || 'LOLER', p.loler);
    add(name, `/plant/${p.id}`, 'Weekly check', p.check);
  }
  for (const v of vehicles) {
    const name = `${v.reg}${v.driver_display ? ' (' + v.driver_display + ')' : ''}`;
    add(name, `/vehicles/${v.id}`, 'MOT', v.mot);
    add(name, `/vehicles/${v.id}`, 'Tax', v.tax);
    add(name, `/vehicles/${v.id}`, 'Service', v.service);
    add(name, `/vehicles/${v.id}`, 'Walk-around', v.walkaround);
  }
  for (const c of (await all(`${fuelCards.CARD_SQL} WHERE c.status = 'active' AND c.expiry IS NOT NULL`)).map(fuelCards.decorate)) {
    add(`${c.provider}${c.card_ref ? ' #' + c.card_ref : ''}${c.holder_display ? ' (' + c.holder_display + ')' : ''}`, `/fuel-cards/${c.id}/edit`, 'Fuel card expiry', c.expiryStatus);
  }
  return items.sort((a, b) => (a.status.level === b.status.level ? 0 : a.status.level === 'overdue' ? -1 : 1));
}

router.get('/', async (req, res) => {
  if (req.user.role !== 'admin') return await driverHome(req, res);

  const plant = await listPlant();
  const vehicles = await listVehicles();
  const count = (list, key, levels = ['overdue', 'soon']) => list.filter((x) => levels.includes(x[key].level)).length;
  const defects = await listDefects({ status: 'open' });
  const from = monthStart();
  const fuel = await all(`
    SELECT fuel_type, SUM(litres) AS litres, SUM(cost) AS cost, COUNT(*) AS fills,
      COUNT(*) FILTER (WHERE cost IS NULL) AS unpriced, COUNT(*) FILTER (WHERE verified = 0) AS unverified
    FROM fuel_entries WHERE fill_date >= ? GROUP BY fuel_type`, from);
  const fuelTotals = fuel.reduce((t, r) => ({
    litres: t.litres + (r.fuel_type === 'adblue' ? 0 : r.litres),
    adblue: t.adblue + (r.fuel_type === 'adblue' ? r.litres : 0),
    cost: t.cost + (r.cost || 0),
    unverified: t.unverified + r.unverified,
  }), { litres: 0, adblue: 0, cost: 0, unverified: 0 });
  const allUnverified = (await get('SELECT COUNT(*) AS n FROM fuel_entries WHERE verified = 0')).n;

  res.render('dashboard', {
    title: 'Dashboard',
    plant, vehicles, defects: defects.slice(0, 8),
    stats: {
      plantTotal: plant.length,
      plantService: count(plant, 'service'),
      plantServiceOverdue: count(plant, 'service', ['overdue']),
      plantLoler: count(plant, 'loler'),
      plantChecks: count(plant, 'check', ['overdue']),
      vehicleTotal: vehicles.length,
      mot: count(vehicles, 'mot'),
      tax: count(vehicles, 'tax'),
      vehicleService: count(vehicles, 'service'),
      walkaroundsDone: vehicles.filter((v) => v.walkaround.level === 'ok').length,
      walkaroundsExpected: vehicles.filter((v) => v.driver_id && v.status === 'active').length,
      defectsOpen: defects.length,
      defectsUnsafe: defects.filter((d) => d.severity === 'unsafe').length,
    },
    fuelTotals, allUnverified,
    attention: await attentionList(plant, vehicles),
  });
});

async function driverHome(req, res) {
  const vehicles = await listVehicles({ driverId: req.user.id });
  const fuel = await all(`
    SELECT f.*, v.reg FROM fuel_entries f JOIN vehicles v ON v.id = f.vehicle_id
    WHERE f.user_id = ? ORDER BY f.fill_date DESC, f.id DESC LIMIT 10`, req.user.id);
  const checks = await all(`
    SELECT * FROM (
    SELECT 'vehicle' AS type, c.id AS id, c.check_date AS check_date, c.defects_found AS defects_found, v.reg AS asset
      FROM vehicle_checks c JOIN vehicles v ON v.id = c.vehicle_id WHERE c.user_id = ?
    UNION ALL
    SELECT 'plant', c.id, c.check_date, c.defects_found, p.plant_no
      FROM plant_checks c JOIN plant p ON p.id = c.plant_id WHERE c.user_id = ?
    ) AS x ORDER BY check_date DESC, id DESC LIMIT 10`, req.user.id, req.user.id);
  const defects = await all(`SELECT * FROM defects WHERE reported_by = ? AND status = 'open' ORDER BY reported_at DESC`, req.user.id);
  // Site managers also get a summary of plant that needs attention.
  const plantAttention = isSiteManager(req.user)
    ? (await listPlant()).filter((p) => [p.service, p.loler, p.check].some((s) => s.level === 'overdue' || s.level === 'soon') || p.open_defects)
    : null;
  res.render('driver-home', { title: 'Home', vehicles, fuel, checks, defects, plantAttention });
}

module.exports = router;
