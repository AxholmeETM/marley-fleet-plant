// Work and personal mileage from SoTrack's Trip List export.
// Marley's own sheet colours each address as a home or a work address, then counts a run of trips as personal when it
// never reaches a work address. The same rule here: a journey is the trips between leaving and getting back home (or a
// stop of 4 hours or more, such as overnight). If none of its trips starts or ends at a work address, it is personal.
// Sites change all the time, so a weekday stop of 3 hours or more from the morning counts as a site until it is saved.
const { readSheet, serialToText } = require('./xlsx');
const { addDays, parseDate, isoDate } = require('./status');

const GAP_SECS = 4 * 3600;
const SITE_SECS = 3 * 3600;
const COLUMNS = { vehicle: ['vehicle', 'device'], start: ['start'], startLoc: ['start location'], end: ['end'], endLoc: ['end location'], distance: ['distance'], tripTime: ['trip time'], idle: ['idle time'] };

// The registration at the end of SoTrack's vehicle name ("Bob Stevenson- Ford Transit - YT19 RPN"), without spaces.
function regOf(device) {
  const last = String(device || '').split(/\s-\s|-\s|\s-/).pop();
  const reg = last.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{2,8}$/.test(reg) && /\d/.test(reg) ? reg : null;
}
const normReg = (reg) => String(reg || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const asText = (v) => (typeof v === 'number' ? serialToText(v) : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(String(v || '')) ? String(v).replace('T', ' ').slice(0, 19) : ukText(v));
// "19/05/2025 05:50:45" as written by some exports.
function ukText(v) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(v || '').trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')} ${m[4].padStart(2, '0')}:${m[5]}:${m[6] || '00'}` : null;
}
// A duration: a fraction of a day, a date-and-time whose time part is the duration, or "hh:mm:ss".
function asSecs(v) {
  if (typeof v === 'number') return Math.round((v - Math.floor(v)) * 86400) % 86400;
  const m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(String(v || '').trim());
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0) : null;
}

// Trips from a Trip List file. Throws a plain message when the file isn't one.
async function parseTripList(buf) {
  let sheet;
  try { sheet = await readSheet(buf, 'Data'); } catch { throw new Error('That file could not be read. Please upload the Trip List .xlsx file from SoTrack.'); }
  const headAt = sheet.rows.findIndex((r) => r.some((c) => String(c || '').trim().toLowerCase() === 'start location'));
  if (headAt < 0) throw new Error('That file has no Start Location column. Please upload the Trip List report from SoTrack.');
  const head = sheet.rows[headAt].map((c) => String(c || '').trim().toLowerCase());
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]));
  if (col.vehicle < 0 || col.start < 0 || col.distance < 0) throw new Error('That file is missing the Vehicle, Start or Distance column.');
  const trips = [];
  for (const r of sheet.rows.slice(headAt + 1)) {
    const device = String(r[col.vehicle] ?? '').trim();
    const started = r[col.start] != null ? asText(r[col.start]) : null;
    if (!device || !started) continue;
    const reg = regOf(device);
    if (!reg) continue;
    const distance = Number(r[col.distance]);
    trips.push({
      device, reg, started_at: started,
      ended_at: col.end >= 0 && r[col.end] != null ? asText(r[col.end]) : null,
      start_loc: col.startLoc >= 0 ? String(r[col.startLoc] ?? '').trim() || null : null,
      end_loc: col.endLoc >= 0 ? String(r[col.endLoc] ?? '').trim() || null : null,
      distance: Number.isFinite(distance) && distance >= 0 ? Math.round(distance * 10) / 10 : 0,
      trip_secs: col.tripTime >= 0 ? asSecs(r[col.tripTime]) : null,
      idle_secs: col.idle >= 0 ? asSecs(r[col.idle]) : null,
    });
  }
  if (!trips.length) throw new Error('No trips were found in that file.');
  return trips;
}

