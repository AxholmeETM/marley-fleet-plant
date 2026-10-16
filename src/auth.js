// Admin pages. Managers can open them to look (not the add and edit forms); they can't change anything.
function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  if (isManager(req.user) && (req.method === 'GET' || req.method === 'HEAD') && !/\/(new|edit)$/.test(req.path)) return next();
  res.status(403).render('error', { title: 'Admins only', message: 'You need an admin account to see this page.' });
}

// Who can see what:
// - admin users: everything
// - site managers: the plant and equipment on the projects assigned to them (view, checks, defects, service and
//   inspection records), plus their own vehicles and fuel cards
// - fleet drivers: only the vehicles assigned to them
const isAdmin = (u) => !!u && u.role === 'admin';
// Managers (an employee type) can view everything an admin can, read-only.
const isManager = (u) => !!u && u.role === 'driver' && u.employee_type === 'manager';
const canViewAll = (u) => isAdmin(u) || isManager(u);
const isSiteManager = (u) => !!u && u.role === 'driver' && u.employee_type === 'site_manager';
// Without a plant item: may this person use the plant pages at all? With one: may they see that item?
const canUsePlant = (u, plant) => canViewAll(u) || (isSiteManager(u) && (plant === undefined || (!!plant && !!plant.job_ref && (u.projects || []).includes(plant.job_ref))));
// The items from a plant list this person may see.
const plantFor = (u, list) => (canViewAll(u) ? list : list.filter((p) => canUsePlant(u, p)));

function requirePlantAccess(req, res, next) {
  if (canUsePlant(req.user)) return next();
  res.status(403).render('error', { title: 'No access', message: 'Plant is only available to site managers and the office.' });
}

// A vehicle an employee may use: one assigned to them. Admins can use any.
const canUseVehicle = (u, vehicle) => !!vehicle && (canViewAll(u) || vehicle.driver_id === u.id);

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

module.exports = { requireAdmin, requirePlantAccess, isAdmin, isManager, canViewAll, isSiteManager, canUsePlant, plantFor, canUseVehicle, UserError, numberField, text };
