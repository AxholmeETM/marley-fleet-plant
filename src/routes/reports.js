const express = require('express');
const { all } = require('../db');
const { listPlant, listVehicles } = require('../queries');
const { requireAdmin, isAdmin } = require('../auth');
const { ukDate, fmtHours } = require('../status');
const { decorate: decorateCard } = require('./fuel-cards');
const { CATEGORIES, CATEGORY, PLANT_STATUSES, INSPECTION_TYPES, VEHICLE_CATEGORIES, VEHICLE_STATUSES, FUEL_CARD_STATUSES, EMPLOYEE_TYPES, userLabel } = require('../categories');

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
};

router.get('/reports', (req, res) => res.render('reports', { title: 'Reports', REPORTS }));

router.get('/reports/:key', async (req, res) => {
  const def = Object.hasOwn(REPORTS, req.params.key) ? REPORTS[req.params.key] : null;
  if (!def) return res.status(404).render('error', { title: 'Not found', message: 'Report not found.' });
  res.render('report', { report: await def.build({ full: isAdmin(req.user) }), autoPrint: req.query.print === '1' });
});

module.exports = router;
