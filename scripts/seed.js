// Loads demo data so you can try the app. Run with: npm run seed -- --force
// --force wipes the existing database first. Do not run this on live data.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db, run, get, transaction, UPLOAD_DIR } = require('../src/db');
const { isoDate, addDays, addMonths } = require('../src/status');
const { VEHICLE_ITEMS, PLANT_ITEMS } = require('../src/checklists');

const force = process.argv.includes('--force');
const hasData = get('SELECT COUNT(*) AS n FROM plant').n + get('SELECT COUNT(*) AS n FROM vehicles').n > 0;
if (hasData && !force) {
  console.error('The database already has plant or vehicles. Run "npm run seed -- --force" to wipe it and load demo data.');
  process.exit(1);
}

const today = isoDate();
const d = (n) => addDays(today, n);
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

transaction(() => {
  for (const t of ['fuel_entries', 'defects', 'vehicle_checks', 'plant_checks', 'service_records', 'vehicles', 'plant', 'users']) db.exec(`DELETE FROM ${t}`);
  for (const f of fs.readdirSync(UPLOAD_DIR)) if (f.startsWith('receipt-demo-')) fs.rmSync(path.join(UPLOAD_DIR, f));

  const hash = bcrypt.hashSync('password123', 10);
  const user = (name, email, role) => run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', name, email, hash, role).lastInsertRowid;
  const admin = user('Office Admin', 'admin@marley.local', 'admin');
  user('Sarah Admin Assistant', 'office@marley.local', 'admin');
  const drivers = [
    user('Dave Thompson', 'dave@marley.local', 'driver'),
    user('Gary Hughes', 'gary@marley.local', 'driver'),
    user('Lee Parker', 'lee@marley.local', 'driver'),
    user('Kieran Walsh', 'kieran@marley.local', 'driver'),
  ];

  const plant = [
    ['MC-EX01', '13t tracked excavator', 'JCB', 'JS131', 'MC-2041', 2412, 500, 1950, 1, 12, d(-300)],
    ['MC-EX02', '8t midi excavator', 'Kubota', 'KX080-4', 'MC-2041', 1630, 500, 1400, 1, 12, d(-350)],
    ['MC-MX01', '3t mini excavator', 'Takeuchi', 'TB230', 'MC-2055', 988, 250, 760, 1, 12, d(-120)],
    ['MC-DP01', '6t swivel dumper', 'Thwaites', 'MACH 2090', 'MC-2041', 744, 250, 700, 0, 12, null],
    ['MC-TH01', 'Telehandler 14m', 'JCB', '540-140', 'MC-2055', 3105, 500, 2580, 1, 6, d(-170)],
    ['MC-RL01', 'Ride-on roller 1.5t', 'Bomag', 'BW 90 AD-5', 'MC-2060', 410, 250, 250, 0, 12, null],
    ['MC-GEN1', '20kVA generator', 'SDMO', 'R22C3', 'MC-2060', 5220, 500, 4600, 0, 12, null],
  ].map(([no, desc, make, model, job, hours, interval, lastHrs, loler, lolerMonths, lolerDate]) => run(
    `INSERT INTO plant (plant_no, description, make, model, job_ref, location, running_hours, service_interval_hours, last_service_hours, last_service_date,
      loler_required, loler_interval_months, last_loler_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    no, desc, make, model, job, { 'MC-2041': 'Riverside Housing, Scunthorpe', 'MC-2055': 'Epworth Road Drainage', 'MC-2060': 'Crowle Depot' }[job],
    hours, interval, lastHrs, d(-90), loler, lolerMonths, lolerDate).lastInsertRowid);

  const vehicles = [
    ['YX21 KPL', 'Ford', 'Transit Custom', 'Van', 'diesel', drivers[0], 48210, d(-200), d(140), d(20)],
    ['YT70 HBD', 'Toyota', 'Hilux', 'Pickup', 'diesel', drivers[1], 61877, d(-400), d(12), d(95)],
    ['YK19 RVO', 'Iveco', 'Daily 3.5t Tipper', 'Tipper', 'diesel', drivers[2], 88340, d(-150), d(230), d(-3)],
    ['FD22 WMX', 'Ford', 'Ranger', 'Pickup', 'diesel', drivers[3], 31502, d(-60), d(300), d(180)],
    ['YB68 TZC', 'Vauxhall', 'Corsa', 'Car', 'unleaded', admin, 54120, d(-330), d(45), d(210)],
  ].map(([reg, make, model, type, fuel, driver, miles, svc, mot, tax]) => run(
    `INSERT INTO vehicles (reg, make, model, vehicle_type, fuel_type, driver_id, mileage, last_service_date, mot_due, tax_due)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, reg, make, model, type, fuel, driver, miles, svc, mot, tax).lastInsertRowid);

  // Weekly plant checks (one machine left overdue), daily walk-arounds (one vehicle not done today).
  plant.forEach((pid, i) => {
    const p = get('SELECT * FROM plant WHERE id = ?', pid);
    const weeks = i === 3 ? [-12, -19] : [-(i % 6), -(i % 6) - 7, -(i % 6) - 14];
    weeks.forEach((offset, w) => {
      const defect = i === 0 && w === 0;
      const results = PLANT_ITEMS.map((item, k) => ({ item, result: defect && k === 1 ? 'defect' : 'ok' }));
      const cid = run(`INSERT INTO plant_checks (plant_id, user_id, check_date, hours, job_ref, results, defects_found) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        pid, pick(drivers), d(offset), p.running_hours - w * 38, p.job_ref, JSON.stringify(results), defect ? 1 : 0).lastInsertRowid;
      if (defect) run(`INSERT INTO defects (asset_type, asset_id, check_id, description, severity, reported_by, reported_at) VALUES ('plant', ?, ?, ?, 'major', ?, ?)`,
        pid, cid, 'Hydraulic oil level and hoses (no leaks): weeping hose on boom ram', drivers[0], d(offset) + ' 07:42:00');
    });
    run(`INSERT INTO service_records (asset_type, asset_id, kind, record_date, reading, done_by, user_id) VALUES ('plant', ?, 'service', ?, ?, 'Marley workshop', ?)`, pid, d(-90), p.last_service_hours, admin);
    if (p.last_loler_date) run(`INSERT INTO service_records (asset_type, asset_id, kind, record_date, done_by, notes, user_id) VALUES ('plant', ?, 'loler', ?, 'Allianz Engineering', 'Thorough examination – no defects', ?)`, pid, p.last_loler_date, admin);
  });

  vehicles.forEach((vid, i) => {
    const v = get('SELECT * FROM vehicles WHERE id = ?', vid);
    for (let day = 13; day >= 0; day--) {
      if (day === 0 && i === 2) continue;
      if ([5, 6].includes(new Date(Date.now() - day * 86400000).getDay())) continue;
      const defect = i === 1 && day === 2;
      const results = VEHICLE_ITEMS.map((item, k) => ({ item, result: defect && k === 1 ? 'defect' : 'ok' }));
      const cid = run(`INSERT INTO vehicle_checks (vehicle_id, user_id, check_date, mileage, results, defects_found) VALUES (?, ?, ?, ?, ?, ?)`,
        vid, v.driver_id, d(-day), v.mileage - day * 60, JSON.stringify(results), defect ? 1 : 0).lastInsertRowid;
      if (defect) run(`INSERT INTO defects (asset_type, asset_id, check_id, description, severity, reported_by, reported_at) VALUES ('vehicle', ?, ?, ?, 'minor', ?, ?)`,
        vid, cid, 'Tyres and wheel nuts: nearside rear tyre close to the legal limit', v.driver_id, d(-day) + ' 07:15:00');
    }
  });
  run(`INSERT INTO defects (asset_type, asset_id, description, severity, reported_by) VALUES ('plant', ?, 'Reversing alarm not working', 'unsafe', ?)`, plant[4], drivers[1]);

  // Fuel over the last ~70 days with receipts; older entries priced and checked by the office.
  const prices = { diesel: 1.43, unleaded: 1.36, adblue: 0.89 };
  const stations = ['Tesco Scunthorpe', 'BP Epworth', 'Shell Crowle', 'Esso Thorne', 'Morrisons Gainsborough'];
  vehicles.forEach((vid, i) => {
    const v = get('SELECT * FROM vehicles WHERE id = ?', vid);
    let miles = v.mileage - 2600;
    for (let day = 70 - i * 2; day >= 0; day -= 4 + Math.floor(rand() * 4)) {
      const isAdblue = v.fuel_type === 'diesel' && rand() < 0.15;
      const type = isAdblue ? 'adblue' : v.fuel_type;
      const litres = isAdblue ? Math.round(10 + rand() * 10) : Math.round((40 + rand() * 35 + i * 4) * 100) / 100;
      if (!isAdblue) miles += Math.round(litres * 8 + rand() * 60);
      const date = d(-day);
      const file = `receipt-demo-${vid}-${day}.svg`;
      const cost = Math.round(litres * (prices[type] + (rand() - 0.5) * 0.06) * 100) / 100;
      fs.writeFileSync(path.join(UPLOAD_DIR, file), receiptSvg(pick(stations), date, type, litres, cost));
      const checked = day > 6;
      run(`INSERT INTO fuel_entries (vehicle_id, user_id, fill_date, fuel_type, litres, mileage, station, receipt_file, receipt_name, cost, verified, priced_by, priced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        vid, v.driver_id, date, type, litres, isAdblue ? null : miles, null, file, 'receipt.jpg',
        checked ? cost : null, checked ? 1 : 0, checked ? admin : null, checked ? date + ' 16:00:00' : null);
    }
  });
});

function receiptSvg(station, date, type, litres, cost) {
  const label = { diesel: 'DIESEL', unleaded: 'UNLEADED', adblue: 'ADBLUE' }[type];
  const [y, m, dd] = date.split('-');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="480" viewBox="0 0 320 480">
<rect width="320" height="480" fill="#fbfaf6"/><g font-family="Courier New, monospace" fill="#222" font-size="15">
<text x="160" y="50" text-anchor="middle" font-size="20" font-weight="bold">${station.toUpperCase()}</text>
<text x="160" y="75" text-anchor="middle">VAT No. GB 123 4567 89</text>
<text x="24" y="120">${dd}/${m}/${y}   07:${String(10 + Math.floor(rand() * 49))}</text>
<text x="24" y="150">PUMP ${1 + Math.floor(rand() * 8)}  ${label}</text>
<text x="24" y="180">${litres.toFixed(2)} L @ ${(cost / litres).toFixed(3)}</text>
<text x="24" y="230" font-size="20" font-weight="bold">TOTAL</text><text x="296" y="230" text-anchor="end" font-size="20" font-weight="bold">£${cost.toFixed(2)}</text>
<text x="24" y="270">VAT @ 20%</text><text x="296" y="270" text-anchor="end">£${(cost / 6).toFixed(2)}</text>
<text x="24" y="310">FUEL CARD ****${1000 + Math.floor(rand() * 8999)}</text>
<text x="160" y="400" text-anchor="middle">THANK YOU</text></g></svg>`;
}

console.log('Demo data loaded. Sign in as admin@marley.local / password123 (admin) or dave@marley.local / password123 (driver).');
