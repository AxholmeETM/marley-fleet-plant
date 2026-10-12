// End-to-end smoke test: starts the app on a throwaway database and walks through the main flows.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'marley-test-'));
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'adminpass1';

const { createApp } = require('../src/app');
const { get, run } = require('../src/db');
const { VEHICLE_ITEMS, PLANT_ITEMS } = require('../src/checklists');
const status = require('../src/status');

let server;
let base;

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function client() {
  let cookie = '';
  return async function request(method, url, body) {
    const headers = { cookie };
    let payload = body;
    if (body && !(body instanceof FormData)) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(body).toString();
    }
    const res = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    const set = res.headers.getSetCookie();
    if (set.length) {
      const jar = Object.fromEntries(cookie.split('; ').filter(Boolean).map((c) => c.split(/=(.*)/s).slice(0, 2)));
      for (const c of set) { const [k, v] = c.split(';')[0].split(/=(.*)/s); jar[k] = v; }
      cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    }
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  };
}

const checklist = (items, defectIndex) => Object.fromEntries(items.map((_, i) => [`item_${i}`, i === defectIndex ? 'defect' : 'ok']));

test('status rules', () => {
  const today = status.isoDate();
  assert.equal(status.plantService({ running_hours: 740, last_service_hours: 500, service_interval_hours: 250 }).level, 'soon');
  assert.equal(status.plantService({ running_hours: 760, last_service_hours: 500, service_interval_hours: 250 }).level, 'overdue');
  assert.equal(status.plantService({ running_hours: 600, last_service_hours: 500, service_interval_hours: 250 }).level, 'ok');
  assert.equal(status.weeklyCheck(status.addDays(today, -8)).level, 'overdue');
  assert.equal(status.weeklyCheck(status.addDays(today, -2)).level, 'ok');
  assert.equal(status.plantLoler({ loler_required: 1, loler_interval_months: 6, last_loler_date: status.addMonths(today, -7) }).level, 'overdue');
  assert.equal(status.plantLoler({ loler_required: 0 }).level, 'none');
  assert.equal(status.dueStatus(status.addDays(today, 10)).level, 'soon');
  assert.equal(status.addMonths('2024-01-31', 1), '2024-02-29');
});

