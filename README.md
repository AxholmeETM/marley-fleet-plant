# Marley Construction – Fleet & Plant Register

A web app for Marley Construction Limited to run the plant register, the fleet register, driver checks and fuel.

- **Admin interface** (office): overall dashboard, plant register, fleet register, checks, defects, fuel dashboard, users, CSV exports.
- **Driver / operative interface** (phone friendly): daily walk-around check, log fuel with a receipt photo, weekly plant check sheet, report a defect.

## What it records

**Plant**
- Plant ID, description, make/model, serial number, **job reference** and site
- **Running hours** (updated from each check sheet). A service is due at *hours at last service + service interval* (interval set per machine, default 250 hrs). "Due soon" within 10% of the interval (min 25 hrs).
- **Defects**, raised from check sheets or reported directly, with severity (minor / major / unsafe) and a resolve step
- **Weekly plant check sheet** – flagged overdue when none has been done for more than 7 days
- **LOLER** – last thorough examination date and interval (12 months for lifting equipment, 6 months for lifting people/accessories); flagged when due within 30 days or overdue
- Service and LOLER history

**Fleet**
- Registration, make/model, type, fuel, assigned driver, mileage
- **Last service** (with a service interval in months), **MOT expiry** and **tax expiry**, all flagged when due within 30 days or overdue
- **Daily walk-around check** by the driver. The dashboard shows which assigned vehicles haven't had one today.
- Service / MOT / tax history

**Fuel**
- Drivers log **diesel, unleaded or AdBlue**: vehicle, date, litres, mileage, station and a **photo or PDF of the receipt** (required)
- **Fuel dashboard** for the admin assistant: receipt thumbnails, a side-by-side receipt view to cross-check and correct entries, **enter the price** of each purchase and tick it as checked ("Save & next receipt" walks through the unchecked ones), totals and average £/litre per fuel type, and a **fuel used leaderboard** by driver or by vehicle (diesel + unleaded ranked, AdBlue shown separately, approx MPG from logged mileage)
- Export the fuel log to CSV for any period

## Running it

Needs **Node.js 22.5 or newer** (uses Node's built-in SQLite, so there is nothing else to install).

```bash
npm install
npm start
```

Open http://localhost:3000. On first start an admin account is created and printed in the console:
`admin@marley.local` / `changeme` (set `ADMIN_EMAIL` / `ADMIN_PASSWORD` to choose your own). Sign in, change the password under your name (top right), then add users, plant and vehicles.

### Try it with demo data

```bash
npm run seed -- --force   # WIPES the database and loads demo plant, vehicles, checks and fuel
npm start
```

Demo logins (password `password123`): `admin@marley.local` (admin), `office@marley.local` (admin), `dave@marley.local` (driver).

### Settings (environment variables)

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Web server port |
| `DATA_DIR` | `./data` | Where the database (`marley.db`) and receipt uploads are kept. **Back this folder up.** |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@marley.local` / `changeme` | First admin account (only used when there are no users) |
| `SESSION_SECRET` | generated and saved in `DATA_DIR` | Cookie signing key |
| `COOKIE_SECURE` | `false` | Set to `true` when served over HTTPS |
| `DEFAULT_SERVICE_HOURS` | `250` | Default plant service interval for new plant |
| `DUE_SOON_DAYS` | `30` | How far ahead MOT, tax, LOLER and vehicle services show as "due soon" |

The check sheet items are in `src/checklists.js` – edit them to match your own sheets.

### Hosting

Any machine or small VPS that runs Node works (a Windows PC in the office, a Linux VPS, Render, Railway, Fly.io with a volume). Keep `DATA_DIR` on persistent storage and put it behind HTTPS (e.g. Caddy or nginx) if it is reachable from the internet, so drivers can use it on their phones on site.

### Tests

```bash
npm test
```

## Project layout

```
src/app.js          Express app, sign-in, shared helpers
src/db.js           SQLite schema
src/status.js       Due / overdue rules (service hours, LOLER, MOT, tax, checks)
src/checklists.js   Walk-around and plant check sheet items
src/routes/         Pages: dashboard, plant, vehicles, checks, defects, fuel, users, exports
views/              Page templates (EJS)
public/style.css    Styling
scripts/seed.js     Demo data
```
