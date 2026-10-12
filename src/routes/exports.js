const express = require('express');
const { all } = require('../db');
const { listPlant, listVehicles } = require('../queries');
const { requireAdmin } = require('../auth');
const { isValidDate } = require('../status');

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

router.get('/export/plant.csv', (req, res) => {
  csv(res, 'plant-register.csv',
    ['Plant ID', 'Description', 'Make', 'Model', 'Serial no', 'Job ref', 'Location', 'Running hours', 'Service interval (hrs)',
      'Last service date', 'Hours at last service', 'Next service at (hrs)', 'Service status', 'Last check sheet', 'Check status',
      'LOLER required', 'Last LOLER', 'LOLER next due', 'LOLER status', 'Open defects'],
    listPlant().map((p) => [p.plant_no, p.description, p.make, p.model, p.serial_no, p.job_ref, p.location, p.running_hours, p.service_interval_hours,
      p.last_service_date, p.last_service_hours, p.service.nextAt, p.service.text, p.last_check, p.check.text,
      p.loler_required ? 'Yes' : 'No', p.last_loler_date, p.loler.due, p.loler.text, p.open_defects]));
});

router.get('/export/vehicles.csv', (req, res) => {
  csv(res, 'fleet-register.csv',
    ['Registration', 'Make', 'Model', 'Type', 'Fuel', 'Driver', 'Mileage', 'Last service', 'Service due', 'MOT due', 'Tax due', 'Last walk-around', 'Open defects'],
    listVehicles().map((v) => [v.reg, v.make, v.model, v.vehicle_type, v.fuel_type, v.driver_name, v.mileage, v.last_service_date, v.service.due,
      v.mot_due, v.tax_due, v.last_check, v.open_defects]));
});

router.get('/export/fuel.csv', (req, res) => {
  const from = isValidDate(req.query.from) ? req.query.from : '0000-01-01';
  const to = isValidDate(req.query.to) ? req.query.to : '9999-12-31';
  const rows = all(`SELECT f.*, v.reg, u.name AS driver FROM fuel_entries f JOIN vehicles v ON v.id = f.vehicle_id JOIN users u ON u.id = f.user_id
    WHERE f.fill_date BETWEEN ? AND ? ORDER BY f.fill_date, f.id`, from, to);
  csv(res, `fuel-log-${from === '0000-01-01' ? 'all' : from + '-to-' + to}.csv`,
    ['Date', 'Vehicle', 'Driver', 'Fuel', 'Litres', 'Mileage', 'Station', 'Cost (£)', 'Price per litre (£)', 'Receipt checked', 'Driver notes', 'Office notes'],
    rows.map((r) => [r.fill_date, r.reg, r.driver, r.fuel_type, r.litres, r.mileage, r.station, r.cost?.toFixed(2),
      r.cost != null ? (r.cost / r.litres).toFixed(3) : '', r.verified ? 'Yes' : 'No', r.notes, r.admin_notes]));
});

module.exports = router;
