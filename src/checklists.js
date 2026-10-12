// Items on the daily vehicle walk-around and the weekly plant check sheet.
// Edit these lists to match Marley's own check sheets; existing records keep the items they were saved with.

const VEHICLE_ITEMS = [
  'Lights, indicators and reflectors',
  'Tyres and wheel nuts',
  'Mirrors, windscreen and glass',
  'Wipers and washers',
  'Brakes (including handbrake)',
  'Horn',
  'Dashboard warning lights',
  'Oil, coolant and AdBlue levels',
  'Steering',
  'Seatbelts',
  'Bodywork, doors and tailgate',
  'Load and tow equipment secure',
  'Number plates clean and legible',
  'Fuel, oil or fluid leaks',
  'First aid kit and fire extinguisher',
];

const PLANT_ITEMS = [
  'Engine oil level',
  'Hydraulic oil level and hoses (no leaks)',
  'Coolant level',
  'Fuel and AdBlue level',
  'Tracks / tyres and wheels',
  'Lights and beacon',
  'Horn and travel alarm',
  'Seat belt and seat',
  'Mirrors and cameras',
  'Controls and isolation lever',
  'Quick hitch, safety pin and attachments',
  'Bucket, teeth and wear parts',
  'Guards, steps and handrails',
  'Greasing done',
  'Fire extinguisher',
  'Operator manual and load chart in cab',
];

const RESULTS = ['ok', 'defect', 'na'];

module.exports = { VEHICLE_ITEMS, PLANT_ITEMS, RESULTS };
