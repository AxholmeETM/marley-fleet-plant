const { all, get, run } = require('./db');
const { decoratePlant, decorateVehicle } = require('./status');

const PLANT_SQL = `
  SELECT p.*,
    (SELECT MAX(check_date) FROM plant_checks c WHERE c.plant_id = p.id) AS last_check,
    (SELECT COUNT(*) FROM defects d WHERE d.asset_type = 'plant' AND d.asset_id = p.id AND d.status = 'open') AS open_defects,
    (SELECT name FROM projects pr WHERE pr.code = p.job_ref) AS project_name
  FROM plant p`;

const VEHICLE_SQL = `
  SELECT v.*, u.name AS driver_name,
    (SELECT MAX(check_date) FROM vehicle_checks c WHERE c.vehicle_id = v.id) AS last_check,
    (SELECT COUNT(*) FROM defects d WHERE d.asset_type = 'vehicle' AND d.asset_id = v.id AND d.status = 'open') AS open_defects
  FROM vehicles v LEFT JOIN users u ON u.id = v.driver_id`;

async function listPlant({ includeInactive = false } = {}) {
  return (await all(`${PLANT_SQL} ${includeInactive ? '' : 'WHERE p.active = 1'} ORDER BY p.active DESC, p.plant_no`)).map(decoratePlant);
}

async function getPlant(id) {
  const row = await get(`${PLANT_SQL} WHERE p.id = ?`, id);
  return row ? decoratePlant(row) : null;
}

async function listVehicles({ includeInactive = false, driverId = null } = {}) {
  const where = [];
  const params = [];
  if (!includeInactive) where.push('v.active = 1');
  if (driverId) { where.push('v.driver_id = ?'); params.push(driverId); }
  const sql = `${VEHICLE_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.active DESC, v.reg`;
  return (await all(sql, ...params)).map(decorateVehicle);
}

async function getVehicle(id) {
  const row = await get(`${VEHICLE_SQL} WHERE v.id = ?`, id);
  return row ? decorateVehicle(row) : null;
}

// Defects with a readable asset name attached.
async function listDefects({ status = 'open', assetType = null, assetId = null, category = null, limit = 500 } = {}) {
  const where = [];
  const params = [];
  if (status && status !== 'all') { where.push('d.status = ?'); params.push(status); }
  if (assetType) { where.push('d.asset_type = ?'); params.push(assetType); }
  if (assetId) { where.push('d.asset_id = ?'); params.push(assetId); }
  if (category) { where.push("d.asset_type = 'plant' AND d.asset_id IN (SELECT id FROM plant WHERE category = ?)"); params.push(category); }
  params.push(limit);
  return await all(`
    SELECT d.*, r.name AS reported_by_name, s.name AS resolved_by_name,
      CASE d.asset_type
        WHEN 'plant' THEN (SELECT plant_no || ' – ' || description FROM plant WHERE id = d.asset_id)
        ELSE (SELECT reg || COALESCE(' – ' || make || ' ' || model, '') FROM vehicles WHERE id = d.asset_id)
      END AS asset_name
    FROM defects d
    LEFT JOIN users r ON r.id = d.reported_by
    LEFT JOIN users s ON s.id = d.resolved_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY d.status = 'resolved', CASE d.severity WHEN 'unsafe' THEN 0 WHEN 'major' THEN 1 ELSE 2 END, d.reported_at DESC
    LIMIT ?`, ...params);
}

// Active people, plus the vehicle's current driver even if they have since left, so saving the form keeps them.
async function listDrivers(keepId = null) {
  return await all("SELECT id, name, role FROM users WHERE active = 1 OR id = ? ORDER BY name", keepId);
}

// Project numbers offered in the drop-downs; keeps a code already on an item even if it has since been closed.
async function listProjects(keep = null) {
  return await all('SELECT code, name, active FROM projects WHERE active = 1 OR code = ? ORDER BY code', keep);
}

// A person's fuel cards follow the vehicle assigned to them, so the card shows that vehicle on the fuel card
// pages, the vehicle page and the Log fuel form. With one vehicle, all their cards point at it. When a vehicle is
// taken off them, their cards pointing at it move to their other vehicle, or to none.
async function syncCardVehicles(userId, removedVehicleId = null) {
  if (!userId) return;
  // A person's cards always point at one of their vehicles (the first if they have several), or none.
  const ids = (await all('SELECT id FROM vehicles WHERE driver_id = ? AND active = 1 ORDER BY id', userId)).map((v) => v.id);
  if (!ids.length) return run('UPDATE fuel_cards SET vehicle_id = NULL WHERE user_id = ?', userId);
  await run(`UPDATE fuel_cards SET vehicle_id = ? WHERE user_id = ? AND (vehicle_id IS NULL OR vehicle_id NOT IN (${ids.map(() => '?').join(', ')}))`, ids[0], userId, ...ids);
}

module.exports = { syncCardVehicles, listProjects, listPlant, getPlant, listVehicles, getVehicle, listDefects, listDrivers };
