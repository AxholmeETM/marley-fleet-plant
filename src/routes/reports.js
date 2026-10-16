const express = require('express');
const { all, get } = require('../db');
const { listPlant, listVehicles } = require('../queries');
const { requireAdmin, isAdmin } = require('../auth');
const { ukDate, fmtHours } = require('../status');
const { decorate: decorateCard } = require('./fuel-cards');
const { CATEGORIES, CATEGORY, PLANT_STATUSES, INSPECTION_TYPES, VEHICLE_CATEGORIES, VEHICLE_STATUSES, FUEL_CARD_STATUSES, EMPLOYEE_TYPES, userLabel, CSCS_CARDS, cscsLabel, recordCard } = require('../categories');
const { cellStatus } = require('./training');
const { listDocs, DOC_KINDS } = require('../documents');
const { mileageFor, period: mileagePeriod } = require('./mileage');
const M = require('../mileage');

const router = express.Router();
router.use('/reports', requireAdmin);

// Each report is a table (optionally split under headings) laid out for A4 and saved as a PDF from the browser.
// A cell is plain text, or { pill } for a coloured status, or { reg } for a number plate.
const pill = (level, text) => ({ pill: { level, text } });
const due = (s) => (s && s.level !== 'none' ? pill(s.level, s.text) : '—');
const num = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString('en-GB'));

function plantRows(items) {
  return items.map((p) => [
    p.plant_no,
    p.description + (p.serial_no ? ` · S/N ${p.serial_no}` : ''),
    CATEGORY[p.category] ? CATEGORY[p.category].label : p.category,
    p.job_ref ? p.job_ref + (p.project_name ? ` – ${p.project_name}` : '') : '—',
    p.tracks_hours ? fmtHours(p.running_hours) : '—',
    p.tracks_hours ? due(p.service) : (p.last_service_date ? `Last ${ukDate(p.last_service_date)}` : '—'),
    p.weekly_checks ? due(p.check) : '—',
    p.loler && p.loler.level !== 'none' ? { ...due(p.loler), sub: INSPECTION_TYPES[p.inspection_type] } : '—',
    pill(p.status === 'in_use' ? 'ok' : ['stolen', 'repair'].includes(p.status) ? 'overdue' : 'none', (p.status === 'in_use' ? 'In use' : PLANT_STATUSES[p.status] || p.status) + (p.open_defects ? ` · ${p.open_defects} defect${p.open_defects > 1 ? 's' : ''}` : '')),
  ]);
}

async function plantReport(section) {
  const plant = (await listPlant()).filter((p) => (CATEGORY[p.category] || CATEGORY.misc).section === section);
  const groups = CATEGORIES.filter((c) => c.section === section)
    .map((c) => ({ label: c.label, rows: plantRows(plant.filter((p) => p.category === c.key)) }))
    .filter((g) => g.rows.length);
  return {
    title: section === 'plant' ? 'Plant report' : 'Equipment report',
    count: `${plant.length} item${plant.length === 1 ? '' : 's'}`,
    columns: ['Asset no', 'Description', 'Category', 'Project No.', 'Service hours', 'Service', 'Site check', 'Inspection', 'Status'],
    widths: [11, 20, 10, 12, 8, 11, 10, 10, 8],
    groups,
  };
}

// Everyone on the Training Matrix, for the Training report's employee picker.
const matrixPeople = () => all('SELECT id, name, role, employee_type FROM users WHERE active = 1 AND (employee_type IS NOT NULL OR on_matrix = 1) ORDER BY name');

