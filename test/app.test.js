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
const { get, run, close } = require('../src/db');
const { VEHICLE_ITEMS, PLANT_ITEMS } = require('../src/checklists');
const status = require('../src/status');

let server;
let base;

before(async () => {
  server = (await createApp()).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await close(); });

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
  // Service plan: 50, 200, 500 then every 500 hrs.
  const plan = { tracks_hours: 1, service_schedule: '50, 200, 500', service_interval_hours: 500 };
  assert.equal(status.nextServiceAt({ ...plan, running_hours: 10, last_service_hours: null }), 50);
  assert.equal(status.nextServiceAt({ ...plan, running_hours: 60, last_service_hours: 48 }), 200);
  assert.equal(status.nextServiceAt({ ...plan, running_hours: 300, last_service_hours: 205 }), 500);
  assert.equal(status.nextServiceAt({ ...plan, running_hours: 520, last_service_hours: 480 }), 1000);
  assert.equal(status.nextServiceAt({ ...plan, running_hours: 1100, last_service_hours: 1090 }), 1500);
  assert.equal(status.plantService({ ...plan, running_hours: 1100, last_service_hours: 480 }).level, 'overdue');
  assert.equal(status.plantService({ ...plan, tracks_hours: 0 }).level, 'none');
  // 12-month backstop: low hours but a year since the last service.
  assert.equal(status.plantService({ ...plan, service_months: 12, running_hours: 600, last_service_hours: 500, last_service_date: status.addMonths(today, -13) }).level, 'overdue');
  assert.equal(status.plantService({ ...plan, service_months: 12, running_hours: 600, last_service_hours: 500, last_service_date: status.addMonths(today, -2) }).level, 'ok');
  // Inspections: explicit due date wins over last + interval.
  assert.equal(status.plantLoler({ loler_required: 1, inspection_type: 'calibration', last_loler_date: '2020-01-01', inspection_due: status.addDays(today, 100) }).level, 'ok');
  assert.equal(status.plantLoler({ loler_required: 1, inspection_type: 'none' }).level, 'none');
});

