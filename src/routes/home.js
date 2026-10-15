const express = require('express');
const { all, get } = require('../db');
const { listPlant, listVehicles, listDefects } = require('../queries');
const { isoDate, addMonths, ukDate } = require('../status');
const { INSPECTION_TYPES } = require('../categories');
const fuelCards = require('./fuel-cards');
const { isSiteManager } = require('../auth');

const router = express.Router();

function monthStart() {
  return isoDate().slice(0, 8) + '01';
}

// The Dashboard's to-do list: everything that needs the office, most urgent first.
// "Now" is unsafe or major defects and anything overdue; "Coming up" is what falls due in the next 30 days.
// Weekly plant checks and walk-arounds are rolled up into one line each so they don't swamp the list.
const PLANT_ACTIONS = { service: ['Record service', 'service'], loler: ['Record test', 'loler'] };
const VEHICLE_ACTIONS = { mot: ['Update MOT', 'mot'], tax: ['Update tax', 'tax'], service: ['Record service', 'service'] };
const listNames = (names) => names.slice(0, 6).join(', ') + (names.length > 6 ? ` and ${names.length - 6} more` : '');

async function todoList(plant, vehicles, defects, receipts) {
  const items = [];
  const push = (when, level, rank, item) => items.push({ when, level, rank, ...item });
  const assetHref = (d) => `/${d.asset_type === 'plant' ? 'plant' : 'vehicles'}/${d.asset_id}`;
  for (const d of defects) {
    // Vehicle names come back as "REG – Make Model": the reg is shown as a number plate.
    const [reg, ...rest] = d.asset_type === 'vehicle' ? String(d.asset_name || '').split(' – ') : [null];
    const when = d.severity === 'minor' ? 'soon' : 'now';
    push(when, d.severity === 'unsafe' ? 'bad' : 'warn', d.severity === 'unsafe' ? 0 : 1, {
      title: reg ? rest.join(' – ') : String(d.asset_name || '').replace(' – ', ' · '), reg,
      detail: `${d.severity === 'unsafe' ? 'Unsafe' : d.severity === 'major' ? 'Major defect' : 'Minor defect'}: ${d.description} · reported${d.reported_by_name ? ' by ' + d.reported_by_name : ''} ${ukDate(d.reported_at)}`,
      href: `${assetHref(d)}#def-${d.id}`, action: 'Resolve', primary: d.severity !== 'minor',
    });
  }
  const due = (st, title, detail, href, action, extra = {}) => {
    if (st.level !== 'overdue' && st.level !== 'soon') return;
    const over = st.level === 'overdue';
    push(over ? 'now' : 'soon', over ? 'bad' : 'warn', over ? 2 : 3, { title, detail, href, action, sort: st.due || '', ...extra });
  };
  const checksOver = [], checksSoon = [], noInspection = [];
  for (const p of plant) {
    const title = `${p.plant_no} · ${p.description}`;
    const where = p.job_ref ? ` · Project ${p.job_ref}` : '';
    due(p.service, title, p.service.text + where, `/plant/${p.id}#record-service`, 'Record service');
    // Never inspected: rolled up into one line, as a new register can have dozens of these.
    if (p.loler.level === 'overdue' && !p.loler.due) noInspection.push(p.plant_no);
    else due(p.loler, title, `${INSPECTION_TYPES[p.inspection_type] || 'LOLER'}: ${p.loler.text}${where}`, `/plant/${p.id}#record-loler`, 'Record test');
    if (p.check.level === 'overdue') checksOver.push(p.plant_no);
    else if (p.check.level === 'soon') checksSoon.push(p.plant_no);
  }
  const walkMissing = [];
  for (const v of vehicles) {
    const title = [v.make, v.model].filter(Boolean).join(' ');
    const who = v.driver_display ? ` · ${v.driver_display}` : '';
    for (const key of ['mot', 'tax', 'service']) {
      const [action, kind] = VEHICLE_ACTIONS[key];
      due(v[key], title, `${key === 'mot' ? 'MOT' : key === 'tax' ? 'Road tax' : 'Service'}: ${v[key].text}${who}`, `/vehicles/${v.id}#record-${kind}`, action, { reg: v.reg });
    }
    if (v.walkaround.level === 'overdue') walkMissing.push(v.reg);
  }
  for (const c of (await all(`${fuelCards.CARD_SQL} WHERE c.status = 'active' AND c.expiry IS NOT NULL`)).map(fuelCards.decorate)) {
    due(c.expiryStatus, `${c.provider}${c.card_ref ? ' #' + c.card_ref : ''} fuel card`, `Expiry: ${c.expiryStatus.text}${c.holder_display ? ' · ' + c.holder_display : ''}`, `/fuel-cards/${c.id}/edit`, 'Update card');
  }
  if (noInspection.length) push('now', 'bad', 2.5, { count: noInspection.length, title: `${noInspection.length} item${noInspection.length === 1 ? '' : 's'} with no inspection recorded`, detail: listNames(noInspection), href: '/plant?filter=attention', action: 'View' });
  if (checksOver.length) push('now', 'warn', 4, { count: checksOver.length, title: `${checksOver.length} plant check sheet${checksOver.length === 1 ? '' : 's'} overdue`, detail: listNames(checksOver), href: '/checks?type=plant', action: 'View' });
  if (walkMissing.length) push('now', 'warn', 5, { count: walkMissing.length, title: `${walkMissing.length} walk-around${walkMissing.length === 1 ? '' : 's'} not done today`, detail: listNames(walkMissing), href: '/checks?type=vehicle', action: 'View' });
  if (checksSoon.length) push('soon', 'warn', 6, { count: checksSoon.length, title: `${checksSoon.length} plant check sheet${checksSoon.length === 1 ? '' : 's'} due this week`, detail: listNames(checksSoon), href: '/checks?type=plant', action: 'View' });
  // Tabs: Defects, Overdue and Coming up. A rolled-up line counts every item it stands for, so tiles and tabs agree.
  for (const t of items) { t.tab = t.action === 'Resolve' ? 'defects' : t.when === 'now' ? 'overdue' : 'soon'; t.count = t.count || 1; }
  return items.sort((a, b) => (a.when !== b.when ? (a.when === 'now' ? -1 : 1) : a.rank - b.rank || String(a.sort || '').localeCompare(String(b.sort || ''))));
}

