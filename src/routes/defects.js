const express = require('express');
const { all, run, get, transaction } = require('../db');
const { upload: docUpload, saveDocs } = require('../documents');
const { listDefects, listPlant, listVehicles } = require('../queries');
const { CATEGORIES } = require('../categories');
const { isoDate, isValidDate } = require('../status');
const { requireAdmin, isAdmin, canUsePlant, canUseVehicle, UserError, text } = require('../auth');

const router = express.Router();

router.get('/defects', requireAdmin, async (req, res) => {
  const statusFilter = ['open', 'resolved', 'all'].includes(req.query.status) ? req.query.status : 'open';
  // Type filter: all, vehicles, all plant & equipment, or one plant category.
  const asset = String(req.query.asset || '');
  const category = CATEGORIES.some((c) => c.key === asset) ? asset : null;
  const assetType = ['plant', 'vehicle'].includes(asset) ? asset : null;
  const defects = await listDefects({ status: statusFilter, assetType, category });
  const docs = defects.length ? await all(`SELECT id, defect_id, name FROM documents WHERE defect_id IN (${defects.map(() => '?').join(', ')}) ORDER BY id`, ...defects.map((d) => d.id)) : [];
  for (const d of defects) d.docs = docs.filter((x) => x.defect_id === d.id);
  res.render('defects', { title: 'Defects', defects, statusFilter, assetFilter: category || assetType || '', CATEGORIES });
});

router.get('/defects/new', async (req, res) => {
  res.render('defect-form', {
    title: 'Report a defect',
    plant: canUsePlant(req.user) ? await listPlant() : [],
    vehicles: await listVehicles({ driverId: isAdmin(req.user) ? null : req.user.id }),
    selected: req.query.asset || '',
  });
});

router.post('/defects', docUpload, async (req, res) => {
  const [assetType, idStr] = String(req.body.asset || '').split(':');
  const table = assetType === 'plant' ? 'plant' : assetType === 'vehicle' ? 'vehicles' : null;
  const asset = table && await get(`SELECT * FROM ${table} WHERE id = ?`, Number(idStr));
  if (!asset) throw new UserError('Please choose the plant or vehicle.');
  if (table === 'plant' ? !canUsePlant(req.user) : !canUseVehicle(req.user, asset)) throw new UserError('You can only report defects on your own vehicle.', 403);
  const description = text(req.body.description);
  if (!description) throw new UserError('Please describe the defect.');
  const severity = ['minor', 'major', 'unsafe'].includes(req.body.severity) ? req.body.severity : 'minor';
  await transaction(async () => {
    const defectId = (await run('INSERT INTO defects (asset_type, asset_id, description, severity, reported_by) VALUES (?, ?, ?, ?, ?)',
      assetType, Number(idStr), description, severity, req.user.id)).lastInsertRowid;
    await saveDocs(req.files, { assetType, assetId: Number(idStr), kind: 'defect', defectId, userId: req.user.id });
  });
  req.flash('success', 'Defect reported. The office has been notified on the dashboard.');
  res.redirect(req.user.role === 'admin' ? '/defects' : '/');
});

router.post('/defects/:id/resolve', requireAdmin, docUpload, async (req, res) => {
  const defect = await get('SELECT * FROM defects WHERE id = ?', Number(req.params.id));
  if (!defect) throw new UserError('Defect not found.', 404);
  if (defect.status !== 'open') throw new UserError('That defect has already been resolved.');
  const resolution = text(req.body.resolution);
  if (!resolution) throw new UserError('Please say what was done to fix the defect.');
  // Date resolved: today unless another date is given (not in the future, not before it was reported).
  const date = req.body.resolved_date || isoDate();
  if (!isValidDate(date) || date > isoDate()) throw new UserError('Date resolved must be today or earlier.');
  if (date < String(defect.reported_at).slice(0, 10)) throw new UserError('Date resolved can’t be before the defect was reported.');
  await transaction(async () => {
    await run(`UPDATE defects SET status = 'resolved', resolution = ?, resolved_by = ?,
        resolved_at = CASE WHEN ?::text = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') THEN to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') ELSE ?::text || ' 12:00:00' END WHERE id = ?`,
      resolution, req.user.id, date, date, defect.id);
    await saveDocs(req.files, { assetType: defect.asset_type, assetId: defect.asset_id, kind: 'defect', defectId: defect.id, userId: req.user.id });
  });
  req.flash('success', 'Defect marked as resolved.');
  res.redirect(req.body.back && req.body.back.startsWith('/') && !req.body.back.startsWith('//') ? req.body.back : '/defects');
});

router.post('/defects/:id/documents', requireAdmin, docUpload, async (req, res) => {
  const defect = await get('SELECT * FROM defects WHERE id = ?', Number(req.params.id));
  if (!defect) throw new UserError('Defect not found.', 404);
  if (!req.files || !req.files.length) throw new UserError('Please choose a file to upload.');
  const n = await saveDocs(req.files, { assetType: defect.asset_type, assetId: defect.asset_id, kind: 'defect', defectId: defect.id, userId: req.user.id });
  req.flash('success', `${n} document${n > 1 ? 's' : ''} added to the defect.`);
  res.redirect(req.body.back && req.body.back.startsWith('/') && !req.body.back.startsWith('//') ? req.body.back : '/defects');
});

router.post('/defects/:id/reopen', requireAdmin, async (req, res) => {
  const defect = await get('SELECT id FROM defects WHERE id = ?', Number(req.params.id));
  if (!defect) throw new UserError('Defect not found.', 404);
  await run(`UPDATE defects SET status = 'open', resolution = NULL, resolved_by = NULL, resolved_at = NULL WHERE id = ?`, defect.id);
  req.flash('success', 'Defect reopened.');
  res.redirect(req.body.back && req.body.back.startsWith('/') && !req.body.back.startsWith('//') ? req.body.back : '/defects');
});

module.exports = router;
