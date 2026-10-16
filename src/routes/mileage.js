const express = require('express');
const multer = require('multer');
const { all, get, run } = require('../db');
const { requireAdmin, UserError, text } = require('../auth');
const { isValidDate, addDays, isoDate, ukDate } = require('../status');
const M = require('../mileage');

const router = express.Router();
router.use('/mileage', requireAdmin);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (/\.xlsx$/i.test(file.originalname) ? cb(null, true) : cb(new UserError('Please upload the Trip List as an Excel .xlsx file.'))),
}).single('file');

// The dates to show: from the address bar, else the latest upload, else the last 7 days.
async function period(q) {
  // The dashboard's uploaded-files picker sends the week as "from|to".
  if (typeof q.week === 'string' && q.week.includes('|')) { const [from, to] = q.week.split('|'); q = { from, to }; }
  if (isValidDate(q.from) && isValidDate(q.to) && q.from <= q.to) return { from: q.from, to: q.to };
  const last = await get('SELECT date_from, date_to FROM mileage_uploads ORDER BY date_from DESC, id DESC LIMIT 1');
  if (last) return { from: last.date_from, to: last.date_to };
  return { from: addDays(isoDate(), -6), to: isoDate() };
}
const qs = (p) => `from=${p.from}&to=${p.to}`;

const listPlaces = () => all(`SELECT p.*, u.name AS user_name FROM mileage_places p LEFT JOIN users u ON u.id = p.user_id
  ORDER BY p.kind DESC, u.name, p.label, p.address`);

// Every vehicle's trips in the period, split into work and personal.
async function mileageFor(p, reg) {
  const trips = await all(`SELECT t.*, COALESCE(t.user_id, v.driver_id) AS driver_id, u.name AS driver_name, v.reg AS fleet_reg
    FROM mileage_trips t LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN users u ON u.id = COALESCE(t.user_id, v.driver_id)
    WHERE t.started_at >= ? AND t.started_at < ?${reg ? ' AND t.reg = ?' : ''} ORDER BY t.reg, t.started_at`,
  ...[p.from, addDays(p.to, 1), ...(reg ? [reg] : [])]);
  const places = await listPlaces();
  const works = places.filter((x) => x.kind === 'work');
  const checks = new Map((await all(`SELECT c.reg, c.checked_at, u.name AS by_name FROM mileage_checks c LEFT JOIN users u ON u.id = c.user_id
    WHERE c.date_from = ? AND c.date_to = ?`, p.from, p.to)).map((c) => [c.reg, c]));
  const byReg = new Map();
  for (const t of trips) {
    if (!byReg.has(t.reg)) byReg.set(t.reg, []);
    byReg.get(t.reg).push(t);
  }
  const vehicles = [...byReg].map(([r, ts]) => {
    const last = ts[ts.length - 1];
    const homes = last.driver_id ? places.filter((x) => x.kind === 'home' && x.user_id === last.driver_id) : [];
    const out = M.classify(ts, { homes, works, unknowns: places.filter((x) => x.kind === 'unknown') });
    return {
      reg: r, regText: last.fleet_reg || M.fmtReg(r), device: last.device, vehicle_id: last.vehicle_id, driver_id: last.driver_id, driver_name: last.driver_name,
      trips: out, work: M.sum(out, 'work'), personal: M.sum(out, 'personal'), total: M.sum(out),
      idle: out.reduce((n, t) => n + (t.idle_secs || 0), 0), changed: out.filter((t) => t.override).length,
      checked: checks.get(r) || null,
      sotrackName: last.device.split(/\s*-\s*/)[0].trim(),
      notOnFleet: !last.vehicle_id, needsHome: !!last.driver_id && !homes.length,
    };
  });
  vehicles.sort((a, b) => (!a.driver_name - !b.driver_name) || String(a.driver_name || a.device).localeCompare(String(b.driver_name || b.device)));
  return { vehicles, places };
}

async function summary(q) {
  const p = await period(q);
  const { vehicles } = await mileageFor(p);
  const trips = vehicles.flatMap((v) => v.trips);
  const totals = { work: M.sum(trips, 'work'), personal: M.sum(trips, 'personal'), trips: trips.length, idle: vehicles.reduce((n, v) => n + v.idle, 0), checked: vehicles.filter((v) => v.checked).length };
  const uploads = await all('SELECT * FROM mileage_uploads ORDER BY id DESC LIMIT 12');
  return { p, qs: qs(p), vehicles, totals, uploads, M };
}
const who = (v) => v.driver_name || (v.notOnFleet ? v.device : `No driver (${v.regText})`);