router.get('/', async (req, res) => {
  if (req.user.role !== 'admin') return await driverHome(req, res);

  const plant = await listPlant();
  const vehicles = await listVehicles();
  const defects = await listDefects({ status: 'open' });
  const receipts = await get(`SELECT COUNT(*) AS n, MIN(fill_date) AS oldest, COUNT(*) FILTER (WHERE cost IS NULL OR cost = 0) AS unpriced, COALESCE(SUM(cost), 0) AS cost
    FROM fuel_entries WHERE verified = 0`);
  const todo = await todoList(plant, vehicles, defects, receipts);
  // Litres per month for the last 6 months (diesel and unleaded; AdBlue is separate).
  const from = addMonths(monthStart(), -5);
  const rows = await all(`SELECT substr(fill_date, 1, 7) AS ym, SUM(litres) FILTER (WHERE fuel_type <> 'adblue') AS litres, SUM(cost) AS cost
    FROM fuel_entries WHERE fill_date >= ? GROUP BY 1`, from);
  const months = Array.from({ length: 6 }, (_, i) => {
    const ym = addMonths(from, i).slice(0, 7);
    const r = rows.find((x) => x.ym === ym) || {};
    return { ym, label: new Date(`${ym}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short' }), litres: Number(r.litres || 0), cost: Number(r.cost || 0) };
  });
  const checkable = plant.filter((p) => p.check.level !== 'none');

  res.render('dashboard', {
    title: 'Dashboard',
    todo, months,
    stats: {
      plantTotal: plant.length,
      vehicleTotal: vehicles.length,
      unsafe: defects.filter((d) => d.severity === 'unsafe').length,
      overdue: todo.filter((t) => t.tab === 'overdue').reduce((n, t) => n + t.count, 0),
      dueSoon: todo.filter((t) => t.tab === 'soon').reduce((n, t) => n + t.count, 0),
      receipts: receipts.n, receiptsCost: receipts.cost,
      walkaroundsDone: vehicles.filter((v) => v.walkaround.level === 'ok').length,
      walkaroundsExpected: vehicles.filter((v) => v.driver_id && v.status === 'active').length,
      checksOk: checkable.filter((p) => p.check.level === 'ok').length, checksExpected: checkable.length,
      defectsOpen: defects.length,
    },
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
