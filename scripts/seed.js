// Loads demo data so you can try the app. Run with: npm run seed -- --force
// --force wipes the existing database first. Do not run this on live data.
const bcrypt = require('bcryptjs');
const { run, get, exec, transaction, close, TABLES } = require('../src/db');
const storage = require('../src/storage');
const { isoDate, addDays, addMonths } = require('../src/status');
const { VEHICLE_ITEMS, PLANT_ITEMS } = require('../src/checklists');

const force = process.argv.includes('--force');

const today = isoDate();
const d = (n) => addDays(today, n);
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

async function main() {
  const hasData = (await get('SELECT COUNT(*) AS n FROM plant')).n + (await get('SELECT COUNT(*) AS n FROM vehicles')).n > 0;
  if (hasData && !force) {
    console.error('The database already has plant or vehicles. Run "npm run seed -- --force" to wipe it and load demo data.');
    process.exitCode = 1;
    return;
  }
  const receipts = [];
  await transaction(async () => {
  await exec(`TRUNCATE ${TABLES.filter((t) => !['settings', 'projects'].includes(t)).join(', ')} RESTART IDENTITY CASCADE`);

  const hash = bcrypt.hashSync('password123', 10);
  const user = async (name, email, role, type, title) => (await run('INSERT INTO users (name, email, password_hash, role, employee_type, job_title) VALUES (?, ?, ?, ?, ?, ?)',
    name, email, hash, role, role === 'admin' ? null : type, title)).lastInsertRowid;
  const admin = await user('Office Admin', 'admin@marley.local', 'admin', null, 'Office Manager');
  await user('Sarah Admin Assistant', 'office@marley.local', 'admin', null, 'Admin Assistant');
  const drivers = [
    await user('Dave Thompson', 'dave@marley.local', 'driver', 'driver', 'Groundworker'),
    await user('Gary Hughes', 'gary@marley.local', 'driver', 'driver', 'Plant Operator'),
    await user('Lee Parker', 'lee@marley.local', 'driver', 'driver', 'Ganger'),
    await user('Kieran Walsh', 'kieran@marley.local', 'driver', 'site_manager', 'Site Manager'),
  ];

  // Demo assets only – not Marley's real register.
  const site = { 'MC-2041': 'Riverside Housing, Scunthorpe', 'MC-2055': 'Epworth Road Drainage', 'MC-2060': 'Crowle Depot' };
  const machine = async (no, category, owner, desc, make, model, job, hours, lastHrs, insp, months, lastInsp, extra = {}) => (await run(
    `INSERT INTO plant (plant_no, category, owner, description, make, model, serial_no, registered, job_ref, location, running_hours, service_schedule,
      service_interval_hours, last_service_hours, last_service_date, tracks_hours, weekly_checks, loler_required, inspection_type, loler_interval_months,
      last_loler_date, purchase_price, purchase_date, transfer_price, weekly_hire_rate, service_plan)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'dumper' THEN '100, 250, 500' ELSE '50, 250, 500' END, 500, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    no, category, owner, desc, make, model, extra.serial || `DEMO${Math.floor(rand() * 900000 + 100000)}`, extra.year || '2021', job, site[job], hours, category, lastHrs, d(-90),
    insp === 'none' ? 0 : 1, insp, months, lastInsp, extra.price ?? null, extra.bought ?? null, extra.transfer ?? null, extra.hire ?? null, extra.plan ? 1 : 0)).lastInsertRowid;
  const plant = [];
  for (const args of [
    ['MCL-EX-0001', 'excavator', 'MCL', '24t tracked excavator', 'JCB', '245 XRL', 'MC-2041', 3520, 3010, 'loler', 12, d(-300), { plan: true }],
    ['MCL-EX-0002', 'excavator', 'MCL', '8t midi excavator', 'Kubota', 'KX080-4', 'MC-2041', 1478, 1005, 'loler', 12, d(-350)],
    ['MCL-EX-0003', 'excavator', 'MCL', '2.7t mini excavator', 'Kubota', 'U27-4', 'MC-2055', 188, 45, 'loler', 12, d(-120), { year: '2026', plan: true }],
    ['MPL-DU-0001', 'dumper', 'MPL', '3t straight tip dumper', 'Thwaites', 'MACH2081', 'MC-2041', 744, 498, 'thorough', 12, d(-200), { price: 24000, bought: d(-200), transfer: 6275, hire: 110 }],
    ['MPL-EX-0001', 'excavator', 'MPL', '5.5t excavator', 'Kubota', 'KX057-4', 'MC-2055', 5145, 4990, 'loler', 12, d(-60), { price: 41000, bought: d(-200), transfer: 17250, hire: 300 }],
    ['MCL-RO-0001', 'roller', 'MCL', '1.5t tandem roller', 'Hamm', 'HD12', 'MC-2060', 410, 205, 'none', 12, null],
  ]) plant.push(await machine(...args));
  const equipment = [
    ['MCL-C&S-0001', 'chains', '10mm 2 leg chain sling', 'thorough', 6, d(-170), { swl: '4.25T @ 0-45°', loc: 'Riverside Housing' }],
    ['MCL-C&S-0002', 'chains', '13mm single leg chain sling', 'thorough', 6, d(-40), { swl: '5.3T', loc: 'Crowle Depot' }],
    ['MCL-ATT-0001', 'attachment', 'Pallet forks 14t', 'loler', 6, d(-150), { loc: 'Riverside Housing' }],
    ['MCL-SUR-0001', 'survey', 'Topcon RL-H5A rotating laser', 'calibration', 12, d(-350), { cert: 'DEMO-301', loc: 'Epworth Road Drainage' }],
    ['MCL-C&G-0001', 'cat_genny', 'CAT & Genny set', 'calibration', 12, d(-380), { cert: 'DEMO-290', loc: 'Crowle Depot' }],
    ['MCL-CT-0001', 'cutting', 'Husqvarna K770 14" cut-off saw', 'none', 12, null, { loc: 'Epworth Road Drainage' }],
    ['MCL-CON-0001', 'container', '20ft site container', 'none', 12, null, { loc: 'Riverside Housing' }],
    ['MPL-VB-0001', 'compaction', 'Bomag BPR 35/60 vibratory plate', 'none', 12, null, { loc: 'Crowle Depot', owner: 'MPL', hire: 65 }],
  ];
  for (const [no, category, desc, insp, months, last, x] of equipment) {
    await run(`INSERT INTO plant (plant_no, category, owner, description, location, swl, cert_no, tracks_hours, weekly_checks, loler_required, inspection_type,
      loler_interval_months, last_loler_date, weekly_hire_rate) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`,
      no, category, x.owner || 'MCL', desc, x.loc, x.swl || null, x.cert || null, insp === 'none' ? 0 : 1, insp, months, last, x.hire || null);
  }
  await run(`UPDATE plant SET service_months = 12 WHERE tracks_hours = 1`);
  await run(`UPDATE plant SET status = 'repair', notes = 'At dealer for hydraulic pump repair' WHERE plant_no = 'MPL-EX-0001'`);

  const vehicleRows = [
    ['YX21 KPL', 'MCL-VAN-0001', 'Ford', 'Transit Custom', 'White', 'Van', 'diesel', drivers[0], 48210, d(-200), d(140), d(20)],
    ['YT70 HBD', 'MCL-VAN-0002', 'Toyota', 'Hilux', 'Silver', 'Pickup', 'diesel', drivers[1], 61877, d(-400), d(12), d(95)],
    ['YK19 RVO', 'MCL-VAN-0003', 'Iveco', 'Daily 3.5t Tipper', 'White', 'Tipper', 'diesel', drivers[2], 88340, d(-150), d(230), d(-3)],
    ['FD22 WMX', 'MCL-VAN-0004', 'Ford', 'Ranger', 'Black', 'Pickup', 'diesel', drivers[3], 31502, d(-60), d(300), d(180)],
    ['YB68 TZC', 'MCL-VAN-0005', 'Vauxhall', 'Corsa', 'Grey', 'Car', 'unleaded', admin, 54120, d(-330), d(45), d(210)],
  ];
  const vehicles = [];
  for (const [reg, asset, make, model, colour, type, fuel, driver, miles, svc, mot, tax] of vehicleRows) vehicles.push((await run(
    `INSERT INTO vehicles (reg, asset_no, make, model, colour, vehicle_type, fuel_type, driver_id, mileage, last_service_date, mot_due, tax_due, tracked)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'yes')`, reg, asset, make, model, colour, type, fuel, driver, miles, svc, mot, tax)).lastInsertRowid);
  await run(`INSERT INTO vehicles (reg, asset_no, make, model, colour, vehicle_type, fuel_type, user_name, status, mot_due, tax_due, notes, tracked)
       VALUES ('VK62 DMO', 'MCL-VAN-0006', 'Ford', 'Transit Tipper 350', 'White', 'Tipper', 'diesel', NULL, 'sorn', ?, ?, 'SORN – reference held in office', 'yes')`, d(-100), d(-70));
  await run(`INSERT INTO vehicles (reg, category, make, model, colour, fuel_type, user_name, mot_due, tax_due)
       VALUES ('YY74 DMO', 'director', 'Land Rover', 'Defender', 'Black', 'diesel', 'Director (demo)', ?, ?)`, d(500), d(250));
  for (const [k, provider] of ['Esso', 'Key Fuels (The Fuelcard Company)'].entries()) for (const [i, vid] of vehicles.entries()) {
    if ((i + k) % 2) continue;
    const v = await get('SELECT v.*, u.name FROM vehicles v LEFT JOIN users u ON u.id = v.driver_id WHERE v.id = ?', vid);
    // Some cards left unassigned so the assign board has something to drag.
    const userId = k === 1 && i > 3 ? null : v.driver_id;
    await run(`INSERT INTO fuel_cards (provider, card_ref, last4, user_id, vehicle_id, card_type, expiry, status) VALUES (?, ?, ?, ?, ?, 'Diesel / Unleaded', ?, 'active')`,
      provider, String(i + 1), String(1000 + Math.floor(rand() * 8999)), userId, vid, addMonths(today, 6 + i * 7).slice(0, 7));
  }
  await run(`UPDATE fuel_cards SET expiry = ? WHERE id = 1`, addMonths(today, 1).slice(0, 7));
  // Spare cards in the office, not given to anyone yet.
  for (const [provider, ref, last4] of [['Esso', 'S1', '2281'], ['Key Fuels (The Fuelcard Company)', 'S2', '6043'], ['FastFuels (Silvey)', 'S3', '9152']]) {
    await run(`INSERT INTO fuel_cards (provider, card_ref, last4, card_type, expiry, status) VALUES (?, ?, ?, 'Diesel / Unleaded', ?, 'active')`, provider, ref, last4, addMonths(today, 20).slice(0, 7));
  }
  // Drivers can hold more than one card: give Dave a second, AdBlue-only card.
  await run(`INSERT INTO fuel_cards (provider, card_ref, last4, user_id, card_type, expiry, status)
       VALUES ('FastFuels (Silvey)', 'F3', '4410', (SELECT id FROM users WHERE email = 'dave@marley.local'), 'Diesel / AdBlue', ?, 'active')`, addMonths(today, 14).slice(0, 7));

  // Weekly plant checks (one machine left overdue), daily walk-arounds (one vehicle not done today).
  for (const [i, pid] of plant.entries()) {
    const p = await get('SELECT * FROM plant WHERE id = ?', pid);
    if (p.status === 'repair') continue;
    const weeks = i === 3 ? [-12, -19] : [-(i % 6), -(i % 6) - 7, -(i % 6) - 14];
    for (const [w, offset] of weeks.entries()) {
      const defect = i === 0 && w === 0;
      const results = PLANT_ITEMS.map((item, k) => ({ item, result: defect && k === 1 ? 'defect' : 'ok' }));
      const cid = (await run(`INSERT INTO plant_checks (plant_id, user_id, check_date, hours, job_ref, results, defects_found) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        pid, pick(drivers), d(offset), p.running_hours - w * 38, p.job_ref, JSON.stringify(results), defect ? 1 : 0)).lastInsertRowid;
      if (defect) await run(`INSERT INTO defects (asset_type, asset_id, check_id, description, severity, reported_by, reported_at) VALUES ('plant', ?, ?, ?, 'major', ?, ?)`,
        pid, cid, 'Hydraulic oil level and hoses (no leaks): weeping hose on boom ram', drivers[0], d(offset) + ' 07:42:00');
    }
    for (const m of [p.category === 'dumper' ? 100 : 50, 250, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000].filter((h) => h <= p.last_service_hours + 50)) {
      const hrs = Math.min(m + Math.round((rand() - 0.6) * 20), p.last_service_hours);
      await run(`INSERT INTO service_records (asset_type, asset_id, kind, record_date, reading, done_by, user_id) VALUES ('plant', ?, 'service', ?, ?, 'Marley workshop', ?)`,
        pid, d(-Math.round((p.running_hours - hrs) / 5) - 1), m >= p.last_service_hours - 60 ? p.last_service_hours : hrs, admin);
    }
    if (p.last_loler_date) await run(`INSERT INTO service_records (asset_type, asset_id, kind, record_date, done_by, notes, user_id) VALUES ('plant', ?, 'loler', ?, 'Allianz Engineering', 'Thorough examination – no defects', ?)`, pid, p.last_loler_date, admin);
  }

  for (const [i, vid] of vehicles.entries()) {
    const v = await get('SELECT * FROM vehicles WHERE id = ?', vid);
    for (let day = 13; day >= 0; day--) {
      if (day === 0 && i === 2) continue;
      if ([5, 6].includes(new Date(Date.now() - day * 86400000).getDay())) continue;
      const defect = i === 1 && day === 2;
      const results = VEHICLE_ITEMS.map((item, k) => ({ item, result: defect && k === 1 ? 'defect' : 'ok' }));
      const cid = (await run(`INSERT INTO vehicle_checks (vehicle_id, user_id, check_date, mileage, results, defects_found) VALUES (?, ?, ?, ?, ?, ?)`,
        vid, v.driver_id, d(-day), v.mileage - day * 60, JSON.stringify(results), defect ? 1 : 0)).lastInsertRowid;
      if (defect) await run(`INSERT INTO defects (asset_type, asset_id, check_id, description, severity, reported_by, reported_at) VALUES ('vehicle', ?, ?, ?, 'minor', ?, ?)`,
        vid, cid, 'Tyres and wheel nuts: nearside rear tyre close to the legal limit', v.driver_id, d(-day) + ' 07:15:00');
    }
  }
  await run(`INSERT INTO defects (asset_type, asset_id, description, severity, reported_by) VALUES ('plant', ?, 'Reversing alarm not working', 'unsafe', ?)`, plant[3], drivers[1]);

  // Fuel over the last ~70 days with receipts; older entries priced and checked by the office.
  const prices = { diesel: 1.43, unleaded: 1.36, adblue: 0.89 };
  const stations = ['Tesco Scunthorpe', 'BP Epworth', 'Shell Crowle', 'Esso Thorne', 'Morrisons Gainsborough'];
  for (const [i, vid] of vehicles.entries()) {
    const v = await get('SELECT * FROM vehicles WHERE id = ?', vid);
    let miles = v.mileage - 2600;
    for (let day = 70 - i * 2; day >= 0; day -= 4 + Math.floor(rand() * 4)) {
      const isAdblue = v.fuel_type === 'diesel' && rand() < 0.15;
      const type = isAdblue ? 'adblue' : v.fuel_type;
      const litres = isAdblue ? Math.round(10 + rand() * 10) : Math.round((40 + rand() * 35 + i * 4) * 100) / 100;
      if (!isAdblue) miles += Math.round(litres * 8 + rand() * 60);
      const date = d(-day);
      const file = `receipt-demo-${vid}-${day}.svg`;
      const cost = Math.round(litres * (prices[type] + (rand() - 0.5) * 0.06) * 100) / 100;
      receipts.push([file, receiptSvg(pick(stations), date, type, litres, cost)]);
      const checked = day > 6;
      const card = await get('SELECT id FROM fuel_cards WHERE vehicle_id = ? LIMIT 1', vid);
      await run(`INSERT INTO fuel_entries (vehicle_id, user_id, fill_date, fuel_type, litres, mileage, station, receipt_file, receipt_name, cost, verified, priced_by, priced_at, fuel_card_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        vid, v.driver_id, date, type, litres, isAdblue ? null : miles, null, file, 'receipt.jpg',
        checked ? cost : null, checked ? 1 : 0, checked ? admin : null, checked ? date + ' 16:00:00' : null, card ? card.id : null);
    }
  }
  });
  // Receipt images go to storage after the database rows are in.
  for (const [file, svg] of receipts) await storage.save(file, Buffer.from(svg)).catch((err) => { if (err.code !== 'EEXIST') throw err; });
}

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

main().then(() => close()).then(() => process.exitCode || console.log('Demo data loaded. Password password123 for admin@marley.local (admin), kieran@marley.local (site manager) and dave@marley.local (fleet driver).')).catch((err) => { console.error(err); process.exit(1); });