// Dashboard: the week's top 5 for personal miles and idle time, and work against personal miles for each driver.
router.get('/mileage', async (req, res) => {
  const s = await summary(req.query);
  // The uploaded weeks, for the picker.
  const ranges = await all('SELECT DISTINCT date_from, date_to FROM mileage_uploads ORDER BY date_from, date_to');
  const named = s.vehicles.map((v) => ({ ...v, who: who(v) }));
  res.render('mileage-dashboard', {
    title: 'Mileage', ...s, weeks: ranges.slice().reverse(),
    topPersonal: named.filter((v) => v.personal > 0).sort((a, b) => b.personal - a.personal).slice(0, 5),
    topIdle: named.filter((v) => v.idle > 0).sort((a, b) => b.idle - a.idle).slice(0, 5),
    byDriver: named.filter((v) => v.total > 0).sort((a, b) => b.total - a.total),
  });
});

const weekLabel = (p) => `${ukDate(p.from)} to ${ukDate(p.to)}`;

// Weekly trips: one row for each week uploaded, newest first, with how far the checking has got.
router.get('/mileage/weeks', async (req, res) => {
  const ranges = await all(`SELECT m.date_from, m.date_to, COUNT(*)::int AS files, MAX(m.created_at) AS uploaded_at,
      (SELECT u.name FROM mileage_uploads x LEFT JOIN users u ON u.id = x.user_id WHERE x.date_from = m.date_from AND x.date_to = m.date_to ORDER BY x.id DESC LIMIT 1) AS uploaded_by
    FROM mileage_uploads m GROUP BY m.date_from, m.date_to ORDER BY m.date_from DESC, m.date_to DESC LIMIT 52`);
  const weeks = [];
  for (const r of ranges) {
    const p = { from: r.date_from, to: r.date_to };
    const { vehicles } = await mileageFor(p);
    const trips = vehicles.flatMap((v) => v.trips);
    weeks.push({ ...r, p, qs: qs(p), drivers: vehicles.length, checked: vehicles.filter((v) => v.checked).length, trips: trips.length, work: M.sum(trips, 'work'), personal: M.sum(trips, 'personal') });
  }
  res.render('mileage-weeks', { title: 'Weekly trips', weeks, M });
});

// One week: every driver's miles, with a tick for each once checked.
router.get('/mileage/drivers', async (req, res) => {
  const s = await summary(req.query);
  res.render('mileage', {
    title: `Week ${weekLabel(s.p)}`, crumbs: [['Weekly trips', '/mileage/weeks'], [weekLabel(s.p)]], navActive: '/mileage',
    ...s, placeCount: (await get('SELECT COUNT(*)::int AS n FROM mileage_places')).n,
  });
});

// Clear a week so it can be uploaded again: its trips, ticks and upload record.
router.post('/mileage/weeks/remove', async (req, res) => {
  const { from, to } = req.body;
  if (!isValidDate(from) || !isValidDate(to)) throw new UserError('Please choose the week to remove.');
  const gone = await run('DELETE FROM mileage_trips WHERE started_at >= ? AND started_at < ?', from, addDays(to, 1));
  await run('DELETE FROM mileage_checks WHERE date_from = ? AND date_to = ?', from, to);
  await run('DELETE FROM mileage_uploads WHERE date_from = ? AND date_to = ?', from, to);
  req.flash('success', `Week ${weekLabel({ from, to })} deleted (${gone.changes} trips). Upload its file again to start afresh.`);
  res.redirect('/mileage/weeks');
});

