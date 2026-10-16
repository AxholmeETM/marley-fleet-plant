function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  res.status(403).render('error', { title: 'Admins only', message: 'You need an admin account to see this page.' });
}

// Who can see what:
// - admin users: everything
// - site managers: all plant (view, checks, defects, service and inspection records) plus their own vehicles
// - fleet drivers: only the vehicles assigned to them
const isAdmin = (u) => !!u && u.role === 'admin';
const isSiteManager = (u) => !!u && u.role === 'driver' && u.employee_type === 'site_manager';
const canUsePlant = (u) => isAdmin(u) || isSiteManager(u);

function requirePlantAccess(req, res, next) {
  if (canUsePlant(req.user)) return next();
  res.status(403).render('error', { title: 'No access', message: 'Plant is only available to site managers and the office.' });
}

// A vehicle an employee may use: one assigned to them. Admins can use any.
const canUseVehicle = (u, vehicle) => !!vehicle && (isAdmin(u) || vehicle.driver_id === u.id);

class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

// Parse a positive number from a form field; returns null for blank.
function numberField(value, label, { integer = false, min = 0, max = 99999999 } = {}) {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < min) throw new UserError(`${label} must be a number${min === 0 ? ' of 0 or more' : ''}.`);
  if (n > max) throw new UserError(`${label} looks too large. Please check it.`);
  return integer ? Math.round(n) : n;
}

const text = (v) => (v == null ? null : String(v).trim() || null);

module.exports = { requireAdmin, requirePlantAccess, isAdmin, isSiteManager, canUsePlant, canUseVehicle, UserError, numberField, text };
