const express = require('express');
const { run, get } = require('../db');
const { listDefects, listPlant, listVehicles } = require('../queries');
const { requireAdmin, isAdmin, canUsePlant, canUseVehicle, UserError, text } = require('../auth');

const router = express.Router();

router.get('/defects', requireAdmin, async (req, res) => {
  const statusFilter = ['open', 'resolved', 'all'].includes(req.query.status) ? req.query.status : 'open';
  const assetType = ['plant', 'vehicle'].includes(req.query.asset) ? req.query.asset : null;
  res.render('defects', { title: 'Defects', defects: await listDefects({ status: statusFilter, assetType }), statusFilter, assetType });
});

router.get('/defects/new', async (req, res) => {
  res.render('defect-form', {
    title: 'Report a defect',
    plant: canUsePlant(req.user) ? await listPlant() : [],
    vehicles: await listVehicles({ driverId: isAdmin(req.user) ? null : req.user.id }),
    selected: req.query.asset || '',
  });
});

router.post('/defects', async (req, res) => {
  const [assetType, idStr] = String(req.body.asset || '').split(':');
  const table = assetType === 'plant' ? 'plant' : assetType === 'vehicle' ? 'vehicles' : null;
  const asset = table && await get(`SELECT * FROM ${table} WHERE id = ?`, Number(idStr));
  if (!asset) throw new UserError('Please choose the plant or vehicle.');
  if (table === 'plant' ? !canUsePlant(req.user) : !canUseVehicle(req.user, asset)) throw new UserError('You can only report defects on your own vehicle.', 403);
  const description = text(req.body.description);
  if (!description) throw new UserError('Please describe the defect.');
  const severity = ['minor', 'major', 'unsafe'].includes(req.body.severity) ? req.body.severity : 'minor';
  await run('INSERT INTO defects (asset_type, asset_id, description, severity, reported_by) VALUES (?, ?, ?, ?, ?)',
    assetType, Number(idStr), description, severity, req.user.id);
  req.flash('success', 'Defect reported. The office has been notified on the dashboard.');
  res.redirect(req.user.role === 'admin' ? '/defects' : '/');
});

router.post('/defects/:id/resolve', requireAdmin, async (req, res) => {
  const resolution = text(req.body.resolution);
  if (!resolution) throw new UserError('Please say what was done to fix the defect.');
  await run(`UPDATE defects SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?`,
    resolution, req.user.id, Number(req.params.id));
  req.flash('success', 'Defect marked as resolved.');
  res.redirect(req.body.back && req.body.back.startsWith('/') && !req.body.back.startsWith('//') ? req.body.back : '/defects');
});

router.post('/defects/:id/reopen', requireAdmin, async (req, res) => {
  await run(`UPDATE defects SET status = 'open', resolved_by = NULL, resolved_at = NULL WHERE id = ?`, Number(req.params.id));
  req.flash('success', 'Defect reopened.');
  res.redirect('/defects');
});

module.exports = router;