// Upload a Trip List. Trips already loaded (same vehicle and start time) are skipped, so overlapping files are fine.
router.post('/mileage/upload', upload, async (req, res) => {
  if (!req.file) throw new UserError('Please choose the Trip List file from SoTrack.');
  let trips;
  try { trips = await M.parseTripList(req.file.buffer); } catch (err) { throw new UserError(err.message); }
  const fleet = new Map((await all('SELECT id, reg, driver_id FROM vehicles')).map((v) => [M.normReg(v.reg), v]));
  const dates = trips.map((t) => t.started_at.slice(0, 10)).sort();
  const up = await run('INSERT INTO mileage_uploads (file_name, date_from, date_to, trips, user_id) VALUES (?, ?, ?, ?, ?)',
    String(req.file.originalname).slice(0, 200), dates[0], dates[dates.length - 1], trips.length, req.user.id);
  let added = 0;
  for (let i = 0; i < trips.length; i += 100) {
    const chunk = trips.slice(i, i + 100);
    const params = [];
    for (const t of chunk) {
      const v = fleet.get(t.reg);
      params.push(t.reg, t.device, v ? v.id : null, v ? v.driver_id : null, up.lastInsertRowid, t.started_at, t.ended_at, t.start_loc, t.end_loc, t.distance, t.trip_secs, t.idle_secs);
    }
    const rows = await all(`INSERT INTO mileage_trips (reg, device, vehicle_id, user_id, upload_id, started_at, ended_at, start_loc, end_loc, distance, trip_secs, idle_secs)
      VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')} ON CONFLICT (reg, started_at) DO NOTHING RETURNING id`, ...params);
    added += rows.length;
  }
  await run('UPDATE mileage_uploads SET added = ? WHERE id = ?', added, up.lastInsertRowid);
  const unknown = [...new Set(trips.filter((t) => !fleet.has(t.reg)).map((t) => t.reg))];
  const skipped = trips.length - added;
  req.flash('success', `${added} trip${added === 1 ? '' : 's'} added${skipped ? `, ${skipped} already loaded` : ''}.`
    + (unknown.length ? ` ${unknown.length} vehicle${unknown.length === 1 ? ' is' : 's are'} not on the Fleet register: ${unknown.map(M.fmtReg).join(', ')}.` : ''));
  res.redirect(`/mileage/drivers?from=${dates[0]}&to=${dates[dates.length - 1]}`);
});

// Home and work addresses.
// Addresses from the trips that aren't saved as a home or work address yet, most visited first.
function unsavedAddresses(vehicles) {
  const seen = new Map();
  const note = (loc, where, v, t) => {
    if (!loc || (where && where !== 'site')) return;
    const k = M.addressKey(loc);
    const key = k.postcode ? `${k.postcode}|${k.street}` : loc.toUpperCase();
    if (!seen.has(key)) seen.set(key, { address: loc, visits: 0, site: false, drivers: new Map(), last: '' });
    const a = seen.get(key);
    a.visits += 1;
    a.site ||= where === 'site';
    if (v.driver_id) a.drivers.set(v.driver_id, v.driver_name);
    if (t.started_at > a.last) a.last = t.started_at;
  };
  for (const v of vehicles) for (const t of v.trips) { note(t.start_loc, t.from, v, t); note(t.end_loc, t.to, v, t); }
  return [...seen.values()].map((a) => ({ ...a, drivers: [...a.drivers].map(([id, name]) => ({ id, name })) }))
    .sort((a, b) => (b.site - a.site) || (b.visits - a.visits));
}

const listPeople = () => all("SELECT id, name FROM users WHERE active = 1 AND (employee_type IS NOT NULL OR EXISTS (SELECT 1 FROM vehicles v WHERE v.driver_id = users.id)) ORDER BY name");

router.get('/mileage/addresses', async (req, res) => {
  const people = await listPeople();
  const p = await period(req.query);
  const { vehicles, places } = await mileageFor(p);
  const unsaved = unsavedAddresses(vehicles);
  // One list at a time: what still needs sorting, then the saved work, home and unknown addresses.
  const show = ['sort', 'work', 'home', 'unknown'].includes(req.query.show) ? req.query.show : unsaved.length ? 'sort' : 'work';
  res.render('mileage-addresses', {
    title: 'Addresses', navActive: '/mileage',
    places, people, p, qs: qs(p), unsaved, show, back: `/mileage/addresses?${qs(p)}&show=${show}`,
  });
});

// Tick a driver's trips for the period as checked, or untick them.
router.post('/mileage/check', async (req, res) => {
  const reg = M.normReg(req.body.reg);
  const p = { from: req.body.from, to: req.body.to };
  if (!reg || !isValidDate(p.from) || !isValidDate(p.to)) throw new UserError('Please choose the vehicle and dates to tick off.');
  if (req.body.checked === '1') {
    await run('INSERT INTO mileage_checks (reg, date_from, date_to, user_id) VALUES (?, ?, ?, ?) ON CONFLICT (reg, date_from, date_to) DO NOTHING', reg, p.from, p.to, req.user.id);
  } else {
    await run('DELETE FROM mileage_checks WHERE reg = ? AND date_from = ? AND date_to = ?', reg, p.from, p.to);
  }
  res.redirect(backTo(req.body.back));
});

