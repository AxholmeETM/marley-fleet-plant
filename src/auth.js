function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  res.status(403).render('error', { title: 'Admins only', message: 'You need an admin account to see this page.' });
}

class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

// Parse a positive number from a form field; returns null for blank.
function numberField(value, label, { integer = false, min = 0 } = {}) {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < min) throw new UserError(`${label} must be a number${min === 0 ? ' of 0 or more' : ''}.`);
  return integer ? Math.round(n) : n;
}

const text = (v) => (v == null ? null : String(v).trim() || null);

module.exports = { requireAdmin, UserError, numberField, text };
