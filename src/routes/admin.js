const express = require('express');
const { get } = require('../db');
const { requireAdmin } = require('../auth');
const { isoDate } = require('../status');

const router = express.Router();
router.use('/admin', requireAdmin);

// Landing page for the Admin menu: users, checks, defects and exports in one place.
router.get('/admin', async (req, res) => {
  const users = await get(`SELECT COUNT(*) FILTER (WHERE active = 1 AND role = 'admin') AS admins, COUNT(*) FILTER (WHERE active = 1 AND role = 'driver' AND employee_type = 'driver') AS drivers,
    COUNT(*) FILTER (WHERE active = 1 AND role = 'driver' AND employee_type = 'site_manager') AS site_managers, COUNT(*) FILTER (WHERE active = 0) AS disabled FROM users`);
  const defects = await get(`SELECT COUNT(*) AS open, COUNT(*) FILTER (WHERE severity = 'unsafe') AS unsafe FROM defects WHERE status = 'open'`);
  const today = isoDate();
  const checks = await get(`SELECT (SELECT COUNT(*) FROM vehicle_checks WHERE check_date = ?) AS walkarounds,
    (SELECT COUNT(*) FROM plant_checks WHERE check_date >= to_char(?::date - 6, 'YYYY-MM-DD')) AS plant`, today, today);
  res.render('admin', { title: 'Admin', users, defects, checks });
});

module.exports = router;
