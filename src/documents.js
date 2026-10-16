// Documents attached to plant and vehicle records, and to employees (copies of their cards): service sheets, LOLER and thorough examination
// certificates, MOT certificates, repair invoices, defect photos. Stored like fuel receipts and
// only served through the app after a permission check.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const { all, get, run } = require('./db');
const storage = require('./storage');
const { canUsePlant, canUseVehicle, isAdmin, canViewAll, UserError } = require('./auth');

const MIME_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'image/heic': '.heic', 'image/heif': '.heif', 'application/pdf': '.pdf',
};

const DOC_KINDS = {
  plant: { service: 'Service', loler: 'LOLER', thorough: 'Thorough examination', repair: 'Repair', defect: 'Defect', other: 'Other' },
  vehicle: { service: 'Service', mot: 'MOT', tax: 'Tax', repair: 'Repair', defect: 'Defect', other: 'Other' },
  person: { cscs: 'CSCS card', npors: 'NPORS card', cpcs: 'CPCS card', certificate: 'Certificate', other: 'Other' },
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (MIME_EXT[file.mimetype]) return cb(null, true);
    cb(new UserError('Documents must be a photo (JPG, PNG, HEIC) or a PDF.'));
  },
}).array('docs', 10);

// Saves the uploaded files and links them to the asset and, if given, the service record or defect.
async function saveDocs(files, { assetType, assetId, kind, recordId = null, defectId = null, userId }) {
  const saved = [];
  try {
    for (const f of files || []) {
      const file = `doc-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${MIME_EXT[f.mimetype]}`;
      await storage.save(file, f.buffer);
      saved.push(file);
      await run('INSERT INTO documents (asset_type, asset_id, kind, record_id, defect_id, file, name, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        assetType, assetId, kind, recordId, defectId, file, f.originalname.slice(0, 200), userId);
    }
  } catch (err) {
    await Promise.all(saved.map((f) => storage.remove(f).catch(() => {})));
    throw err;
  }
  return saved.length;
}

const listDocs = (assetType, assetId) => all(`SELECT d.*, u.name AS user_name FROM documents d LEFT JOIN users u ON u.id = d.user_id
  WHERE d.asset_type = ? AND d.asset_id = ? ORDER BY d.created_at DESC, d.id DESC`, assetType, assetId);

// Who may see an asset's documents: the same people who can open its page.
async function canSeeAsset(user, assetType, assetId) {
  // An employee's documents: the office, managers, and the employee themselves.
  if (assetType === 'person') return !!user && (canViewAll(user) || user.id === assetId) && !!(await get('SELECT id FROM users WHERE id = ?', assetId));
  if (assetType === 'plant') return canUsePlant(user, await get('SELECT id, job_ref FROM plant WHERE id = ?', assetId));
  return canUseVehicle(user, await get('SELECT id, driver_id FROM vehicles WHERE id = ?', assetId));
}

// After adding or removing an employee's document, back to the page it was done from.
const personBack = (back, id) => {
  const ok = [`/training/people/${id}`, `/users/${id}`, '/account'];
  return (ok.includes(String(back)) ? back : `/users/${id}`) + '#documents';
};

const router = express.Router();

router.get('/documents/:id', async (req, res) => {
  const doc = await get('SELECT * FROM documents WHERE id = ?', Number(req.params.id));
  if (!doc || !(await canSeeAsset(req.user, doc.asset_type, doc.asset_id))) {
    return res.status(404).render('error', { title: 'Not found', message: 'Document not found.' });
  }
  const file = await storage.read(doc.file);
  if (!file) return res.status(404).render('error', { title: 'Not found', message: 'The document file is missing.' });
  res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'private, max-age=3600');
  res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}`);
  res.type(file.type).send(file.body);
});

// Add documents straight from the Documents section of a plant or vehicle page.
router.post('/documents', upload, async (req, res) => {
  const [assetType, idStr] = String(req.body.asset || '').split(':');
  const assetId = Number(idStr);
  if (!DOC_KINDS[assetType] || !(await canSeeAsset(req.user, assetType, assetId))) throw new UserError('Plant or vehicle not found.', 404);
  // Employees can add copies of their own cards; everything else is the office.
  if (!isAdmin(req.user) && !(assetType === 'person' && req.user.id === assetId)) throw new UserError('Only the office can add documents.', 403);
  if (!req.files || !req.files.length) throw new UserError('Please choose a file to upload.');
  const kind = DOC_KINDS[assetType][req.body.kind] ? req.body.kind : 'other';
  // Documents added from a History pop-up belong to that service record.
  const record = Number(req.body.record) ? await get('SELECT id FROM service_records WHERE id = ? AND asset_type = ? AND asset_id = ?', Number(req.body.record), assetType, assetId) : null;
  const n = await saveDocs(req.files, { assetType, assetId, kind, recordId: record ? record.id : null, userId: req.user.id });
  req.flash('success', `${n} document${n > 1 ? 's' : ''} added.`);
  if (assetType === 'person') return res.redirect(personBack(req.body.back, assetId));
  res.redirect(`/${assetType === 'plant' ? 'plant' : 'vehicles'}/${assetId}#${record ? 'history' : 'documents'}`);
});

// Remove an employee's document (the office, or the employee for their own).
router.post('/documents/:id/remove', async (req, res) => {
  const doc = await get('SELECT * FROM documents WHERE id = ?', Number(req.params.id));
  if (!doc || doc.asset_type !== 'person' || !(await canSeeAsset(req.user, 'person', doc.asset_id))) throw new UserError('Document not found.', 404);
  if (!isAdmin(req.user) && req.user.id !== doc.asset_id) throw new UserError('Only the office can remove documents.', 403);
  await run('DELETE FROM documents WHERE id = ?', doc.id);
  await storage.remove(doc.file).catch(() => {});
  req.flash('success', `${doc.name} removed.`);
  res.redirect(personBack(req.body.back, doc.asset_id));
});

module.exports = { router, upload, saveDocs, listDocs, DOC_KINDS };
