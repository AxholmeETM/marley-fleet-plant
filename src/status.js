// Date helpers and the rules that decide whether something is OK, due soon or overdue.
// Dates are stored as 'YYYY-MM-DD' strings in local time.

const DUE_SOON_DAYS = Number(process.env.DUE_SOON_DAYS || 30);
const PLANT_CHECK_DAYS = 7;

const pad = (n) => String(n).padStart(2, '0');

function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(s) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseDate(s).getTime());
}

function addMonths(s, months) {
  if (!s) return null;
  const d = parseDate(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + Number(months));
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return isoDate(d);
}

function addDays(s, days) {
  const d = parseDate(s);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

function daysBetween(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / 86400000);
}

function ukDate(s) {
  if (!s) return '—';
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function ukDateTime(s) {
  if (!s) return '—';
  return `${ukDate(s)} ${s.slice(11, 16)}`;
}

// Status for something with an expiry/due date (MOT, tax, LOLER, vehicle service).
function dueStatus(due, soonDays = DUE_SOON_DAYS) {
  if (!due) return { level: 'none', text: 'Not set', due: null };
  const days = daysBetween(isoDate(), due);
  if (days < 0) return { level: 'overdue', text: `Overdue (${ukDate(due)})`, due, days };
  if (days <= soonDays) return { level: 'soon', text: days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`, due, days };
  return { level: 'ok', text: ukDate(due), due, days };
}

const fmtHours = (h) => Number(h || 0).toLocaleString('en-GB', { maximumFractionDigits: 1 });

// Plant service is driven by running hours: due at last service hours + interval.
// "Due soon" when within 10% of the interval (minimum 25 hours).
function plantService(p) {
  const interval = Number(p.service_interval_hours) || 250;
  const base = p.last_service_hours == null ? 0 : Number(p.last_service_hours);
  const nextAt = base + interval;
  const remaining = nextAt - Number(p.running_hours || 0);
  const soonWindow = Math.max(25, interval * 0.1);
  if (remaining <= 0) return { level: 'overdue', text: `Overdue by ${fmtHours(-remaining)} hrs`, nextAt, remaining };
  if (remaining <= soonWindow) return { level: 'soon', text: `Due in ${fmtHours(remaining)} hrs`, nextAt, remaining };
  return { level: 'ok', text: `${fmtHours(remaining)} hrs left`, nextAt, remaining };
}

function plantLoler(p) {
  if (!p.loler_required) return { level: 'none', text: 'Not required', due: null };
  if (!p.last_loler_date) return { level: 'overdue', text: 'No inspection recorded', due: null };
  return dueStatus(addMonths(p.last_loler_date, p.loler_interval_months || 12));
}

// Plant check sheets are weekly.
function weeklyCheck(lastDate) {
  if (!lastDate) return { level: 'overdue', text: 'Never checked' };
  const age = daysBetween(lastDate, isoDate());
  if (age > PLANT_CHECK_DAYS) return { level: 'overdue', text: `Overdue (last ${ukDate(lastDate)})` };
  if (age >= PLANT_CHECK_DAYS - 1) return { level: 'soon', text: `Due (last ${ukDate(lastDate)})` };
  return { level: 'ok', text: age === 0 ? 'Done today' : `Done ${age} day${age === 1 ? '' : 's'} ago` };
}

// Vehicle walk-around checks are daily.
function dailyCheck(lastDate, hasDriver) {
  if (lastDate === isoDate()) return { level: 'ok', text: 'Done today' };
  if (!hasDriver) return { level: 'none', text: 'No driver assigned' };
  return { level: 'overdue', text: lastDate ? `Not done today (last ${ukDate(lastDate)})` : 'Never done' };
}

function vehicleService(v) {
  if (!v.last_service_date) return { level: 'none', text: 'No service recorded', due: null };
  return dueStatus(addMonths(v.last_service_date, v.service_interval_months || 12));
}

function decoratePlant(p) {
  return {
    ...p,
    service: plantService(p),
    loler: plantLoler(p),
    check: weeklyCheck(p.last_check),
  };
}

function decorateVehicle(v) {
  return {
    ...v,
    mot: dueStatus(v.mot_due),
    tax: dueStatus(v.tax_due),
    service: vehicleService(v),
    walkaround: dailyCheck(v.last_check, !!v.driver_id),
  };
}

const LEVEL_RANK = { overdue: 0, soon: 1, ok: 2, none: 3 };
function worst(...statuses) {
  return statuses.reduce((a, b) => (LEVEL_RANK[b.level] < LEVEL_RANK[a.level] ? b : a));
}

module.exports = {
  DUE_SOON_DAYS, isoDate, parseDate, isValidDate, addMonths, addDays, daysBetween, ukDate, ukDateTime,
  dueStatus, plantService, plantLoler, weeklyCheck, dailyCheck, vehicleService,
  decoratePlant, decorateVehicle, worst, fmtHours,
};