test('admin and driver flows', async () => {
  const admin = client();
  assert.equal((await admin('GET', '/')).location, '/login');
  assert.equal((await admin('POST', '/login', { email: 'admin@test.local', password: 'wrong' })).status, 401);
  assert.equal((await admin('POST', '/login', { email: 'admin@test.local', password: 'adminpass1' })).location, '/');

  // Admin sets up a driver, a vehicle and a machine.
  await admin('POST', '/users', { name: 'Dave Driver', email: 'dave@test.local', password: 'driverpass1', role: 'driver' });
  const dave = get("SELECT id FROM users WHERE email = 'dave@test.local'").id;
  assert.match((await admin('POST', '/vehicles', { reg: 'yx21 kpl', make: 'Ford', model: 'Transit', fuel_type: 'diesel', driver_id: dave, mot_due: status.addDays(status.isoDate(), 5) })).location, /^\/vehicles\/\d+$/);
  const vehicle = get("SELECT * FROM vehicles WHERE reg = 'YX21 KPL'");
  await admin('POST', '/plant', { plant_no: 'mc-ex01', description: '13t excavator', job_ref: 'J100', running_hours: 990, service_interval_hours: 250, last_service_hours: 750, loler_required: '1', loler_interval_months: 12 });
  const plant = get("SELECT * FROM plant WHERE plant_no = 'MC-EX01'");
  assert.ok(plant);

  const dash = await admin('GET', '/');
  assert.match(dash.text, /Needs attention/);
  assert.match(dash.text, /MOT/);

  // Driver does a walk-around with a defect, a plant check and logs fuel with a receipt.
  const driver = client();
  await driver('POST', '/login', { email: 'dave@test.local', password: 'driverpass1' });
  assert.match((await driver('GET', '/')).text, /Do today&#39;s walk-around check|Do today's walk-around check/);
  assert.equal((await driver('GET', '/plant')).status, 403);
  assert.equal((await driver('GET', '/fuel')).status, 403);

  const missing = await driver('POST', '/checks/vehicle', { asset_id: vehicle.id, check_date: status.isoDate() });
  assert.equal(missing.status, 400);
  await driver('POST', '/checks/vehicle', { asset_id: vehicle.id, check_date: status.isoDate(), reading: '48000', ...checklist(VEHICLE_ITEMS, 1), defect_details: 'Bald tyre', severity: 'major' });
  assert.equal(get('SELECT COUNT(*) AS n FROM vehicle_checks').n, 1);
  assert.equal(get("SELECT severity FROM defects WHERE asset_type = 'vehicle'").severity, 'major');
  assert.equal(get('SELECT mileage FROM vehicles WHERE id = ?', vehicle.id).mileage, 48000);
  assert.match((await driver('GET', '/')).text, /Walk-around done today/);

  await driver('POST', '/checks/plant', { asset_id: plant.id, check_date: status.isoDate(), reading: '1004.5', job_ref: 'J200', ...checklist(PLANT_ITEMS, -1) });
  const updated = get('SELECT running_hours, job_ref FROM plant WHERE id = ?', plant.id);
  assert.equal(updated.running_hours, 1004.5);
  assert.equal(updated.job_ref, 'J200');

  const form = new FormData();
  form.append('vehicle_id', vehicle.id);
  form.append('fuel_type', 'diesel');
  form.append('litres', '55.2');
  form.append('fill_date', status.isoDate());
  form.append('mileage', '48100');
  form.append('receipt', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }), 'receipt.jpg');
  assert.equal((await driver('POST', '/fuel', form)).location, '/');
  const entry = get('SELECT * FROM fuel_entries');
  assert.equal(entry.litres, 55.2);
  assert.ok(fs.existsSync(path.join(process.env.DATA_DIR, 'uploads', entry.receipt_file)));
  assert.equal((await driver('GET', `/receipts/${entry.receipt_file}`)).status, 200);

  const bad = new FormData();
  bad.append('vehicle_id', vehicle.id);
  bad.append('fuel_type', 'diesel');
  bad.append('litres', '10');
  bad.append('receipt', new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'x.svg');
  assert.equal((await driver('POST', '/fuel', bad)).status, 400);

  // Office prices the receipt and the leaderboard picks it up.
  assert.equal((await admin('POST', `/fuel/${entry.id}`, { cost: '79.99', verified: '1' })).status, 302);
  const priced = get('SELECT cost, verified FROM fuel_entries WHERE id = ?', entry.id);
  assert.deepEqual([priced.cost, priced.verified], [79.99, 1]);
  const fuelPage = await admin('GET', '/fuel');
  assert.match(fuelPage.text, /Dave Driver/);
  assert.match(fuelPage.text, /£79\.99/);

  // Recording a service resets the plant service due point.
  await admin('POST', `/plant/${plant.id}/records`, { kind: 'service', record_date: status.isoDate(), reading: '1004.5' });
  assert.equal(get('SELECT last_service_hours FROM plant WHERE id = ?', plant.id).last_service_hours, 1004.5);
  await admin('POST', `/vehicles/${vehicle.id}/records`, { kind: 'mot', record_date: '2026-03-01' });
  assert.equal(get('SELECT mot_due FROM vehicles WHERE id = ?', vehicle.id).mot_due, '2027-02-28');

  const defect = get("SELECT id FROM defects WHERE asset_type = 'vehicle'");
  await admin('POST', `/defects/${defect.id}/resolve`, { resolution: 'Tyre replaced' });
  assert.equal(get('SELECT status FROM defects WHERE id = ?', defect.id).status, 'resolved');

  const csv = await admin('GET', '/export/fuel.csv');
  assert.match(csv.text, /YX21 KPL,Dave Driver,diesel,55\.2/);
  run('DELETE FROM fuel_entries');
});
