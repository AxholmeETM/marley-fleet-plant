const express = require('express');
const { get } = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();
router.use('/admin', requireAdmin);

// Landing page for the Admin menu: users and projects.
router.get('/admin', async (req, res) => {
  const users = await get(`SELECT COUNT(*) FILTER (WHERE active = 1 AND role = 'admin') AS admins, COUNT(*) FILTER (WHERE active = 1 AND role = 'driver' AND employee_type = 'driver') AS drivers,
    COUNT(*) FILTER (WHERE active = 1 AND role = 'driver' AND employee_type = 'site_manager') AS site_managers, COUNT(*) FILTER (WHERE active = 0) AS disabled FROM users`);
  const { projects } = await get('SELECT COUNT(*) AS projects FROM projects WHERE active = 1');
  res.render('admin', { title: 'Admin', users, projects });
});

module.exports = router;
