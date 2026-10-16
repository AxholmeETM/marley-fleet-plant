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
  // Employees without an email have no login; vehicles and fuel cards can be assigned from their page.
  assert.match((await admin('POST', '/users', { name: 'Laura Severn', role: 'driver', employee_type: 'driver', job_title: 'Groundworker' })).location, /^\/users\/\d+$/);
  const laura = await get("SELECT * FROM users WHERE name = 'Laura Severn'");
  assert.equal(laura.email, null);
  assert.equal(laura.password_hash, null);
  assert.equal((await admin('POST', '/users', { name: 'No Pass', email: 'np@test.local', role: 'driver', employee_type: 'driver' })).status, 400);
  await admin('POST', `/users/${laura.id}/vehicles`, { vehicle_id: vehicle.id });
  assert.equal((await get('SELECT driver_id FROM vehicles WHERE id = ?', vehicle.id)).driver_id, laura.id);
  assert.match((await admin('GET', `/users/${laura.id}`)).text, /YX21 KPL/);
  // Her fuel card follows the vehicle she's assigned, and is cleared when the vehicle is taken off her.
  const lcard = (await run("INSERT INTO fuel_cards (provider, card_ref, holder, status) VALUES ('Esso', 'L1', 'Laura Severn', 'active')")).lastInsertRowid;
  await admin('POST', `/users/${laura.id}/cards`, { card_id: lcard });
  assert.equal((await get('SELECT vehicle_id FROM fuel_cards WHERE id = ?', lcard)).vehicle_id, vehicle.id);
  await admin('POST', `/users/${laura.id}/vehicles/${vehicle.id}/remove`);
  assert.equal((await get('SELECT vehicle_id FROM fuel_cards WHERE id = ?', lcard)).vehicle_id, null);
  await run('DELETE FROM fuel_cards WHERE id = ?', lcard);
  await run('UPDATE vehicles SET driver_id = ? WHERE id = ?', dave, vehicle.id);
  assert.match((await admin('GET', '/users')).text, /No login/);
  // Employee ID: optional, shown on the list, and no two employees can share one.
  await admin('POST', '/users', { name: 'Id One', employee_no: 'E100', role: 'driver', employee_type: 'driver', active: '1' });
  assert.match((await admin('GET', '/users')).text, /E100/);
  await admin('POST', '/users', { name: 'Id Two', employee_no: 'e100', role: 'driver', employee_type: 'driver', active: '1' });
  assert.equal(await get("SELECT id FROM users WHERE name = 'Id Two'"), undefined);
  await run("DELETE FROM users WHERE name = 'Id One'");
  // No account needed: a site worker is logged with no email or password, even if one was typed.
  await admin('POST', '/users', { name: 'Sid Worker', role: 'none', employee_type: 'worker', email: 'sid@x.test', password: 'password123', active: '1' });
  const sid = await get("SELECT * FROM users WHERE name = 'Sid Worker'");
  assert.ok(sid && sid.email === 'sid@x.test' && sid.password_hash === null && sid.employee_type === 'worker' && sid.role === 'driver');
  assert.equal((await admin('POST', '/login', { email: 'sid@x.test', password: 'password123' })).status, 401);
  await admin('POST', '/login', { email: 'admin@test.local', password: 'adminpass1' });
  // The employee record keeps contact, personal and emergency details.
  await admin('POST', `/users/${sid.id}`, { name: 'Sid Worker', role: 'none', employee_type: 'worker', email: 'sid@x.test', active: '1', work_email: 'sid@marley.test',
    address: '1 High St\nDoncaster', licence_no: 'morga 657054 sm9ij', ni_number: 'qq 12 34 56 c', dob: '1990-05-01', emergency_name: 'Ann Worker', emergency_phone: '07700 900123', emergency_email: 'ann@x.test' });
  const sid2 = await get('SELECT * FROM users WHERE id = ?', sid.id);
  assert.equal(sid2.ni_number, 'QQ123456C');
  assert.equal(sid2.licence_no, 'MORGA657054SM9IJ');
  const sidPage = (await admin('GET', `/users/${sid.id}`)).text;
  assert.match(sidPage, /QQ 12 34 56 C/);
  assert.match(sidPage, /Ann Worker/);
  assert.equal((await admin('POST', `/users/${sid.id}`, { name: 'Sid Worker', role: 'none', employee_type: 'worker', ni_number: 'nope' })).status, 400);
  assert.match((await admin('GET', '/users?show=workers')).text, /Sid Worker/);
  assert.match((await admin('GET', `/users/${sid.id}/edit`)).text, /id="role-none" name="role" value="none" checked/);
  await run("DELETE FROM users WHERE name = 'Sid Worker'");
  // No account needed keeps the chosen employee type, and Site worker is available for every account type.
  await admin('POST', '/users', { name: 'Nia Driver', role: 'none', employee_type: 'driver', active: '1' });
  assert.equal((await get("SELECT employee_type FROM users WHERE name = 'Nia Driver' AND email IS NULL")).employee_type, 'driver');
  await admin('POST', '/users', { name: 'Wes Login', role: 'driver', employee_type: 'worker', email: 'wes@x.test', password: 'password123', active: '1' });
  assert.ok((await get("SELECT email FROM users WHERE name = 'Wes Login' AND employee_type = 'worker'")).email);
  await run("DELETE FROM users WHERE name IN ('Nia Driver', 'Wes Login')");
  // Employees are created from the names on the fuel cards (run once on the live database).
  await run("INSERT INTO fuel_cards (provider, card_ref, holder, user_id, status) VALUES ('Esso', 'T1', 'Pat Jones(2)', (SELECT id FROM users WHERE role = 'admin' LIMIT 1), 'active'), ('Esso', 'T2', 'pat jones', NULL, 'active'), ('Esso', 'T3', 'Jim and Keith', NULL, 'active'), ('Esso', 'T4', 'Laura', NULL, 'active')");
  const { employeesFromCards } = require('../src/routes/users');
  await employeesFromCards();
  const pat = await get("SELECT * FROM users WHERE name = 'Pat Jones'");
  assert.ok(pat && pat.email === null);
  assert.equal((await get("SELECT COUNT(*) AS n FROM fuel_cards WHERE card_ref IN ('T1', 'T2') AND user_id = ?", pat.id)).n, 2);
  assert.equal((await get("SELECT user_id FROM fuel_cards WHERE card_ref = 'T3'")).user_id, null);
  assert.equal((await get("SELECT user_id FROM fuel_cards WHERE card_ref = 'T4'")).user_id, laura.id);
  await employeesFromCards();
  assert.equal((await get("SELECT COUNT(*) AS n FROM users WHERE lower(name) = 'pat jones'")).n, 1);
  await run("DELETE FROM fuel_cards WHERE card_ref IN ('T1', 'T2', 'T3', 'T4')");
  // Only the driver assigned on Employees is shown; a typed name from the spreadsheet is ignored.
  await run("INSERT INTO vehicles (reg, user_name, active) VALUES ('SH01 EET', 'Sam Sheet', 1)");
  assert.doesNotMatch((await admin('GET', '/vehicles')).text, /Sam Sheet/);
  await run("DELETE FROM vehicles WHERE reg = 'SH01 EET'");
  const sam = pat;
  // Fuel cards take their name from Employees.
  const named = (await run("INSERT INTO fuel_cards (provider, card_ref, holder, status) VALUES ('Esso', 'N1', 'Printed Name', 'active')")).lastInsertRowid;
  assert.match((await admin('GET', `/fuel-cards/${named}/edit`)).text, /Printed on card: Printed Name/);
  await admin('POST', `/fuel-cards/${named}`, { provider: 'Esso', card_ref: 'N1', status: 'active', user_id: sam.id });
  assert.match((await admin('GET', '/fuel-cards')).text, /Pat Jones/);
  // Choosing the card's vehicle makes its person that vehicle's driver on Fleet; changing the driver on Fleet moves the card.
  const vanA = (await run("INSERT INTO vehicles (reg, active) VALUES ('MT01 AAA', 1)")).lastInsertRowid;
  await admin('POST', `/fuel-cards/${named}`, { provider: 'Esso', card_ref: 'N1', status: 'active', user_id: pat.id, vehicle_id: vanA });
  assert.equal((await get('SELECT driver_id FROM vehicles WHERE id = ?', vanA)).driver_id, pat.id);
  await admin('POST', `/vehicles/${vanA}`, { reg: 'MT01 AAA', driver_id: '' });
  assert.equal((await get('SELECT vehicle_id FROM fuel_cards WHERE id = ?', named)).vehicle_id, null);
  await run('DELETE FROM vehicles WHERE id = ?', vanA);
  await run('DELETE FROM fuel_cards WHERE id = ?', named);
  const gone = (await run("INSERT INTO fuel_cards (provider, card_ref, status) VALUES ('Esso', 'X9', 'active')")).lastInsertRowid;
  assert.equal((await admin('POST', `/fuel-cards/${gone}/delete`)).location, '/fuel-cards');
  assert.equal(await get('SELECT id FROM fuel_cards WHERE id = ?', gone), undefined);
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
  // Give two cards to Dave from the card form; the assign board has gone.
  await admin('POST', `/fuel-cards/${esso}`, { provider: 'Esso', card_ref: '12', card_number: '7064 0560 7223 5900 127', holder: 'Dave Driver', status: 'active', expiry: '2027-06', user_id: dave });
  await admin('POST', `/fuel-cards/${key}`, { provider: 'Key Fuels', card_ref: 'K7', card_number: '5555', status: 'active', user_id: dave });
  assert.equal((await admin('POST', `/fuel-cards/${key}`, { provider: 'Key Fuels', card_ref: 'K7', status: 'active', user_id: '99999' })).status, 400);
  assert.equal((await get('SELECT COUNT(*) AS n FROM fuel_cards WHERE user_id = ?', dave)).n, 2);
  assert.equal((await admin('GET', '/fuel-cards/assign')).status, 404);

  assert.equal((await admin('GET', '/admin')).location, '/projects');
  // Reports: the office can run each one; drivers can't.
  assert.match((await admin('GET', '/reports')).text, /Save as PDF/);
  for (const k of ['plant', 'fleet', 'fuel-cards', 'equipment', 'employees', 'projects']) assert.equal((await admin('GET', `/reports/${k}`)).status, 200, k);
  assert.match((await admin('GET', '/reports/fuel-cards')).text, /7064 0560 7223 5900 127/);
  assert.match((await admin('GET', '/users/new')).text, /Who can see what/);
  const dash = await admin('GET', '/');
  assert.match(dash.text, /To do/);
  assert.match((await admin('GET', '/calendar')).text, /id="cal-data"/);
  assert.match(dash.text, /MOT/);

  // Driver does a walk-around with a defect, a plant check and logs fuel with a receipt.
  const driver = client();
  await driver('POST', '/login', { email: 'dave@test.local', password: 'driverpass1' });
  assert.match((await driver('GET', '/')).text, /Do today&#39;s walk-around check|Do today's walk-around check/);
  assert.equal((await driver('GET', '/plant')).status, 403);
  assert.equal((await driver('GET', '/fuel')).status, 403);
  assert.equal((await driver('GET', '/fuel-cards')).status, 403);
  // Dave only sees his own two cards; other people's cards and the spare are hidden and refused.
  const fuelForm = (await driver('GET', '/fuel/new')).text;
  assert.doesNotMatch(fuelForm, /7064056072235900127|7064 0560/);
  const mine = fuelForm.split('label="My fuel cards"')[1].split('</optgroup>')[0];
  assert.equal((mine.match(/<option value="\d+"/g) || []).length, 2);
  assert.doesNotMatch(fuelForm, /FastFuels #Spare/);
  const spare = (await get("SELECT id FROM fuel_cards WHERE card_ref = 'Spare'")).id;
  assert.equal((await driver('POST', '/fuel', { vehicle_id: vehicle.id, fuel_type: 'diesel', litres: '10', fuel_card_id: spare })).status, 403);
  assert.equal((await admin('GET', '/vehicles/abc')).status, 404);
  assert.equal(status.isValidDate('2026-02-31'), false);

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
  // Until a project is assigned to them they see no plant; then they see that project's plant and equipment.
  assert.doesNotMatch((await manager('GET', '/plant')).text, /MCL-EX-0001/);
  assert.equal((await manager('GET', `/plant/${plant.id}`)).status, 403);
  const samId = (await get("SELECT id FROM users WHERE email = 'sam@test.local'")).id;
  await admin('POST', '/projects', { code: 'J100', name: 'Test job', active: '1', manager_id: samId });
  assert.match((await admin('GET', '/projects/J100')).text, /Sam Site/);
  const slingId = (await get("SELECT id FROM plant WHERE description = '2 leg chain sling'")).id;
  await admin('POST', '/projects/J100/plant', { plant_id: slingId });
  assert.equal((await get('SELECT job_ref FROM plant WHERE id = ?', slingId)).job_ref, 'J100');
  // For plant they add check sheets and report defects; services, tests, repairs and documents are for the office.
  assert.equal((await manager('POST', `/plant/${plant.id}/records`, { kind: 'service', record_date: status.isoDate() })).status, 403);
  assert.equal((await manager('POST', `/plant/${plant.id}/records`, { kind: 'planned', record_date: '2099-01-01', notes: 'x' })).status, 403);
  assert.doesNotMatch((await manager('GET', `/plant/${plant.id}`)).text, /Add record/);
  assert.equal((await manager('POST', '/defects', { asset: `plant:${plant.id}`, description: 'Cracked mirror' })).status, 302);
  const mDash = (await manager('GET', '/')).text;
  assert.match(mDash, /To do/);
  assert.match(mDash, /My vehicle and fuel card/);
  assert.equal((await manager('GET', '/calendar')).status, 200);
  assert.equal((await manager('GET', '/projects')).status, 403);
  assert.equal((await manager('GET', '/fuel-cards')).status, 403);
  assert.match((await manager('GET', '/plant')).text, /MCL-EX-0001/);
  assert.match((await manager('GET', '/equipment')).text, /2 leg chain sling/);
  assert.doesNotMatch((await manager('GET', '/plant')).text, /2 leg chain sling/);
  assert.equal((await manager('GET', `/plant/${plant.id}/edit`)).status, 403);
  assert.doesNotMatch((await manager('GET', `/plant/${plant.id}`)).text, /Weekly hire rate/);
  assert.equal((await manager('GET', `/vehicles/${vehicle.id}`)).status, 403);
  assert.equal((await manager('GET', '/users')).status, 403);

  assert.equal((await manager('POST', '/checks/plant', { asset_id: plant.id, check_date: status.isoDate(), reading: '1004.5', job_ref: 'NOPE', ...checklist(PLANT_ITEMS, -1) })).status, 400);
  await admin('POST', '/projects', { code: 'J200', name: 'Test site', active: '1' });
  assert.equal((await manager('POST', '/checks/plant', { asset_id: plant.id, check_date: status.isoDate(), reading: '1004.5', job_ref: 'J200', ...checklist(PLANT_ITEMS, -1) })).status, 400);
  await admin('POST', '/projects/J200', { name: 'Test site', active: '1', manager_id: samId });
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
  assert.notEqual((await driver('GET', '/reports/plant')).status, 200);
  // A fill logged by the office counts against the vehicle's driver, not the admin who typed it.
  const byOffice = new FormData();
  for (const [k, v] of [['vehicle_id', vehicle.id], ['fuel_type', 'diesel'], ['litres', '20']]) byOffice.append(k, v);
  byOffice.append('receipt', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }), 'r2.jpg');
  await admin('POST', '/fuel', byOffice);
  const office = await get('SELECT f.driver_id, v.driver_id AS vehicle_driver FROM fuel_entries f JOIN vehicles v ON v.id = f.vehicle_id ORDER BY f.id DESC LIMIT 1');
  assert.ok(office.vehicle_driver && office.driver_id === office.vehicle_driver);
  await run('DELETE FROM fuel_entries WHERE id = (SELECT MAX(id) FROM fuel_entries)');

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
  // Backdated paperwork is kept in the history but doesn't roll the machine's service back; future dates are refused.
  await admin('POST', `/plant/${plant.id}/records`, { kind: 'service', record_date: '2024-01-10', reading: '500' });
  assert.equal((await get('SELECT last_service_hours FROM plant WHERE id = ?', plant.id)).last_service_hours, 1004.5);
  assert.equal((await admin('POST', `/plant/${plant.id}/records`, { kind: 'service', record_date: '2099-01-01' })).status, 400);
  // A planned repair is booked for a future date, shows on the calendar, then is marked as done.
  await admin('POST', `/plant/${plant.id}/records`, { kind: 'planned', record_date: '2099-03-01', notes: 'Replace track tensioner', done_by: 'Finning' });
  const planned = await get("SELECT * FROM service_records WHERE planned = 1");
  assert.equal(planned.record_date, '2099-03-01');
  assert.match((await admin('GET', '/calendar')).text, /Planned repair/);
  assert.match((await admin('GET', `/plant/${plant.id}`)).text, /Mark as done/);
  await admin('POST', `/plant/${plant.id}/records/${planned.id}/done`, { record_date: status.isoDate() });
  assert.equal((await get('SELECT planned FROM service_records WHERE id = ?', planned.id)).planned, 0);
  assert.doesNotMatch((await admin('GET', '/calendar')).text, /Replace track tensioner/);
  assert.match((await admin('GET', `/plant/${plant.id}`)).text, /1,500 hr service/);
  await admin('POST', `/plant/${sling.id}/records`, { kind: 'loler', record_date: status.isoDate(), cert_no: 'C123' });
  assert.equal((await get('SELECT cert_no FROM plant WHERE id = ?', sling.id)).cert_no, 'C123');
  await admin('POST', `/vehicles/${vehicle.id}/records`, { kind: 'mot', record_date: '2026-03-01' });
  assert.equal((await get('SELECT mot_due FROM vehicles WHERE id = ?', vehicle.id)).mot_due, '2027-02-28');

  // Records and defects can carry documents; they show on the asset page and only to people who can see the asset.
  const pdf = () => new Blob([Buffer.from('%PDF-1.4')], { type: 'application/pdf' });
  const exam = new FormData();
  exam.append('kind', 'thorough');
  exam.append('record_date', status.isoDate());
  exam.append('cert_no', 'TE9');
  exam.append('docs', pdf(), 'Thorough exam.pdf');
  assert.equal((await admin('POST', `/plant/${sling.id}/records`, exam)).status, 302);
  const examDoc = await get("SELECT * FROM documents WHERE kind = 'thorough'");
  assert.ok(examDoc.record_id);
  assert.equal((await admin('GET', `/documents/${examDoc.id}`)).status, 200);
  assert.equal((await manager('GET', `/documents/${examDoc.id}`)).status, 200);
  assert.equal((await driver('GET', `/documents/${examDoc.id}`)).status, 404);
  assert.match((await admin('GET', `/plant/${sling.id}`)).text, /Thorough exam\.pdf/);
  const vDefect = new FormData();
  vDefect.append('kind', 'defect');
  vDefect.append('notes', 'Cracked windscreen');
  vDefect.append('severity', 'major');
  vDefect.append('docs', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }), 'screen.jpg');
  assert.equal((await admin('POST', `/vehicles/${vehicle.id}/records`, vDefect)).status, 302);
  const screen = await get("SELECT d.* FROM documents d JOIN defects f ON f.id = d.defect_id WHERE f.description = 'Cracked windscreen'");
  assert.equal(screen.asset_type, 'vehicle');
  assert.equal((await driver('GET', `/documents/${screen.id}`)).status, 200);
  assert.equal((await manager('GET', `/documents/${screen.id}`)).status, 404);
  const svg = new FormData();
  svg.append('asset', `plant:${sling.id}`);
  svg.append('docs', new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'x.svg');
  assert.equal((await admin('POST', '/documents', svg)).status, 400);
  const later = new FormData();
  later.append('docs', pdf(), 'Invoice 55.pdf');
  const wd = await get("SELECT id FROM defects WHERE description = 'Cracked windscreen'");
  assert.equal((await admin('POST', `/defects/${wd.id}/documents`, later)).status, 302);
  assert.match((await admin('GET', '/defects?status=all')).text, /Invoice 55\.pdf/);
  await run("DELETE FROM defects WHERE description = 'Cracked windscreen'");

  const defect = await get("SELECT id FROM defects WHERE asset_type = 'vehicle'");
  await admin('POST', `/defects/${defect.id}/resolve`, { resolution: 'Tyre replaced' });
  assert.equal((await get('SELECT status FROM defects WHERE id = ?', defect.id)).status, 'resolved');
  // A resolved date can be given; it can't be in the future.
  await admin('POST', `/defects/${defect.id}/reopen`, {});
  const day = (await get('SELECT reported_at FROM defects WHERE id = ?', defect.id)).reported_at.slice(0, 10);
  await admin('POST', `/defects/${defect.id}/resolve`, { resolution: 'Tyre replaced', resolved_date: day });
  assert.equal((await get('SELECT resolved_at FROM defects WHERE id = ?', defect.id)).resolved_at.slice(0, 10), day);
  await admin('POST', `/defects/${defect.id}/reopen`, {});
  await admin('POST', `/defects/${defect.id}/resolve`, { resolution: 'x', resolved_date: '2999-01-01' });
  assert.equal((await get('SELECT status FROM defects WHERE id = ?', defect.id)).status, 'open');
  await admin('POST', `/defects/${defect.id}/resolve`, { resolution: 'Tyre replaced' });

  assert.equal((await admin('GET', '/export/fuel.csv')).status, 404);
  await run('DELETE FROM fuel_entries');
});