test('admin and driver flows', async () => {
  const admin = client();
  assert.equal((await admin('GET', '/')).location, '/login');
  assert.equal((await admin('POST', '/login', { email: 'admin@test.local', password: 'wrong' })).status, 401);
  assert.equal((await admin('POST', '/login', { email: 'admin@test.local', password: 'adminpass1' })).location, '/');

  // Admin sets up a driver, a vehicle and a machine.
  assert.equal((await admin('POST', '/users', { name: 'No Type', email: 'x@test.local', password: 'driverpass1', role: 'driver' })).status, 400);
  await admin('POST', '/users', { name: 'Dave Driver', email: 'dave@test.local', password: 'driverpass1', role: 'driver', employee_type: 'driver', job_title: 'Groundworker' });
  await admin('POST', '/users', { name: 'Sam Site', email: 'sam@test.local', password: 'managerpass1', role: 'driver', employee_type: 'site_manager', job_title: 'Site Manager' });
  assert.deepEqual({ ...await get("SELECT employee_type, job_title FROM users WHERE email = 'sam@test.local'") }, { employee_type: 'site_manager', job_title: 'Site Manager' });
  const dave = (await get("SELECT id FROM users WHERE email = 'dave@test.local'")).id;
  assert.match((await admin('POST', '/vehicles', { reg: 'yx21 kpl', make: 'Ford', model: 'Transit', fuel_type: 'diesel', driver_id: dave, mot_due: status.addDays(status.isoDate(), 5) })).location, /^\/vehicles\/\d+$/);
  const vehicle = await get("SELECT * FROM vehicles WHERE reg = 'YX21 KPL'");
  await admin('POST', '/plant', { plant_no: 'mcl-ex-0001', category: 'excavator', owner: 'MCL', make: 'JCB', model: '245', job_ref: 'J100', running_hours: 990,
    service_schedule: '50, 200, 500', service_interval_hours: 500, last_service_hours: 750, tracks_hours: '1', weekly_checks: '1', inspection_type: 'loler', loler_interval_months: 12 });
  const plant = await get("SELECT * FROM plant WHERE plant_no = 'MCL-EX-0001'");
  assert.equal(plant.description, 'JCB 245');
  assert.equal(plant.service_schedule, '50, 200, 500');
  await admin('POST', '/plant', { plant_no: 'MCL-C&S-0001', category: 'chains', owner: 'MCL', description: '2 leg chain sling', swl: '4.25T', inspection_type: 'thorough', loler_interval_months: 6, last_loler_date: '2026-01-01' });
  const sling = await get("SELECT * FROM plant WHERE plant_no = 'MCL-C&S-0001'");
  assert.deepEqual([sling.tracks_hours, sling.weekly_checks, sling.inspection_type], [0, 0, 'thorough']);
  assert.doesNotMatch((await admin('GET', '/checks/plant/new')).text, /2 leg chain sling/);

  // Fuel card (no PIN; full number kept for admins, last 4 digits for everyone else).
  await admin('POST', '/fuel-cards', { provider: 'Esso', card_ref: '12', card_number: '7064 0560 7223 5900 127', holder: 'Dave Driver', status: 'active', expiry: '2027-06' });
  const essoCard = await get('SELECT last4, card_number FROM fuel_cards ORDER BY id LIMIT 1');
  assert.deepEqual([essoCard.last4, essoCard.card_number], ['0127', '7064056072235900127']);
  assert.match((await admin('GET', '/fuel-cards')).text, /7064 0560 7223 5900 127/);
  await admin('POST', '/fuel-cards', { provider: 'Key Fuels', card_ref: 'K7', card_number: '5555', status: 'active' });
  await admin('POST', '/fuel-cards', { provider: 'FastFuels', card_ref: 'Spare', card_number: '9999', status: 'active' });
  const [esso, key] = [(await get("SELECT id FROM fuel_cards WHERE card_ref = '12'")).id, (await get("SELECT id FROM fuel_cards WHERE card_ref = 'K7'")).id];
  // Assign two cards to Dave: one from the board by drag (fetch), one through the plain form.
  const moved = await admin('POST', `/fuel-cards/${esso}/assign`, { user_id: dave });
  assert.equal(moved.status, 302);
  assert.equal((await admin('POST', `/fuel-cards/${key}/assign`, { user_id: dave })).status, 302);
  assert.equal((await admin('POST', `/fuel-cards/${key}/assign`, { user_id: '99999' })).status, 400);
  assert.equal((await get('SELECT COUNT(*) AS n FROM fuel_cards WHERE user_id = ?', dave)).n, 2);
  const json = await fetch(`${base}/fuel-cards/${key}/assign`, { method: 'POST', redirect: 'manual' });
  assert.notEqual(json.status, 200); // not signed in
  const board = await admin('GET', '/fuel-cards/assign');
  assert.match(board.text, /Dave Driver/);
  assert.match(board.text, /Not assigned/);

  assert.match((await admin('GET', '/admin')).text, /Fleet drivers/);
  const dash = await admin('GET', '/');
  assert.match(dash.text, /Needs attention/);
  assert.match(dash.text, /MOT/);

  // Driver does a walk-around with a defect, a plant check and logs fuel with a receipt.
  const driver = client();
  await driver('POST', '/login', { email: 'dave@test.local', password: 'driverpass1' });
  assert.match((await driver('GET', '/')).text, /Do today&#39;s walk-around check|Do today's walk-around check/);
  assert.equal((await driver('GET', '/plant')).status, 403);
  assert.equal((await driver('GET', '/fuel')).status, 403);
  assert.equal((await driver('GET', '/fuel-cards/assign')).status, 403);
  // Dave's own two cards are offered as choices; the spare card is only in the "different card" list.
  const fuelForm = (await driver('GET', '/fuel/new')).text;
  assert.doesNotMatch(fuelForm, /7064056072235900127|7064 0560/);
  assert.equal((fuelForm.match(/name="card_choice" value="\d+"/g) || []).length, 2);
  assert.match(fuelForm, /<option value="\d+"[^>]*>FastFuels #Spare/);

  const missing = await driver('POST', '/checks/vehicle', { asset_id: vehicle.id, check_date: status.isoDate() });
  assert.equal(missing.status, 400);
  await driver('POST', '/checks/vehicle', { asset_id: vehicle.id, check_date: status.isoDate(), reading: '48000', ...checklist(VEHICLE_ITEMS, 1), defect_details: 'Bald tyre', severity: 'major' });
  assert.equal((await get('SELECT COUNT(*) AS n FROM vehicle_checks')).n, 1);
  assert.equal((await get("SELECT severity FROM defects WHERE asset_type = 'vehicle'")).severity, 'major');
  assert.equal((await get('SELECT mileage FROM vehicles WHERE id = ?', vehicle.id)).mileage, 48000);
  assert.match((await driver('GET', '/')).text, /Walk-around done today/);

  // Fleet drivers: only their own vehicle, no plant.
  assert.equal((await driver('GET', `/vehicles/${vehicle.id}`)).status, 200);
  assert.equal((await driver('GET', `/vehicles/${vehicle.id}/edit`)).status, 403);
  assert.equal((await driver('GET', '/checks/plant/new')).status, 403);
  assert.equal((await driver('GET', '/equipment')).status, 403);
  await admin('POST', '/vehicles', { reg: 'AB12 CDE', make: 'Ford', model: 'Ranger', fuel_type: 'diesel' });
  const other = (await get("SELECT id FROM vehicles WHERE reg = 'AB12 CDE'")).id;
  assert.equal((await driver('GET', `/vehicles/${other}`)).status, 403);
  assert.doesNotMatch((await driver('GET', '/fuel/new')).text, /AB12 CDE/);
  assert.equal((await driver('POST', '/checks/vehicle', { asset_id: other, check_date: status.isoDate(), reading: '1', ...checklist(VEHICLE_ITEMS, -1) })).status, 403);
  assert.equal((await driver('POST', '/defects', { asset: `plant:${plant.id}`, description: 'x' })).status, 403);

  // Site managers: all plant and equipment (no prices, no editing the asset record), plus their own vehicles.
  const manager = client();
  await manager('POST', '/login', { email: 'sam@test.local', password: 'managerpass1' });
  assert.match((await manager('GET', '/plant')).text, /MCL-EX-0001/);
  assert.match((await manager('GET', '/equipment')).text, /2 leg chain sling/);
  assert.doesNotMatch((await manager('GET', '/plant')).text, /2 leg chain sling/);
  assert.equal((await manager('GET', `/plant/${plant.id}/edit`)).status, 403);
  assert.doesNotMatch((await manager('GET', `/plant/${plant.id}`)).text, /Weekly hire rate/);
  assert.equal((await manager('GET', `/vehicles/${vehicle.id}`)).status, 403);
  assert.equal((await manager('GET', '/users')).status, 403);

  await manager('POST', '/checks/plant', { asset_id: plant.id, check_date: status.isoDate(), reading: '1004.5', job_ref: 'J200', ...checklist(PLANT_ITEMS, -1) });
  const updated = await get('SELECT running_hours, job_ref FROM plant WHERE id = ?', plant.id);
  assert.equal(updated.running_hours, 1004.5);
  assert.equal(updated.job_ref, 'J200');

  const form = new FormData();
  form.append('vehicle_id', vehicle.id);
  form.append('fuel_type', 'diesel');
  form.append('litres', '55.2');
  form.append('fill_date', status.isoDate());
  form.append('mileage', '48100');
  form.append('fuel_card_id', String((await get('SELECT id FROM fuel_cards ORDER BY id LIMIT 1')).id));
  form.append('receipt', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }), 'receipt.jpg');
  assert.equal((await driver('POST', '/fuel', form)).location, '/');
  const entry = await get('SELECT * FROM fuel_entries');
  assert.equal(entry.litres, 55.2);
  assert.ok(entry.fuel_card_id);
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
  const priced = await get('SELECT cost, verified FROM fuel_entries WHERE id = ?', entry.id);
  assert.deepEqual([priced.cost, priced.verified], [79.99, 1]);
  const fuelPage = await admin('GET', '/fuel');
  assert.match(fuelPage.text, /Dave Driver/);
  assert.match(fuelPage.text, /£79\.99/);

  // Recording a service resets the plant service due point.
  await admin('POST', `/plant/${plant.id}/records`, { kind: 'service', record_date: status.isoDate(), reading: '1004.5' });
  assert.equal((await get('SELECT last_service_hours FROM plant WHERE id = ?', plant.id)).last_service_hours, 1004.5);
  assert.match((await admin('GET', `/plant/${plant.id}`)).text, /1,500 hr service/);
  await admin('POST', `/plant/${sling.id}/records`, { kind: 'loler', record_date: status.isoDate(), cert_no: 'C123' });
  assert.equal((await get('SELECT cert_no FROM plant WHERE id = ?', sling.id)).cert_no, 'C123');
  await admin('POST', `/vehicles/${vehicle.id}/records`, { kind: 'mot', record_date: '2026-03-01' });
  assert.equal((await get('SELECT mot_due FROM vehicles WHERE id = ?', vehicle.id)).mot_due, '2027-02-28');

  const defect = await get("SELECT id FROM defects WHERE asset_type = 'vehicle'");
  await admin('POST', `/defects/${defect.id}/resolve`, { resolution: 'Tyre replaced' });
  assert.equal((await get('SELECT status FROM defects WHERE id = ?', defect.id)).status, 'resolved');

  const csv = await admin('GET', '/export/fuel.csv');
  assert.match(csv.text, /YX21 KPL,Dave Driver,Esso #12 ••0127,diesel,55\.2/);
  await run('DELETE FROM fuel_entries');
});
