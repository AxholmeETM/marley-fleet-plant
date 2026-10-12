const { all, get } = require('./db');
const { decoratePlant, decorateVehicle } = require('./status');

const PLANT_SQL = `
  SELECT p.*,
    (SELECT MAX(check_date) FROM plant_checks c WHERE c.plant_id = p.id) AS last_check,
    (SELECT COUNT(*) FROM defects d WHERE d.asset_type = 'plant' AND d.asset_id = p.id AND d.status = 'open') AS open_defects
  FROM plant p`;

const VEHICLE_SQL = `
  SELECT v.*, u.name AS driver_name,
    (SELECT MAX(check_date) FROM vehicle_checks c WHERE c.vehicle_id = v.id) AS last_check,
    (SELECT COUNT(*) FROM defects d WHERE d.asset_type = 'vehicle' AND d.asset_id = v.id AND d.status = 'open') AS open_defects
  FROM vehicles v LEFT JOIN users u ON u.id = v.driver_id`;

function listPlant({ includeInactive = false } = {}) {
  return all(`${PLANT_SQL} ${includeInactive ? '' : 'WHERE p.active = 1'} ORDER BY p.active DESC, p.plant_no`).map(decoratePlant);
}

function getPlant(id) {
  const row = get(`${PLANT_SQL} WHERE p.id = ?`, id);
  return row ? decoratePlant(row) : null;
}

function listVehicles({ includeInactive = false, driverId = null } = {}) {
  const where = [];
  const params = [];
  if (!includeInactive) where.push('v.active = 1');
  if (driverId) { where.push('v.driver_id = ?'); params.push(driverId); }
  const sql = `${VEHICLE_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.active DESC, v.reg`;
  return all(sql, ...params).map(decorateVehicle);
}

function getVehicle(id) {
  const row = get(`${VEHICLE_SQL} WHERE v.id = ?`, id);
  return row ? decorateVehicle(row) : null;
}

// Defects with a readable asset name attached.
function listDefects({ status = 'open', assetType = null, assetId = null, limit = 500 } = {}) {
  const where = [];
  const params = [];
  if (status && status !== 'all') { where.push('d.status = ?'); params.push(status); }
  if (assetType) { where.push('d.asset_type = ?'); params.push(assetType); }
  if (assetId) { where.push('d.asset_id = ?'); params.push(assetId); }
  params.push(limit);
  return all(`
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

function listDrivers() {
  return all("SELECT id, name, role FROM users WHERE active = 1 ORDER BY name");
}

module.exports = { listPlant, getPlant, listVehicles, getVehicle, listDefects, listDrivers };
