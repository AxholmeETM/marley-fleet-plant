// Asset categories, matching the sheets in Marley's plant & equipment log.
// Each category sets the defaults for a new asset: asset number code, whether it has an
// hour meter (running hours drive servicing), whether it needs a weekly check sheet, and
// what statutory inspection it needs and how often.

const INSPECTION_TYPES = {
  loler: 'LOLER',
  thorough: 'Thorough examination',
  calibration: 'Calibration',
  inspection: 'Inspection',
  none: 'None',
};

// Default service plans (engine hours) from manufacturer schedules: a running-in service at 50 hrs
// (100 hrs on Thwaites-type dumpers), 250 hrs, 500 hrs, then every 500 hrs – or every 12 months,
// whichever comes first. Small petrol plant: 20 hrs then every 100 hrs or 6 months.
const PLAN_DIESEL = { schedule: '50, 250, 500', every: 500, serviceMonths: 12 };
const PLAN_DUMPER = { schedule: '100, 250, 500', every: 500, serviceMonths: 12 };
const PLAN_PETROL = { schedule: '20', every: 100, serviceMonths: 6 };

// The menu splits the register in two: Plant (the machines) and Equipment (everything else).
const PLANT_SECTION = ['excavator', 'dumper', 'roller'];
const SECTIONS = { plant: { href: '/plant', label: 'Plant', noun: 'plant' }, equipment: { href: '/equipment', label: 'Equipment', noun: 'equipment' } };

const CATEGORIES = [
  { key: 'excavator', label: 'Excavators', code: 'EX', hours: true, checks: true, inspection: 'loler', months: 12, ...PLAN_DIESEL },
  { key: 'dumper', label: 'Dumpers', code: 'DU', hours: true, checks: true, inspection: 'thorough', months: 12, ...PLAN_DUMPER },
  { key: 'roller', label: 'Rollers', code: 'RO', hours: true, checks: true, inspection: 'none', months: 12, ...PLAN_DIESEL },
  { key: 'trailer', label: 'Trailers', code: 'TRAIL', hours: false, checks: false, inspection: 'none', months: 12 },
  { key: 'fuel_tank', label: 'Fuel Tanks & Jetting', code: 'FT', hours: false, checks: false, inspection: 'none', months: 12 },
  { key: 'compaction', label: 'Compaction Plates', code: 'VB', hours: false, checks: false, inspection: 'none', months: 12 },
  { key: 'attachment', label: 'Attachments', code: 'ATT', hours: false, checks: false, inspection: 'loler', months: 6 },
  { key: 'survey', label: 'Survey Equipment', code: 'SUR', hours: false, checks: false, inspection: 'calibration', months: 12 },
  { key: 'road_plate', label: 'Road Plates', code: 'RP', hours: false, checks: false, inspection: 'none', months: 12 },
  { key: 'cutting', label: 'Cutting Tools', code: 'CT', hours: false, checks: false, inspection: 'none', months: 12 },
  { key: 'mixer', label: 'Cement Mixers', code: 'CM', hours: false, checks: false, inspection: 'none', months: 12 },
  { key: 'generator', label: 'Generators', code: 'GE', hours: false, checks: false, inspection: 'none', months: 12 },
  { key: 'cat_genny', label: 'CAT & Genny', code: 'C&G', hours: false, checks: false, inspection: 'calibration', months: 12 },
  { key: 'chains', label: 'Chains & Slings', code: 'C&S', hours: false, checks: false, inspection: 'thorough', months: 6 },
  { key: 'container', label: 'Containers', code: 'CON', hours: false, checks: false, inspection: 'none', months: 12 },
  { key: 'misc', label: 'Misc Tools', code: 'MISC', hours: false, checks: false, inspection: 'none', months: 12 },
  { key: 'pump', label: 'Drainage Pumps', code: 'DP', hours: false, checks: false, inspection: 'none', months: 12 },
  { key: 'mower', label: 'Lawn Mowers', code: 'LM', hours: true, checks: false, inspection: 'none', months: 12, ...PLAN_PETROL },
].map((c) => ({ ...PLAN_DIESEL, section: PLANT_SECTION.includes(c.key) ? 'plant' : 'equipment', ...c }));

// What a service at a given hour mark typically involves. A guide only: the machine's own manual wins.
function serviceWork(hours, isFirst, every) {
  if (isFirst) return 'Running-in service: engine oil & filter, check hydraulic return filter and gear oils';
  if (every < 500) return 'Engine oil, air and spark plug / fuel filter check';
  if (hours % 2000 === 0) return 'Major: engine oil & fuel filters, hydraulic return/pilot & air filters, gear oils, hydraulic oil sample';
  if (hours % 1000 === 0) return 'Engine oil & fuel filters, hydraulic return/pilot & air filters, gear oils';
  if (hours % 500 === 0) return 'Engine oil & filter, fuel filters';
  return 'Inspection & greasing';
}
const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

// The two companies that own assets. Asset numbers start with the owner prefix, e.g. MCL-EX-0001.
const OWNERS = { MCL: 'Marley Construction', MPL: 'Marley Plant' };

const PLANT_STATUSES = {
  in_use: 'On site / in use',
  yard: 'In yard',
  repair: 'At repair',
  sold: 'Sold',
  stolen: 'Stolen',
  disposed: 'Disposed / scrapped',
};
const PLANT_INACTIVE = ['sold', 'stolen', 'disposed'];

const VEHICLE_CATEGORIES = { van: 'Company van', director: 'Director vehicle', pool: 'Pool / other' };
const VEHICLE_STATUSES = { active: 'On the road', sorn: 'SORN', off_road: 'Off road / at repair', sold: 'Sold' };
const VEHICLE_INACTIVE = ['sold'];
const TRACKED = { yes: 'Yes (tracker company)', own: 'Yes (we own the tracker)', no: 'No' };

// Admins run the office side. Employees (role 'driver' in the database) are fleet drivers or site managers.
const EMPLOYEE_TYPES = { driver: 'Fleet driver', site_manager: 'Site manager' };
const userLabel = (u) => (u.role === 'admin' ? ['Admin', EMPLOYEE_TYPES[u.employee_type]].filter(Boolean).join(' · ') : EMPLOYEE_TYPES[u.employee_type] || 'Employee');

const FUEL_CARD_PROVIDERS = ['Esso', 'Key Fuels (The Fuelcard Company)', 'FastFuels (Silvey)'];
const FUEL_CARD_STATUSES = { active: 'Active', expired: 'Expired', stopped: 'Stopped', cancelled: 'Cancelled', lost: 'Lost / stolen' };

module.exports = {
  serviceWork, INSPECTION_TYPES, SECTIONS, CATEGORIES, CATEGORY, OWNERS, PLANT_STATUSES, PLANT_INACTIVE,
  VEHICLE_CATEGORIES, VEHICLE_STATUSES, VEHICLE_INACTIVE, TRACKED, EMPLOYEE_TYPES, userLabel, FUEL_CARD_PROVIDERS, FUEL_CARD_STATUSES,
};
