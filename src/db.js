const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'marley.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'driver' CHECK (role IN ('admin', 'driver')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plant (
  id INTEGER PRIMARY KEY,
  plant_no TEXT NOT NULL UNIQUE COLLATE NOCASE,
  category TEXT NOT NULL DEFAULT 'excavator',
  owner TEXT NOT NULL DEFAULT 'MCL',
  status TEXT NOT NULL DEFAULT 'in_use',
  description TEXT,
  make TEXT,
  model TEXT,
  serial_no TEXT,
  registered TEXT,
  swl TEXT,
  job_ref TEXT,
  location TEXT,
  purchase_price REAL,
  purchase_date TEXT,
  transfer_price REAL,
  weekly_hire_rate REAL,
  service_plan INTEGER NOT NULL DEFAULT 0,
  tracks_hours INTEGER NOT NULL DEFAULT 1,
  weekly_checks INTEGER NOT NULL DEFAULT 1,
  running_hours REAL NOT NULL DEFAULT 0,
  service_schedule TEXT,
  service_months INTEGER,
  service_interval_hours REAL NOT NULL DEFAULT 500,
  last_service_hours REAL,
  last_service_date TEXT,
  loler_required INTEGER NOT NULL DEFAULT 1,
  loler_interval_months INTEGER NOT NULL DEFAULT 12,
  last_loler_date TEXT,
  inspection_type TEXT NOT NULL DEFAULT 'loler',
  inspection_due TEXT,
  cert_no TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY,
  reg TEXT NOT NULL UNIQUE COLLATE NOCASE,
  asset_no TEXT,
  owner TEXT NOT NULL DEFAULT 'MCL',
  category TEXT NOT NULL DEFAULT 'van',
  status TEXT NOT NULL DEFAULT 'active',
  colour TEXT,
  tracked TEXT,
  user_name TEXT,
  purchase_price REAL,
  purchase_date TEXT,
  make TEXT,
  model TEXT,
  vehicle_type TEXT,
  fuel_type TEXT NOT NULL DEFAULT 'diesel',
  driver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  mileage INTEGER,
  last_service_date TEXT,
  service_interval_months INTEGER NOT NULL DEFAULT 12,
  mot_due TEXT,
  tax_due TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Service, LOLER, MOT and tax history for both plant and vehicles.
CREATE TABLE IF NOT EXISTS service_records (
  id INTEGER PRIMARY KEY,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('plant', 'vehicle')),
  asset_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('service', 'loler', 'mot', 'tax', 'repair')),
  record_date TEXT NOT NULL,
  reading REAL,
  next_due TEXT,
  done_by TEXT,
  notes TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plant_checks (
  id INTEGER PRIMARY KEY,
  plant_id INTEGER NOT NULL REFERENCES plant(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  check_date TEXT NOT NULL,
  hours REAL,
  job_ref TEXT,
  results TEXT NOT NULL,
  defects_found INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicle_checks (
  id INTEGER PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  check_date TEXT NOT NULL,
  mileage INTEGER,
  results TEXT NOT NULL,
  defects_found INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS defects (
  id INTEGER PRIMARY KEY,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('plant', 'vehicle')),
  asset_id INTEGER NOT NULL,
  check_id INTEGER,
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor', 'major', 'unsafe')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  reported_by INTEGER REFERENCES users(id),
  reported_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  resolution TEXT
);

-- Fuel cards. Only the last 4 digits are kept; PINs are never stored.
CREATE TABLE IF NOT EXISTS fuel_cards (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  card_ref TEXT,
  last4 TEXT,
  holder TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  card_type TEXT,
  expiry TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'stopped', 'cancelled', 'lost')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fuel_entries (
  id INTEGER PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  fill_date TEXT NOT NULL,
  fuel_type TEXT NOT NULL CHECK (fuel_type IN ('diesel', 'unleaded', 'adblue')),
  litres REAL NOT NULL,
  mileage INTEGER,
  station TEXT,
  fuel_card_id INTEGER REFERENCES fuel_cards(id) ON DELETE SET NULL,
  notes TEXT,
  receipt_file TEXT,
  receipt_name TEXT,
  cost REAL,
  verified INTEGER NOT NULL DEFAULT 0,
  admin_notes TEXT,
  priced_by INTEGER REFERENCES users(id),
  priced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_plant_checks ON plant_checks (plant_id, check_date);
CREATE INDEX IF NOT EXISTS idx_vehicle_checks ON vehicle_checks (vehicle_id, check_date);
CREATE INDEX IF NOT EXISTS idx_defects_asset ON defects (asset_type, asset_id, status);
CREATE INDEX IF NOT EXISTS idx_fuel_date ON fuel_entries (fill_date);
CREATE INDEX IF NOT EXISTS idx_records_asset ON service_records (asset_type, asset_id, kind);
`);

// Add columns introduced after a database was first created.
const MIGRATIONS = {
  plant: ['category TEXT NOT NULL DEFAULT \'excavator\'', 'owner TEXT NOT NULL DEFAULT \'MCL\'', 'status TEXT NOT NULL DEFAULT \'in_use\'',
    'registered TEXT', 'swl TEXT', 'purchase_price REAL', 'purchase_date TEXT', 'transfer_price REAL', 'weekly_hire_rate REAL',
    'service_plan INTEGER NOT NULL DEFAULT 0', 'tracks_hours INTEGER NOT NULL DEFAULT 1', 'weekly_checks INTEGER NOT NULL DEFAULT 1',
    'inspection_type TEXT NOT NULL DEFAULT \'loler\'', 'inspection_due TEXT', 'cert_no TEXT', 'service_schedule TEXT', 'service_months INTEGER'],
  vehicles: ['asset_no TEXT', 'owner TEXT NOT NULL DEFAULT \'MCL\'', 'category TEXT NOT NULL DEFAULT \'van\'', 'status TEXT NOT NULL DEFAULT \'active\'',
    'colour TEXT', 'tracked TEXT', 'user_name TEXT', 'purchase_price REAL', 'purchase_date TEXT'],
  users: ['employee_type TEXT', 'job_title TEXT'],
  fuel_cards: ['user_id INTEGER REFERENCES users(id) ON DELETE SET NULL'],
  fuel_entries: ['fuel_card_id INTEGER REFERENCES fuel_cards(id) ON DELETE SET NULL'],
};
for (const [table, cols] of Object.entries(MIGRATIONS)) {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const col of cols) if (!have.has(col.split(' ')[0])) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`);
}

const all = (sql, ...params) => db.prepare(sql).all(...params);
const get = (sql, ...params) => db.prepare(sql).get(...params);
const run = (sql, ...params) => db.prepare(sql).run(...params);

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { db, all, get, run, transaction, DATA_DIR, UPLOAD_DIR };
