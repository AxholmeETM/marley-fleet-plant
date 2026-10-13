// Date helpers and the rules that decide whether something is OK, due soon or overdue.
// Dates are stored as 'YYYY-MM-DD' strings in local time.

const DUE_SOON_DAYS = Number(process.env.DUE_SOON_DAYS || 30);
const PLANT_CHECK_DAYS = 7;

const pad = (n) => String(n).padStart(2, '0');

// Today's date in the UK, whatever time zone the server runs in (Cloudflare runs on UTC).
const UK_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });

function isoDate(d) {
  if (!d) return UK_DATE.format(new Date());
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
// Hours-based service plan: one-off early services (e.g. 50, 200, 500 hrs), then a repeat
// interval (e.g. every 500 hrs) counted on from the last of those.
const DEFAULT_SERVICE_SCHEDULE = process.env.DEFAULT_SERVICE_SCHEDULE || '50, 250, 500';
const DEFAULT_SERVICE_INTERVAL = Number(process.env.DEFAULT_SERVICE_HOURS || 500);

function parseSchedule(s) {
  return [...new Set(String(s ?? '').split(/[^0-9.]+/).map(Number).filter((n) => n > 0))].sort((a, b) => a - b);
}

// Service milestones (in hours) up to and including the first one past `upTo`.
function serviceMilestones(p, upTo) {
  const every = Number(p.service_interval_hours) || DEFAULT_SERVICE_INTERVAL;
  const out = parseSchedule(p.service_schedule);
  let last = out.length ? out[out.length - 1] : 0;
  while (last <= upTo) { last += every; out.push(last); }
  return out;
}

// A service done a little early still counts for that milestone (up to 10% of the interval, max 50 hrs).
function nextServiceAt(p) {
  const every = Number(p.service_interval_hours) || DEFAULT_SERVICE_INTERVAL;
  const hours = Number(p.running_hours || 0);
  const tolerance = Math.min(50, every * 0.1);
  if (p.last_service_hours == null) {
    // No service on record: the next milestone at or after the current hours.
    return serviceMilestones(p, hours).find((m) => m >= hours);
  }
  const base = Number(p.last_service_hours) + tolerance;
  return serviceMilestones(p, base).find((m) => m > base);
}

function plantService(p) {
  if (p.tracks_hours === 0) {
    if (!p.last_service_date) return { level: 'none', text: 'No hour meter', nextAt: null };
    return { level: 'none', text: `Last ${ukDate(p.last_service_date)}`, nextAt: null };
  }
  const nextAt = nextServiceAt(p);
  const remaining = nextAt - Number(p.running_hours || 0);
  const soonWindow = Math.max(10, Math.min(50, (Number(p.service_interval_hours) || DEFAULT_SERVICE_INTERVAL) * 0.1));
  const name = `${fmtHours(nextAt)} hr service`;
  // Calendar backstop: a service is also due this many months after the last one, whichever comes first.
  if (p.service_months && p.last_service_date && remaining > 0) {
    const byDate = dueStatus(addMonths(p.last_service_date, p.service_months));
    if (byDate.level === 'overdue') return { level: 'overdue', text: `${name} overdue (${p.service_months} months since last)`, nextAt, remaining, name, due: byDate.due };
    if (byDate.level === 'soon' && remaining > soonWindow) return { level: 'soon', text: `${name} due by ${ukDate(byDate.due)}`, nextAt, remaining, name, due: byDate.due };
  }
  if (remaining <= 0) return { level: 'overdue', text: remaining === 0 ? `${name} due now` : `${name} overdue by ${fmtHours(-remaining)} hrs`, nextAt, remaining, name };
  if (remaining <= soonWindow) return { level: 'soon', text: `${name} due in ${fmtHours(remaining)} hrs`, nextAt, remaining, name };
  return { level: 'ok', text: `${fmtHours(remaining)} hrs to ${name}`, nextAt, remaining, name };
}

// The individual service plan for one machine: past milestones (matched to service records),
// the next one, and a few after it.
function servicePlan(p, records) {
  if (p.tracks_hours === 0) return [];
  const every = Number(p.service_interval_hours) || DEFAULT_SERVICE_INTERVAL;
  const next = nextServiceAt(p);
  const milestones = serviceMilestones(p, next + every * 3).filter((m) => m <= next + every * 3);
  // Each recorded service counts against the milestone nearest its hours reading.
  const doneAt = new Map();
  for (const r of records) {
    if (r.kind !== 'service' || r.reading == null) continue;
    const m = milestones.reduce((a, b) => (Math.abs(b - r.reading) < Math.abs(a - r.reading) ? b : a));
    if (m <= next && !doneAt.has(m)) doneAt.set(m, r);
  }
  const rows = milestones.map((m) => ({
    hours: m,
    state: doneAt.has(m) ? 'done' : m === next ? 'next' : m < next ? 'missed' : 'upcoming',
    record: doneAt.get(m) || null,
  }));
  // Keep long-running machines readable: the last 8 past milestones plus what's coming.
  const firstShown = Math.max(0, rows.findIndex((r) => r.hours === next) - 8);
  return rows.slice(firstShown);
}

// LOLER, thorough examination or calibration. An explicit due date (e.g. from a certificate)
// wins; otherwise it is the last inspection + the interval.
function plantLoler(p) {
  if (!p.loler_required || p.inspection_type === 'none') return { level: 'none', text: 'Not required', due: null };
  const due = p.inspection_due || (p.last_loler_date ? addMonths(p.last_loler_date, p.loler_interval_months || 12) : null);
  if (!due) return { level: 'overdue', text: 'No inspection recorded', due: null };
  return dueStatus(due);
}

// Plant check sheets are weekly.
function weeklyCheck(lastDate, required = true) {
  if (!required) return { level: 'none', text: 'Not required' };
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
    check: weeklyCheck(p.last_check, p.weekly_checks !== 0 && !['sold', 'stolen', 'disposed', 'repair'].includes(p.status)),
  };
}

function decorateVehicle(v) {
  const onRoad = !v.status || v.status === 'active';
  const parked = { level: 'none', text: { sorn: 'SORN', off_road: 'Off road', sold: 'Sold' }[v.status] || '—' };
  return {
    ...v,
    driver_display: v.driver_name || v.user_name || null,
    mot: v.status === 'sorn' || v.status === 'sold' ? parked : dueStatus(v.mot_due),
    tax: v.status === 'sorn' || v.status === 'sold' ? parked : dueStatus(v.tax_due),
    service: onRoad ? vehicleService(v) : parked,
    walkaround: onRoad ? dailyCheck(v.last_check, !!v.driver_id) : parked,
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
  DEFAULT_SERVICE_SCHEDULE, DEFAULT_SERVICE_INTERVAL, parseSchedule, nextServiceAt, servicePlan,
};
