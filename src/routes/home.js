const express = require('express');
const { all, get } = require('../db');
const { listPlant, listVehicles, listDefects } = require('../queries');
const { isoDate, addMonths, addDays, ukDate } = require('../status');
const { INSPECTION_TYPES, CATEGORY } = require('../categories');
const fuelCards = require('./fuel-cards');
const { isAdmin, isSiteManager, plantFor } = require('../auth');

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

// Site managers get the same list for their own plant and vehicles, with links they can use (the office does the rest).
async function todoList(plant, vehicles, defects, receipts, { admin = true } = {}) {
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
      href: `${assetHref(d)}#def-${d.id}`, action: admin ? 'Resolve' : 'View', primary: d.severity !== 'minor', defect: true,
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
    // Only the office records services and tests; site managers get a link to the item.
    due(p.service, title, p.service.text + where, admin ? `/plant/${p.id}#record-service` : `/plant/${p.id}`, admin ? 'Record service' : 'View');
    // Never inspected: rolled up into one line, as a new register can have dozens of these.
    if (p.loler.level === 'overdue' && !p.loler.due) noInspection.push(p.plant_no);
    else due(p.loler, title, `${INSPECTION_TYPES[p.inspection_type] || 'LOLER'}: ${p.loler.text}${where}`, admin ? `/plant/${p.id}#record-loler` : `/plant/${p.id}`, admin ? 'Record test' : 'View');
    if (p.check.level === 'overdue') checksOver.push(p.plant_no);
    else if (p.check.level === 'soon') checksSoon.push(p.plant_no);
  }
  const walkMissing = [];
  for (const v of vehicles) {
    const title = [v.make, v.model].filter(Boolean).join(' ');
    const who = v.driver_display ? ` · ${v.driver_display}` : '';
    for (const key of ['mot', 'tax', 'service']) {
      const [action, kind] = VEHICLE_ACTIONS[key];
      due(v[key], title, `${key === 'mot' ? 'MOT' : key === 'tax' ? 'Road tax' : 'Service'}: ${v[key].text}${who}`, admin ? `/vehicles/${v.id}#record-${kind}` : `/vehicles/${v.id}`, admin ? action : 'View', { reg: v.reg });
    }
    if (v.walkaround.level === 'overdue') walkMissing.push(v.reg);
  }
  for (const c of (admin ? await all(`${fuelCards.CARD_SQL} WHERE c.status = 'active' AND c.expiry IS NOT NULL`) : []).map(fuelCards.decorate)) {
    due(c.expiryStatus, `${c.provider}${c.card_ref ? ' #' + c.card_ref : ''} fuel card`, `Expiry: ${c.expiryStatus.text}${c.holder_display ? ' · ' + c.holder_display : ''}`, `/fuel-cards/${c.id}/edit`, 'Update card');
  }
  if (noInspection.length) push('now', 'bad', 2.5, { count: noInspection.length, title: `${noInspection.length} item${noInspection.length === 1 ? '' : 's'} with no inspection recorded`, detail: listNames(noInspection), href: '/plant?filter=attention', action: 'View' });
  if (checksOver.length) push('now', 'warn', 4, { count: checksOver.length, title: `${checksOver.length} plant check sheet${checksOver.length === 1 ? '' : 's'} overdue`, detail: listNames(checksOver), href: admin ? '/checks?type=plant' : '/checks/plant/new', action: admin ? 'View' : 'Do checks' });
  if (walkMissing.length) push('now', 'warn', 5, { count: walkMissing.length, title: `${walkMissing.length} walk-around${walkMissing.length === 1 ? '' : 's'} not done today`, detail: listNames(walkMissing), href: admin ? '/checks?type=vehicle' : '/checks/vehicle/new', action: admin ? 'View' : 'Do walk-around' });
  if (checksSoon.length) push('soon', 'warn', 6, { count: checksSoon.length, title: `${checksSoon.length} plant check sheet${checksSoon.length === 1 ? '' : 's'} due this week`, detail: listNames(checksSoon), href: admin ? '/checks?type=plant' : '/checks/plant/new', action: admin ? 'View' : 'Do checks' });
  // Tabs: Defects, Overdue and Coming up. A rolled-up line counts every item it stands for, so tiles and tabs agree.
  for (const t of items) { t.tab = t.defect ? 'defects' : t.when === 'now' ? 'overdue' : 'soon'; t.count = t.count || 1; }
  return items.sort((a, b) => (a.when !== b.when ? (a.when === 'now' ? -1 : 1) : a.rank - b.rank || String(a.sort || '').localeCompare(String(b.sort || ''))));
}

