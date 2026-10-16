// Planned repairs: a repair booked for today or a later date. It is kept as a 'repair' record with planned = 1,
// shows on the calendar, and becomes an ordinary repair in the history once it is marked as done.
const { get, run, transaction } = require('./db');
const { saveDocs } = require('./documents');
const { UserError, text } = require('./auth');
const { isValidDate, isoDate } = require('./status');

async function planRepair(req, res, assetType, assetId) {
  const date = req.body.record_date;
  if (!isValidDate(date) || date < isoDate()) throw new UserError('Please enter the date the repair is booked for, today or later.');
  const notes = text(req.body.notes);
  if (!notes) throw new UserError('Please say what the repair is for.');
  await transaction(async () => {
    const recordId = (await run(`INSERT INTO service_records (asset_type, asset_id, kind, record_date, done_by, notes, user_id, planned) VALUES (?, ?, 'repair', ?, ?, ?, ?, 1)`,
      assetType, assetId, date, text(req.body.done_by), notes, req.user.id)).lastInsertRowid;
    await saveDocs(req.files, { assetType, assetId, kind: 'repair', recordId, userId: req.user.id });
  });
  req.flash('success', 'Repair planned. It is on the calendar.');
  res.redirect(`/${assetType === 'plant' ? 'plant' : 'vehicles'}/${assetId}#history`);
}

async function repairDone(req, assetType, assetId, recordId) {
  const r = await get('SELECT * FROM service_records WHERE id = ? AND asset_type = ? AND asset_id = ? AND planned = 1', recordId, assetType, assetId);
  if (!r) throw new UserError('Planned repair not found.', 404);
  const date = req.body.record_date || isoDate();
  if (!isValidDate(date) || date > isoDate()) throw new UserError('Please enter the date the repair was done, today or earlier.');
  await run('UPDATE service_records SET planned = 0, record_date = ?, done_by = COALESCE(?, done_by), notes = COALESCE(?, notes) WHERE id = ?',
    date, text(req.body.done_by), text(req.body.notes), r.id);
  req.flash('success', 'Repair marked as done.');
}

module.exports = { planRepair, repairDone };
