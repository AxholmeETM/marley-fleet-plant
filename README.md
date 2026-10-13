# Marley Construction – Fleet & Plant Register

A web app for Marley Construction Limited to run the plant register, the fleet register, driver checks and fuel.

A website: people open it in any browser (desktop or phone), nothing to install. Apple-style design with automatic dark mode.

Menu for admin users: **Dashboard · Plant · Fleet · Fuel cards · Equipment · Admin**.

## Users and what they can see

| Account | Who | Can see and do |
| --- | --- | --- |
| Admin user | Office | Everything: registers, fuel dashboard and receipts, fuel cards, users, exports |
| Employee – site manager | Site managers | All plant and equipment (view, check sheets, defects, service / inspection / repair records; no purchase prices or hire rates, can't edit the asset record) plus their own vehicles |
| Employee – fleet driver | Drivers | Only the vehicles assigned to them: walk-around checks, fuel with their fuel cards, defects |

Each account also records the person's **role within the company** (Groundworker, Site Manager, Plant Fitter…).

## What it records

**Plant & equipment** (matches the sheets in the plant & equipment log). The menu splits them: **Plant** is the machines (excavators, dumpers, rollers) and **Equipment** is everything else; change the split in `PLANT_SECTION` in `src/categories.js`.
- Asset number (e.g. `MCL-EX-0001`, `MPL-DU-0001` – suggested automatically), category (Excavators, Dumpers, Rollers, Trailers, Fuel Tanks & Jetting, Compaction Plates, Attachments, Survey Equipment, Road Plates, Cutting Tools, Cement Mixers, Generators, CAT & Genny, Chains & Slings, Containers, Misc Tools, Drainage Pumps, Lawn Mowers), owner (Marley Construction or Marley Plant), status (in use, in yard, at repair, sold, stolen, disposed)
- Manufacturer, model, serial/chassis no, registered year, SWL, **job reference**, site/location/person
- **Service plan per machine on running hours**: by default 50, 250 and 500 hrs, then every 500 hrs or 12 months, whichever comes first (dumpers start at 100 hrs; small petrol plant 20 hrs then every 100 hrs or 6 months). Editable per machine; the plan shows typical work at each service as a guide. Shows each service as done / next / upcoming, and flags the next one amber within 50 hrs and red when overdue. Running hours update from each weekly check sheet.
- **Weekly plant check sheet** for machines (overdue after 7 days)
- **LOLER / thorough examination / calibration**: last tested date, interval (6 or 12 months), due date (from the certificate or last + interval), certificate number. Flags amber 30 days before due.
- **Defects** with severity and a resolve step; service, inspection and repair history
- Purchase price and date, agreed price from MCL (Marley Plant items), weekly hire rate

**Fleet**
- Asset number, registration, company van / director vehicle, owner, make, model, colour, body type, fuel, status (on the road, SORN, off road, sold), tracked, user, mileage, purchase price and date
- **Last service** (with a service interval in months), **MOT expiry** and **tax due**, flagged when due within 30 days or overdue (not for SORN vehicles)
- **Daily walk-around check** by the driver (for vehicles whose driver has an app account)
- Service / MOT / tax / repair history

**Fuel cards**
- Company (Esso, Key Fuels, FastFuels…), card no on your list, last 4 digits, who it's assigned to, vehicle, card type, expiry and status. **PINs and full card numbers are never stored.** Cards expiring within 45 days show on the dashboard.
- **Assign cards to people** by dragging a card onto a person (or the "Move to" list on a phone). A person can hold several cards. When they log fuel, their own cards are shown first; they can still pick a different card or "paid another way".

**Fuel**
- Drivers log **diesel, unleaded or AdBlue**: vehicle, date, litres, mileage, station, fuel card used and a **photo or PDF of the receipt** (required)
- **Fuel dashboard** for the admin assistant: receipt thumbnails, a side-by-side receipt view to cross-check and correct entries, **enter the price** of each purchase and tick it as checked ("Save & next receipt" walks through the unchecked ones), totals and average £/litre per fuel type, and a **fuel used leaderboard** by driver or by vehicle (diesel + unleaded ranked, AdBlue shown separately, approx MPG from logged mileage)
- Export the fuel log to CSV for any period

## Running it

Online it runs on Cloudflare Workers, with the data in Supabase. See **[DEPLOY.md](DEPLOY.md)** for the step-by-step setup.

To run it on your own computer you need **Node.js 22.5 or newer**. Without `DATABASE_URL` it uses a built-in database in `./data`, so there is nothing else to install.

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

Demo logins (password `password123`): `admin@marley.local` and `office@marley.local` (admin users), `kieran@marley.local` (site manager), `dave@marley.local` (fleet driver).

To try the Cloudflare version locally, put the Supabase settings in a `.dev.vars` file (it is ignored by git), set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` to a Postgres connection string (it must include a password), and run `npm run cf:dev`.

### Settings (environment variables, or secrets in Cloudflare)

| Variable | Default | What it does |
| --- | --- | --- |
| `DATABASE_URL` | none (built-in database) | Postgres connection string, e.g. Supabase's transaction pooler URI. Required on Cloudflare. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | none (files in `DATA_DIR/uploads`) | Keep receipt photos in a private Supabase Storage bucket (`receipts`, created automatically). Required on Cloudflare. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@marley.local` / `changeme` | First admin account (only used when there are no users) |
| `SESSION_SECRET` | generated and saved in the database | Cookie signing key |
| `COOKIE_SECURE` | `false` (`true` on Cloudflare) | Set to `true` when served over HTTPS |
| `PORT` | `3000` | Web server port (Node only) |
| `DATA_DIR` | `./data` | Built-in database and receipts when `DATABASE_URL` / Supabase aren't set (Node only) |
| `DEFAULT_SERVICE_SCHEDULE` | `50, 250, 500` | Default first services (hours) for new machines |
| `DEFAULT_SERVICE_HOURS` | `500` | Default repeat service interval (hours) after the first services |
| `DUE_SOON_DAYS` | `30` | How far ahead MOT, tax, LOLER and vehicle services show as "due soon" |

The check sheet items are in `src/checklists.js` – edit them to match your own sheets.

### Tests

```bash
npm test
```

## Project layout

```
src/app.js          Express app, sign-in, shared helpers
src/server.js       Start as a normal Node.js server
src/worker.mjs      Start on Cloudflare Workers (settings in wrangler.jsonc)
src/db.js           Postgres schema and queries (Supabase, or built-in PGlite)
src/storage.js      Receipt photos (Supabase Storage, or local files)
src/status.js       Due / overdue rules (service hours, LOLER, MOT, tax, checks)
src/checklists.js   Walk-around and plant check sheet items
src/categories.js   Asset categories, owners, statuses, inspection types
src/routes/         Pages: dashboard, plant, vehicles, checks, defects, fuel, users, exports
views/              Page templates (EJS), pre-built by scripts/build-views.js
public/static/      Styling and icon
scripts/seed.js     Demo data
```