// An address as SoTrack writes it, reduced to what identifies the place: its postcode, and its street with the
// postcode district (SoTrack often gives a neighbour's postcode, e.g. DN7 6AW for DN7 6AP).
const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/g;
function addressKey(s) {
  const up = String(s || '').toUpperCase();
  const pcs = [...up.matchAll(POSTCODE)];
  const pc = pcs.length ? pcs[pcs.length - 1] : null;
  const street = up.split(',')[0].trim().replace(/^(NEAR TO |[\d.]+ KM FROM |\d+[A-Z]?\s+)+/, '').replace(/\s+/g, ' ').trim();
  return { postcode: pc ? pc[1] + pc[2] : null, district: pc ? pc[1] : null, street };
}
function sameAddress(a, b) {
  if (!a.postcode || !b.postcode) return false;
  return a.postcode === b.postcode || (a.district === b.district && !!a.street && a.street === b.street);
}
const matcher = (places) => {
  const keys = places.map((p) => ({ ...p, key: addressKey(p.address) }));
  return (loc) => { if (!loc) return null; const k = addressKey(loc); return keys.find((p) => sameAddress(k, p.key)) || null; };
};

const secsBetween = (a, b) => (Date.parse(b.replace(' ', 'T') + 'Z') - Date.parse(a.replace(' ', 'T') + 'Z')) / 1000;

// Marks each trip (in time order, one vehicle) with what it touched and whether it is work or personal.
// homes: that driver's home addresses; works: every work address. With no driver or no home address, nothing is
// counted as personal (yard vehicles, and drivers whose home hasn't been entered yet).
function classify(trips, { homes, works, unknowns = [] }) {
  const isHome = matcher(homes);
  const isWork = matcher(works);
  const isUnknown = matcher(unknowns);
  const placeOf = (loc) => isHome(loc) || isWork(loc) || isUnknown(loc) || null;
  const out = trips.map((t) => {
    const fromPlace = placeOf(t.start_loc); const toPlace = placeOf(t.end_loc);
    return { ...t, fromPlace, toPlace, from: fromPlace ? fromPlace.kind : null, to: toPlace ? toPlace.kind : null };
  });
  // A weekday stop of 3 hours or more that starts in the morning, away from home, is taken to be a site not saved yet.
  for (let i = 0; i < out.length - 1; i++) {
    const t = out[i]; const next = out[i + 1];
    if (t.to || !t.ended_at || !homes.length) continue;
    const day = new Date(t.ended_at.slice(0, 10) + 'T12:00:00Z').getUTCDay();
    if (day >= 1 && day <= 5 && Number(t.ended_at.slice(11, 13)) < 12 && secsBetween(t.ended_at, next.started_at) >= SITE_SECS) {
      t.to = 'site';
      if (!next.from) next.from = 'site';
    }
  }
  const decide = (j) => {
    const personal = homes.length > 0 && !j.some((t) => ['work', 'site'].includes(t.from) || ['work', 'site'].includes(t.to));
    for (const t of j) t.auto = personal ? 'personal' : 'work';
  };
  let j = [];
  for (const t of out) {
    const prev = j[j.length - 1];
    if (prev && prev.ended_at && secsBetween(prev.ended_at, t.started_at) >= GAP_SECS) { decide(j); j = []; }
    j.push(t);
    if (t.to === 'home') { decide(j); j = []; }
  }
  decide(j);
  // An address saved as unknown counts as personal (Ben, 16/10/2026): any trip to or from one.
  for (const t of out) if (t.from === 'unknown' || t.to === 'unknown') t.auto = 'personal';
  for (const t of out) t.use = t.override || t.auto;
  return out;
}

// Monday of the week a date falls in.
function weekOf(date) {
  const d = parseDate(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDate(d);
}
const weekEnd = (week) => addDays(week, 6);

const sum = (trips, use) => Math.round(trips.filter((t) => !use || t.use === use).reduce((n, t) => n + (t.distance || 0), 0) * 10) / 10;
const fmtMiles = (n) => (n || 0).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function fmtSecs(s) {
  if (s == null) return '—';
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
const fmtReg = (reg) => (reg && reg.length > 4 ? `${reg.slice(0, -3)} ${reg.slice(-3)}` : reg);

module.exports = { parseTripList, regOf, normReg, addressKey, sameAddress, classify, weekOf, weekEnd, sum, fmtMiles, fmtSecs, fmtReg };