// Everything with a due date, for the Dashboard calendar: inspections, MOT, tax, vehicle services and fuel card expiries.
// Hours-based plant services have no date, so they only show when a calendar backstop date applies.
async function calendarEvents(plant, vehicles, user) {
  const admin = isAdmin(user);
  const out = [];
  const add = (st, title, kind, href, reg = null) => { if (st && st.due) out.push({ d: String(st.due).slice(0, 10), t: title, k: kind, h: href, r: reg }); };
  for (const p of plant) {
    add(p.loler, `${p.plant_no} · ${p.description}`, INSPECTION_TYPES[p.inspection_type] || 'LOLER', `/plant/${p.id}#record-loler`);
    add(p.service, `${p.plant_no} · ${p.description}`, p.service.name || 'Service', `/plant/${p.id}#record-service`);
  }
  for (const v of vehicles) {
    const title = [v.make, v.model].filter(Boolean).join(' ');
    add(v.mot, title, 'MOT', `/vehicles/${v.id}#record-mot`, v.reg);
    add(v.tax, title, 'Road tax', `/vehicles/${v.id}#record-tax`, v.reg);
    add(v.service, title, 'Service', `/vehicles/${v.id}#record-service`, v.reg);
  }
  const cards = await all(`${fuelCards.CARD_SQL} WHERE c.status = 'active' AND c.expiry IS NOT NULL ${admin ? '' : 'AND c.user_id = ?'}`, ...(admin ? [] : [user.id]));
  for (const c of cards.map(fuelCards.decorate)) {
    add(c.expiryStatus, `${c.provider}${c.card_ref ? ' #' + c.card_ref : ''} fuel card${c.holder_display ? ' · ' + c.holder_display : ''}`, 'Card expires', admin ? `/fuel-cards/${c.id}/edit` : '/');
  }
  // Planned repairs stay on the calendar until they are marked as done.
  const repairs = await all(`SELECT r.id, r.asset_type, r.asset_id, r.record_date, r.notes, p.plant_no, p.description, v.reg, v.make, v.model
    FROM service_records r
    LEFT JOIN plant p ON r.asset_type = 'plant' AND p.id = r.asset_id
    LEFT JOIN vehicles v ON r.asset_type = 'vehicle' AND v.id = r.asset_id
    WHERE r.planned = 1 AND (p.id IS NOT NULL OR v.id IS NOT NULL)`);
  const plantIds = new Set(plant.map((p) => p.id)), vehicleIds = new Set(vehicles.map((v) => v.id));
  for (const r of repairs.filter((x) => (x.asset_type === 'plant' ? plantIds : vehicleIds).has(x.asset_id))) {
    const what = r.notes ? ` · ${r.notes}` : '';
    if (r.asset_type === 'plant') out.push({ d: r.record_date, t: `${r.plant_no} · ${r.description}${what}`, k: 'Planned repair', h: `/plant/${r.asset_id}#rec-${r.id}`, r: null });
    else out.push({ d: r.record_date, t: [r.make, r.model].filter(Boolean).join(' ') + what, k: 'Planned repair', h: `/vehicles/${r.asset_id}#rec-${r.id}`, r: r.reg });
  }
  return out.sort((a, b) => a.d.localeCompare(b.d));
}

// What a dashboard covers: everything for admins; for a site manager, the plant on their projects and their own vehicles.
async function scope(user) {
  if (isAdmin(user)) return { plant: await listPlant(), vehicles: await listVehicles(), defects: await listDefects({ status: 'open' }) };
  const plant = plantFor(user, await listPlant());
  const vehicles = await listVehicles({ driverId: user.id });
  const ids = { plant: new Set(plant.map((p) => p.id)), vehicle: new Set(vehicles.map((v) => v.id)) };
  const defects = (await listDefects({ status: 'open' })).filter((d) => ids[d.asset_type] && ids[d.asset_type].has(d.asset_id));
  return { plant, vehicles, defects };
}

router.get('/', async (req, res) => {
  const manager = isSiteManager(req.user);
  if (!isAdmin(req.user) && !manager) return await driverHome(req, res);

  const { plant, vehicles, defects } = await scope(req.user);
  const receipts = manager ? { n: 0, cost: 0 } : await get(`SELECT COUNT(*) AS n, MIN(fill_date) AS oldest, COUNT(*) FILTER (WHERE cost IS NULL OR cost = 0) AS unpriced, COALESCE(SUM(cost), 0) AS cost
    FROM fuel_entries WHERE verified = 0`);
  const todo = await todoList(plant, vehicles, defects, receipts, { admin: !manager });
  // A site manager's own fuel cards, shown beside their vehicle.
  const myCards = manager ? (await all(`${fuelCards.CARD_SQL} WHERE c.user_id = ? AND c.status = 'active' ORDER BY c.provider, c.card_ref`, req.user.id)).map(fuelCards.decorate) : [];
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
  // Plant check sheets run weekly, Monday to Sunday: count machines with a sheet since this Monday.
  const today = isoDate();
  const monday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));

  res.render('dashboard', {
    title: 'Dashboard',
    todo, months, manager, myCards, myVehicles: manager ? vehicles : [], projects: req.user.projects || [],
    stats: {
      plantTotal: plant.length,
      // Split the same way as the Plant and Equipment pages.
      plantOnly: plant.filter((p) => (CATEGORY[p.category] || CATEGORY.misc).section === 'plant').length,
      vehicleTotal: vehicles.length,
      unsafe: defects.filter((d) => d.severity === 'unsafe').length,
      overdue: todo.filter((t) => t.tab === 'overdue').reduce((n, t) => n + t.count, 0),
      dueSoon: todo.filter((t) => t.tab === 'soon').reduce((n, t) => n + t.count, 0),
      receipts: receipts.n, receiptsCost: receipts.cost,
      walkaroundsDone: vehicles.filter((v) => v.walkaround.level === 'ok').length,
      walkaroundsExpected: vehicles.filter((v) => v.driver_id && v.status === 'active').length,
      checksWeek: checkable.filter((p) => p.last_check && String(p.last_check).slice(0, 10) >= monday).length, checksExpected: checkable.length,
      defectsOpen: defects.length,
    },
  });
});

// Calendar page (admins): every due date on a week or month view.
router.get('/calendar', async (req, res) => {
  if (!isAdmin(req.user) && !isSiteManager(req.user)) return res.redirect('/');
  const { plant, vehicles } = await scope(req.user);
  res.render('calendar', { title: 'Calendar', calendar: await calendarEvents(plant, vehicles, req.user) });
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