// After saving from a trip, go back to that trip rather than the top of the page.
const backAt = (req) => backTo(req.body.back) + (/^\d+$/.test(String(req.body.at || '')) ? `#trip-${req.body.at}` : '');
const backTo = (b) => (/^\/mileage(\/[A-Z0-9]+|\/addresses|\/drivers|\/weeks)?(\?[\w=&-]*)?$/.test(String(b || '')) ? String(b) : '/mileage/addresses');

router.post('/mileage/addresses', async (req, res) => {
  const kind = ['home', 'unknown'].includes(req.body.kind) ? req.body.kind : 'work';
  const address = text(req.body.address);
  if (!address) throw new UserError('Please enter the address, as SoTrack shows it, including the postcode.');
  if (!M.addressKey(address).postcode) throw new UserError('Please include the postcode, e.g. DN7 6AP. That is how trips are matched to the address.');
  const userId = kind === 'home' ? Number(req.body.user_id) : null;
  if (kind === 'home' && !(await get('SELECT id FROM users WHERE id = ?', userId))) throw new UserError('Please choose whose home this is.');
  await run('INSERT INTO mileage_places (kind, user_id, label, address) VALUES (?, ?, ?, ?)', kind, userId, kind !== 'home' ? text(req.body.label) : null, address.slice(0, 300));
  req.flash('success', { home: 'Home address added. Personal miles have been worked out again.', work: 'Work address added. Trips to it now count as work.', unknown: 'Saved as an unknown address. Trips to or from it now count as personal miles. It is listed under Unknown addresses so you can ask the driver.' }[kind]);
  res.redirect(backAt(req));
});

// Change a saved address: what it is, whose home, its name, or the address itself.
router.post('/mileage/addresses/:id', async (req, res) => {
  const place = await get('SELECT id FROM mileage_places WHERE id = ?', Number(req.params.id));
  if (!place) throw new UserError('Address not found.', 404);
  const kind = ['home', 'unknown'].includes(req.body.kind) ? req.body.kind : 'work';
  const address = text(req.body.address);
  if (!address || !M.addressKey(address).postcode) throw new UserError('Please keep the postcode in the address, e.g. DN7 6AP. That is how trips are matched to it.');
  const userId = kind === 'home' ? Number(req.body.user_id) : null;
  if (kind === 'home' && !(await get('SELECT id FROM users WHERE id = ?', userId))) throw new UserError('Please choose whose home this is.');
  await run('UPDATE mileage_places SET kind = ?, user_id = ?, label = ?, address = ? WHERE id = ?', kind, userId, kind !== 'home' ? text(req.body.label) : null, address.slice(0, 300), place.id);
  req.flash('success', 'Address updated. Trips have been worked out again.');
  res.redirect(backAt(req));
});

router.post('/mileage/addresses/:id/remove', async (req, res) => {
  await run('DELETE FROM mileage_places WHERE id = ?', Number(req.params.id));
  req.flash('success', 'Address removed.');
  res.redirect(backAt(req));
});

// Change one trip to work or personal, or back to how it was worked out.
router.post('/mileage/trips/:id', async (req, res) => {
  const use = ['work', 'personal'].includes(req.body.use) ? req.body.use : null;
  const trip = await get('SELECT id, reg FROM mileage_trips WHERE id = ?', Number(req.params.id));
  if (!trip) throw new UserError('Trip not found.', 404);
  await run('UPDATE mileage_trips SET override = ? WHERE id = ?', use, trip.id);
  res.redirect(backTo(req.body.back) + `#trip-${trip.id}`);
});

// One vehicle's trips, day by day.
router.get('/mileage/:reg', async (req, res) => {
  const reg = M.normReg(req.params.reg);
  const p = await period(req.query);
  const { vehicles } = await mileageFor(p, reg);
  const v = vehicles[0];
  if (!v) throw new UserError('No trips for that vehicle in these dates.', 404);
  const days = [];
  for (const t of v.trips) {
    const d = t.started_at.slice(0, 10);
    if (!days.length || days[days.length - 1].date !== d) days.push({ date: d, trips: [] });
    days[days.length - 1].trips.push(t);
  }
  res.render('mileage-vehicle', {
    people: await listPeople(),
    title: `${v.driver_name || v.device} – ${v.regText}`, crumbs: [['Weekly trips', '/mileage/weeks'], [weekLabel(p), `/mileage/drivers?${qs(p)}`], [v.regText]], navActive: '/mileage',
    p, qs: qs(p), v, days, M, back: `/mileage/${reg}?${qs(p)}`,
  });
});

module.exports = { router, mileageFor, period };