// The Training report: for each chosen person, their training from the Training Matrix (what they hold, what is due or
// expired, what they need) and copies of their cards, each person on their own pages. "Everyone" is one summary table.
async function trainingReport({ query }) {
  const everyone = [].concat(query.person || []).includes('all');
  const ids = [...new Set([].concat(query.person || []).map(Number).filter(Boolean))];
  const people = everyone ? await all('SELECT * FROM users WHERE active = 1 AND (employee_type IS NOT NULL OR on_matrix = 1) ORDER BY name')
    : ids.length ? await all(`SELECT * FROM users WHERE id IN (${ids.map(() => '?').join(', ')}) ORDER BY name`, ...ids) : [];
  const courses = await all('SELECT * FROM training_courses WHERE active = 1 ORDER BY sort, id');
  const recs = people.length ? await all(`SELECT * FROM training_records WHERE user_id IN (${people.map(() => '?').join(', ')})`, ...people.map((p) => p.id)) : [];
  const recOf = new Map(recs.map((r) => [`${r.user_id}:${r.course_id}`, r]));
  const LEVEL = { ok: 'ok', soon: 'soon', overdue: 'overdue', needed: 'none', note: 'none' };
  const rowsFor = (p, list, withGroup) => list.map((c) => {
    const r = recOf.get(`${p.id}:${c.id}`);
    const s = cellStatus(r);
    if (!s) return null;
    const rc = recordCard(c.grp, r.card);
    const card = c.key === 'cscs' ? (CSCS_CARDS[p.cscs_card] ? cscsLabel(p.cscs_card) : '—') : (rc ? `${rc.label} · ${rc.name}` : '—');
    return [...(withGroup ? [c.grp] : []), c.name, c.code || '—', card, r.expiry ? ukDate(r.expiry) : '—',
      pill(LEVEL[s.level], s.level === 'ok' ? 'In date' : s.level === 'soon' ? 'Due soon' : s.level === 'overdue' ? 'Expired' : s.level === 'needed' ? 'Needed' : 'Note'), r.note || '—'];
  }).filter(Boolean);
  if (everyone) {
    const groups = people.map((p) => ({ label: `${p.name} · ${userLabel(p)}`, rows: rowsFor(p, courses, true) })).filter((g) => g.rows.length);
    return { title: 'Training report – everyone', count: `${people.length} people`,
      columns: ['Group', 'Training', 'Code', 'Card', 'Expiry', 'Status', 'Note'], widths: [8, 28, 11, 20, 9, 9, 15], groups };
  }
  if (!people.length) return { title: 'Training report', count: 'Choose who to include', columns: ['Training'], widths: [100], groups: [] };
  const sections = [];
  for (const p of people) {
    const groups = ['General', 'NPORS', 'CPCS'].map((g) => ({ label: g, rows: rowsFor(p, courses.filter((c) => c.grp === g), false) })).filter((g) => g.rows.length);
    const held = groups.flatMap((g) => g.rows).filter((r) => r[4].pill && ['ok', 'soon'].includes(r[4].pill.level)).length;
    // Their uploaded card copies and certificates go after their table: photos printed in full, PDFs listed by name.
    const attachments = (await listDocs('person', p.id)).map((d) => ({ id: d.id, name: d.name, kind: DOC_KINDS.person[d.kind] || d.kind, date: ukDate(d.created_at), image: !/\.pdf$/i.test(d.file) }));
    sections.push({
      title: `Training report – ${p.name}`, sub: [userLabel(p), p.job_title, p.employee_no ? `Employee ID ${p.employee_no}` : '', p.training_funded ? `Training paid for: ${p.training_funded}` : ''].filter(Boolean).join(' · '),
      count: `${held} held`, columns: ['Training', 'Code', 'Card', 'Expiry', 'Status', 'Note'], widths: [30, 12, 22, 10, 10, 16], groups, attachments,
    });
  }
  return sections.length === 1 ? sections[0] : { title: `Training report – ${sections.length} people`, sections };
}

