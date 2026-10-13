const express = require('express');
const { get } = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();
router.use('/admin', requireAdmin);

// Landing page for the Admin menu: users, checks, defects and exports in one place.
router.get('/admin', (req, res) => {
  const users = get(`SELECT SUM(active = 1 AND role = 'admin') AS admins, SUM(active = 1 AND role = 'driver' AND employee_type = 'driver') AS drivers,
    SUM(active = 1 AND role = 'driver' AND employee_type = 'site_manager') AS site_managers, SUM(active = 0) AS disabled FROM users`);
  const defects = get(`SELECT COUNT(*) AS open, SUM(severity = 'unsafe') AS unsafe FROM defects WHERE status = 'open'`);
  const today = new Date().toISOString().slice(0, 10);
  const checks = get(`SELECT (SELECT COUNT(*) FROM vehicle_checks WHERE check_date = ?) AS walkarounds,
    (SELECT COUNT(*) FROM plant_checks WHERE check_date >= date(?, '-6 days')) AS plant`, today, today);
  res.render('admin', { title: 'Admin', users, defects, checks });
});

module.exports = router;