test('training matrix and view-only managers', async () => {
  const admin = client();
  await admin('POST', '/login', { email: 'admin@test.local', password: 'adminpass1' });
  await admin('POST', '/users', { name: 'Mia Manager', email: 'mia@test.local', password: 'managerpass1', role: 'driver', employee_type: 'manager', job_title: 'Contracts Manager' });
  await admin('POST', '/users', { name: 'Tess Trained', role: 'driver', employee_type: 'worker', job_title: 'Groundworker' });
  const tess = await get("SELECT id FROM users WHERE name = 'Tess Trained'");
  const cscs = await get("SELECT id FROM training_courses WHERE key = 'cscs'");
  const smsts = await get("SELECT id FROM training_courses WHERE key = 'smsts'");
  const first = await get("SELECT id FROM training_courses WHERE key = 'first_aid'");
  assert.ok(cscs && smsts && first);

  // Admin adds Tess and records her training: one in date, one due within 30 days, one expired, one needed.
  assert.equal((await admin('POST', '/training/people', { user_id: tess.id })).location, `/training/people/${tess.id}`);
  assert.equal((await admin('POST', `/training/people/${tess.id}`, { [`expiry_${cscs.id}`]: '2026-02-31' })).status, 400);
  assert.equal((await admin('POST', `/training/people/${tess.id}`, {
    [`expiry_${cscs.id}`]: status.addDays(status.isoDate(), 400),
    [`expiry_${smsts.id}`]: status.addDays(status.isoDate(), 10), [`note_${smsts.id}`]: 'Booked 19/10/26',
    [`expiry_${first.id}`]: status.addDays(status.isoDate(), -3),
    [`required_${cscs.id + 1}`]: '1', training_funded: 'Company',
  })).status, 302);
  const dash = (await admin('GET', '/training')).text;
  assert.match(dash, /Tess Trained/);
  assert.match(dash, /SMSTS/);
  assert.match((await admin('GET', '/training?show=expired')).text, /First Aid/i);
  assert.match((await admin('GET', '/training?show=needed')).text, /Tess Trained/);
  const matrix = (await admin('GET', '/training/matrix')).text;
  assert.match(matrix, /tm soon/);
  assert.match(matrix, /tm overdue/);
  assert.match(matrix, /tm needed/);
  assert.equal((await admin('POST', '/training/courses', { name: 'Hand Arm Vibration', grp: 'General' })).status, 302);
  assert.match((await admin('GET', '/training/matrix?group=General')).text, /Hand Arm Vibration/);

  // Managers see everything read-only, apart from the Training Matrix and full card numbers.
  const mia = client();
  assert.equal((await mia('POST', '/login', { email: 'mia@test.local', password: 'managerpass1' })).location, '/');
  for (const url of ['/', '/plant', '/vehicles', '/fuel', '/fuel/log', '/fuel-cards', '/users', '/projects', '/reports']) assert.equal((await mia('GET', url)).status, 200, url);
  assert.equal((await mia('GET', '/training')).status, 403);
  assert.equal((await mia('GET', '/training/matrix')).status, 403);
  assert.equal((await mia('GET', '/users/new')).status, 403);
  assert.equal((await mia('POST', '/projects', { code: 'M99-001', name: 'X' })).status, 403);
  assert.equal((await mia('POST', `/training/people/${tess.id}/remove`, {})).status, 403);
  assert.doesNotMatch((await mia('GET', '/')).text, /href="\/training"/);
  assert.match((await admin('GET', '/')).text, /href="\/training"/);

  await admin('POST', `/training/people/${tess.id}/remove`, {});
  assert.equal((await get('SELECT on_matrix FROM users WHERE id = ?', tess.id)).on_matrix, 0);
});