const REPORTS = {
  plant: { label: 'Plant', blurb: 'All plant, grouped by category, with project, hours, service, site check, inspection and status.', build: () => plantReport('plant') },
  fleet: {
    label: 'Fleet', blurb: 'Every vehicle in one list, with driver, mileage, service, MOT and tax.',
    async build() {
      const vehicles = await listVehicles();
      return {
        title: 'Fleet report', count: `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}`,
        columns: ['Reg', 'Asset no', 'Vehicle', 'Type', 'Driver', 'Mileage', 'Service', 'MOT', 'Tax', 'Status'],
        widths: [9, 10, 18, 10, 13, 7, 9, 9, 9, 6],
        groups: [{ rows: vehicles.map((v) => [{ reg: v.reg }, v.asset_no || '—', [v.make, v.model].filter(Boolean).join(' ') || '—', VEHICLE_CATEGORIES[v.category] || '—',
          v.driver_display || '—', num(v.mileage), due(v.service), due(v.mot), due(v.tax), pill(v.status === 'active' ? 'ok' : 'none', VEHICLE_STATUSES[v.status] || v.status)]) }],
      };
    },
  },
  'fuel-cards': {
    label: 'Fuel Cards', blurb: 'All fuel cards by company, with the employee, vehicle, expiry and status. Shows the full card numbers, never PINs.',
    // Full card numbers are for admins; managers see the last four digits.
    async build({ full }) {
      const cards = (await all(`SELECT c.*, v.reg, u.name AS user_name FROM fuel_cards c LEFT JOIN vehicles v ON v.id = c.vehicle_id LEFT JOIN users u ON u.id = c.user_id
        ORDER BY c.provider, c.status <> 'active', CASE WHEN c.card_ref ~ '^[0-9]+$' THEN c.card_ref::numeric END, c.card_ref`)).map(decorateCard);
      const groups = [...new Set(cards.map((c) => c.provider))].map((p) => ({ label: p, rows: cards.filter((c) => c.provider === p).map((c) => {
        const exp = c.expiry ? c.expiryStatus : null;
        return [c.card_ref ? '#' + c.card_ref : '—', full && c.card_number ? c.card_number.replace(/(.{4})(?=.)/g, '$1 ') : c.last4 ? '•••• ' + c.last4 : '—', c.user_name || c.holder || '—', c.reg ? { reg: c.reg } : '—', c.card_type || '—',
          c.expiry ? `${c.expiry.slice(5, 7)}/${c.expiry.slice(0, 4)}` : '—',
          c.status !== 'active' ? pill('none', FUEL_CARD_STATUSES[c.status] || c.status) : exp && exp.level === 'overdue' ? pill('overdue', 'Expired') : exp && exp.level === 'soon' ? pill('soon', 'Expiring') : pill('ok', 'Active')];
      }) }));
      return { title: 'Fuel Cards report', count: `${cards.length} card${cards.length === 1 ? '' : 's'}`,
        columns: ['Card', 'Card number', 'Name on card', 'Vehicle', 'Card type', 'Expiry', 'Status'], widths: [8, 19, 20, 12, 16, 9, 9], groups };
    },
  },
  equipment: { label: 'Equipment', blurb: 'All equipment, grouped by category, with the same columns as the plant report.', build: () => plantReport('equipment') },
  employees: {
    label: 'Employees', blurb: 'Everyone, grouped by fleet drivers, site managers, site workers and other admin users, with their vehicles and fuel cards.',
    async build() {
      const users = await all(`SELECT u.*, (SELECT string_agg(reg, ', ' ORDER BY reg) FROM vehicles v WHERE v.driver_id = u.id AND v.active = 1) AS vehicles,
          (SELECT string_agg(provider || COALESCE(' #' || card_ref, ''), ', ' ORDER BY provider, card_ref) FROM fuel_cards c WHERE c.user_id = u.id AND c.status = 'active') AS cards
        FROM users u ORDER BY u.active DESC, u.name`);
      const row = (u) => [u.employee_no || '—', u.name, userLabel(u),
        u.job_title || '—', u.phone || '—', u.password_hash ? u.email : (u.email ? u.email + ' (no login)' : 'No login'), u.vehicles || '—', u.cards || '—', pill(u.active ? 'ok' : 'none', u.active ? 'Active' : 'Disabled')];
      const groups = [
        { label: 'Fleet drivers', rows: users.filter((u) => u.employee_type === 'driver').map(row) },
        { label: 'Site managers', rows: users.filter((u) => u.employee_type === 'site_manager').map(row) },
        { label: 'Site workers', rows: users.filter((u) => u.employee_type === 'worker').map(row) },
        { label: 'Other admin users', rows: users.filter((u) => u.role === 'admin' && !EMPLOYEE_TYPES[u.employee_type]).map(row) },
      ].filter((g) => g.rows.length);
      return { title: 'Employees report', count: `${users.length} ${users.length === 1 ? 'person' : 'people'}`,
        columns: ['Employee ID', 'Name', 'Type', 'Job role', 'Phone', 'Email', 'Vehicles', 'Fuel cards', 'Status'], widths: [8, 13, 11, 11, 10, 15, 11, 13, 8], groups };
    },
  },
  projects: {
    label: 'Projects', blurb: 'Every project number with its site, status and the plant and equipment booked to it.',
    async build() {
      const projects = await all(`SELECT pr.*, (SELECT string_agg(plant_no, ', ' ORDER BY plant_no) FROM plant p WHERE p.job_ref = pr.code AND p.active = 1) AS assets,
          (SELECT COUNT(*) FROM plant p WHERE p.job_ref = pr.code AND p.active = 1) AS items
        FROM projects pr ORDER BY pr.active DESC, pr.code`);
      return { title: 'Projects report', count: `${projects.filter((p) => p.active).length} open`,
        columns: ['Project No.', 'Project / site', 'Status', 'Items', 'Plant & equipment on this project'], widths: [11, 22, 8, 6, 53],
        groups: [{ rows: projects.map((p) => [p.code, p.name || '—', pill(p.active ? 'ok' : 'none', p.active ? 'Open' : 'Closed'), String(p.items), p.assets || '—']) }] };
    },
  },
  mileage: {
    label: 'Mileage', picker: 'period',
    blurb: 'Work and personal miles from the SoTrack trips: a summary for each driver, then their trips day by day, like the weekly trip records sheet.',
    async build({ query }) {
      const p = await mileagePeriod(query);
      const reg = query.reg ? M.normReg(query.reg) : null;
      const { vehicles } = await mileageFor(p, reg);
      const when = `${ukDate(p.from)} to ${ukDate(p.to)}`;
      const tagOf = (w) => ({ home: 'Home · ', work: 'Work · ', site: 'Site? · ', unknown: 'Unknown · ' }[w] || '');
      const who = (v) => v.driver_name || (v.notOnFleet ? v.device : 'No driver');
      const summary = {
        title: 'Mileage report', sub: when, count: `${M.fmtMiles(M.sum(vehicles.flatMap((v) => v.trips), 'personal'))} personal miles`,
        columns: ['Driver / vehicle', 'Reg', 'Trips', 'Work miles', 'Personal miles', 'Total', 'Idle time'], widths: [28, 12, 8, 13, 13, 13, 13],
        groups: [{ rows: vehicles.map((v) => [who(v), { reg: v.regText }, String(v.trips.length), M.fmtMiles(v.work), v.personal ? M.fmtMiles(v.personal) : '—', M.fmtMiles(v.total), M.fmtSecs(v.idle)]) }],
      };
      const trips = vehicles.map((v) => ({
        title: `Trips – ${who(v)}`, sub: `${v.regText} · ${when}`, count: `${M.fmtMiles(v.work)} work · ${M.fmtMiles(v.personal)} personal`,
        columns: ['Start', 'From', 'End', 'To', 'Miles', 'Counts as'], widths: [8, 36, 7, 36, 6, 7],
        groups: [...new Set(v.trips.map((t) => t.started_at.slice(0, 10)))].map((d) => ({
          label: new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
          rows: v.trips.filter((t) => t.started_at.startsWith(d)).map((t) => [t.started_at.slice(11, 16), tagOf(t.from) + (t.start_loc || '—'),
            t.ended_at ? t.ended_at.slice(11, 16) : '—', tagOf(t.to) + (t.end_loc || '—'), M.fmtMiles(t.distance),
            pill(t.use === 'personal' ? 'soon' : 'ok', t.use === 'personal' ? 'Personal' : 'Work')]),
        })),
      }));
      if (reg) return trips[0] || { ...summary, groups: [] };
      return { title: summary.title, sections: [summary, ...trips] };
    },
  },
  training: {
    label: 'Training', adminOnly: true, picker: true,
    blurb: 'One employee\'s training from the Training Matrix: what they hold with expiry dates and card colours, what is due or expired, what they need, and copies of their cards. Or everyone at once.',
    build: trainingReport,
  },
};

router.get('/reports', async (req, res) => res.render('reports', { title: 'Reports', REPORTS, people: await matrixPeople() }));

router.get('/reports/:key', async (req, res) => {
  const def = Object.hasOwn(REPORTS, req.params.key) ? REPORTS[req.params.key] : null;
  // The Training report is for admin users only, like the Training Matrix.
  if (!def || (def.adminOnly && !isAdmin(req.user))) return res.status(404).render('error', { title: 'Not found', message: 'Report not found.' });
  res.render('report', { report: await def.build({ full: isAdmin(req.user), query: req.query }), autoPrint: req.query.print === '1' });
});

module.exports = router;
