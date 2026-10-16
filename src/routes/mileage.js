const express = require('express');
const multer = require('multer');
const { all, get, run } = require('../db');
const { requireAdmin, UserError, text } = require('../auth');
const { isValidDate, addDays, isoDate } = require('../status');
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
  if (isValidDate(q.from) && isValidDate(q.to) && q.from <= q.to) return { from: q.from, to: q.to };
  const last = await get('SELECT date_from, date_to FROM mileage_uploads ORDER BY id DESC LIMIT 1');
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
  const byReg = new Map();
  for (const t of trips) {
    if (!byReg.has(t.reg)) byReg.set(t.reg, []);
    byReg.get(t.reg).push(t);
  }
  const vehicles = [...byReg].map(([r, ts]) => {
    const last = ts[ts.length - 1];
    const homes = last.driver_id ? places.filter((x) => x.kind === 'home' && x.user_id === last.driver_id) : [];
    const out = M.classify(ts, { homes, works });
    return {
      reg: r, regText: last.fleet_reg || M.fmtReg(r), device: last.device, vehicle_id: last.vehicle_id, driver_id: last.driver_id, driver_name: last.driver_name,
      trips: out, work: M.sum(out, 'work'), personal: M.sum(out, 'personal'), total: M.sum(out),
      idle: out.reduce((n, t) => n + (t.idle_secs || 0), 0), changed: out.filter((t) => t.override).length,
      sotrackName: last.device.split(/\s*-\s*/)[0].trim(),
      notOnFleet: !last.vehicle_id, needsHome: !!last.driver_id && !homes.length,
    };
  });
  vehicles.sort((a, b) => (!a.driver_name - !b.driver_name) || String(a.driver_name || a.device).localeCompare(String(b.driver_name || b.device)));
  return { vehicles, places };
}

router.get('/mileage', async (req, res) => {
  const p = await period(req.query);
  const { vehicles } = await mileageFor(p);
  const uploads = await all('SELECT * FROM mileage_uploads ORDER BY id DESC LIMIT 12');
  const totals = { work: M.sum(vehicles.flatMap((v) => v.trips), 'work'), personal: M.sum(vehicles.flatMap((v) => v.trips), 'personal'), trips: vehicles.reduce((n, v) => n + v.trips.length, 0) };
  res.render('mileage', { title: 'Mileage', p, qs: qs(p), vehicles, uploads, totals, M, placeCount: (await get('SELECT COUNT(*)::int AS n FROM mileage_places')).n });
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
  res.redirect(`/mileage?from=${dates[0]}&to=${dates[dates.length - 1]}`);
});

// Home and work addresses.
router.get('/mileage/addresses', async (req, res) => {
  const people = await all("SELECT id, name FROM users WHERE active = 1 AND (employee_type IS NOT NULL OR EXISTS (SELECT 1 FROM vehicles v WHERE v.driver_id = users.id)) ORDER BY name");
  res.render('mileage-addresses', { title: 'Home and work addresses', crumbs: [['Mileage', '/mileage'], ['Addresses']], navActive: '/mileage', places: await listPlaces(), people });
});

const backTo = (b) => (/^\/mileage(\/[A-Z0-9]+|\/addresses)?(\?[\w=&-]*)?$/.test(String(b || '')) ? String(b) : '/mileage/addresses');

router.post('/mileage/addresses', async (req, res) => {
  const kind = req.body.kind === 'home' ? 'home' : 'work';
  const address = text(req.body.address);
  if (!address) throw new UserError('Please enter the address, as SoTrack shows it, including the postcode.');
  if (!M.addressKey(address).postcode) throw new UserError('Please include the postcode, e.g. DN7 6AP. That is how trips are matched to the address.');
  const userId = kind === 'home' ? Number(req.body.user_id) : null;
  if (kind === 'home' && !(await get('SELECT id FROM users WHERE id = ?', userId))) throw new UserError('Please choose whose home this is.');
  await run('INSERT INTO mileage_places (kind, user_id, label, address) VALUES (?, ?, ?, ?)', kind, userId, kind === 'work' ? text(req.body.label) : null, address.slice(0, 300));
  req.flash('success', kind === 'home' ? 'Home address added. Personal miles have been worked out again.' : 'Work address added. Trips to it now count as work.');
  res.redirect(backTo(req.body.back));
});

router.post('/mileage/addresses/:id/remove', async (req, res) => {
  await run('DELETE FROM mileage_places WHERE id = ?', Number(req.params.id));
  req.flash('success', 'Address removed.');
  res.redirect(backTo(req.body.back));
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
    title: `${v.driver_name || v.device} – ${v.regText}`, crumbs: [['Mileage', `/mileage?${qs(p)}`], [v.regText]], navActive: '/mileage',
    p, qs: qs(p), v, days, M, back: `/mileage/${reg}?${qs(p)}`,
  });
});

module.exports = { router, mileageFor, period };
