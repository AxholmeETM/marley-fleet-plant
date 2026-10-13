const express = require('express');
const { all } = require('../db');
const { listPlant, listVehicles } = require('../queries');
const { requireAdmin } = require('../auth');
const { isValidDate } = require('../status');
const { CATEGORY, OWNERS, PLANT_STATUSES, INSPECTION_TYPES, VEHICLE_CATEGORIES, VEHICLE_STATUSES, TRACKED } = require('../categories');

const router = express.Router();
router.use('/export', requireAdmin);

function csv(res, filename, header, rows) {
  const esc = (v) => {
    if (v == null) return '';
    let s = String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n'));
}

router.get('/export/plant.csv', async (req, res) => {
  csv(res, 'plant-register.csv',
    ['Asset no', 'Category', 'Owner', 'Status', 'Description', 'Manufacturer', 'Model', 'Serial no', 'Registered', 'SWL', 'Job ref', 'Location',
      'Running hours', 'Service plan (first services)', 'Then every (hrs)', 'Service plan included', 'Last service date', 'Hours at last service',
      'Next service at (hrs)', 'Service status', 'Last check sheet', 'Check status',
      'Inspection type', 'Last tested', 'Next due', 'Cert no', 'Inspection status',
      'Purchase price', 'Purchase date', 'Agreed price from MCL', 'Weekly hire rate', 'Open defects', 'Notes'],
    (await listPlant({ includeInactive: true })).map((p) => [p.plant_no, CATEGORY[p.category]?.label || p.category, OWNERS[p.owner] || p.owner, PLANT_STATUSES[p.status] || p.status,
      p.description, p.make, p.model, p.serial_no, p.registered, p.swl, p.job_ref, p.location,
      p.tracks_hours ? p.running_hours : '', p.tracks_hours ? p.service_schedule : '', p.tracks_hours ? p.service_interval_hours : '', p.service_plan ? 'Yes' : 'No',
      p.last_service_date, p.last_service_hours, p.service.nextAt, p.service.text, p.last_check, p.check.text,
      p.loler_required ? INSPECTION_TYPES[p.inspection_type] : 'None', p.last_loler_date, p.loler.due, p.cert_no, p.loler.text,
      p.purchase_price, p.purchase_date, p.transfer_price, p.weekly_hire_rate, p.open_defects, p.notes]));
});

router.get('/export/vehicles.csv', async (req, res) => {
  csv(res, 'fleet-register.csv',
    ['Asset no', 'Registration', 'Type', 'Owner', 'Status', 'Make', 'Model', 'Colour', 'Body', 'Fuel', 'User', 'Tracked', 'Mileage',
      'Last service', 'Service due', 'MOT expiry', 'Tax due', 'Last walk-around', 'Purchase price', 'Purchase date', 'Open defects', 'Notes'],
    (await listVehicles({ includeInactive: true })).map((v) => [v.asset_no, v.reg, VEHICLE_CATEGORIES[v.category] || v.category, OWNERS[v.owner] || v.owner,
      VEHICLE_STATUSES[v.status] || v.status, v.make, v.model, v.colour, v.vehicle_type, v.fuel_type, v.driver_display, TRACKED[v.tracked] || '',
      v.mileage, v.last_service_date, v.service.due, v.mot_due, v.tax_due, v.last_check, v.purchase_price, v.purchase_date, v.open_defects, v.notes]));
});

router.get('/export/fuel.csv', async (req, res) => {
  const from = isValidDate(req.query.from) ? req.query.from : '0000-01-01';
  const to = isValidDate(req.query.to) ? req.query.to : '9999-12-31';
  const rows = await all(`SELECT f.*, v.reg, u.name AS driver, c.provider AS card_provider, c.card_ref, c.last4 AS card_last4 FROM fuel_entries f
    JOIN vehicles v ON v.id = f.vehicle_id JOIN users u ON u.id = f.user_id LEFT JOIN fuel_cards c ON c.id = f.fuel_card_id
    WHERE f.fill_date BETWEEN ? AND ? ORDER BY f.fill_date, f.id`, from, to);
  csv(res, `fuel-log-${from === '0000-01-01' ? 'all' : from + '-to-' + to}.csv`,
    ['Date', 'Vehicle', 'Driver', 'Fuel card', 'Fuel', 'Litres', 'Mileage', 'Station', 'Cost (£)', 'Price per litre (£)', 'Receipt checked', 'Driver notes', 'Office notes'],
    rows.map((r) => [r.fill_date, r.reg, r.driver, r.card_provider ? `${r.card_provider}${r.card_ref ? ' #' + r.card_ref : ''}${r.card_last4 ? ' ••' + r.card_last4 : ''}` : '', r.fuel_type, r.litres, r.mileage, r.station, r.cost?.toFixed(2),
      r.cost != null ? (r.cost / r.litres).toFixed(3) : '', r.verified ? 'Yes' : 'No', r.notes, r.admin_notes]));
});

module.exports = router;
