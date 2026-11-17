# Architecture

## Pattern

A server-rendered website: one Express app renders HTML pages with EJS templates and handles plain HTML form posts. No front-end framework and no JSON API. This keeps it fast on site phones, easy to change and cheap to host.

## Tech stack

| Part | Choice |
| --- | --- |
| Runtime | Node.js 22.5+ (locally); Cloudflare Workers with `nodejs_compat` (live) |
| Web | Express 5, cookie-session, multer (uploads), bcryptjs |
| Templates | EJS, **pre-built** into `src/views.generated.js` by `scripts/build-views.js` (Workers can't compile templates at runtime) |
| Database | Postgres: Supabase in production via Cloudflare Hyperdrive; embedded PGlite in `./data` when `DATABASE_URL` is unset |
| Files | Supabase Storage private bucket `receipts`; local `DATA_DIR/uploads` when Supabase isn't set |
| PDFs in reports | Self-hosted pdf.js in `public/static/pdfjs` |

## How a request flows

```
Phone / PC → Cloudflare Worker (src/worker.mjs) → Express app (src/app.js)
                                                     ├─ auth + role checks (src/auth.js)
                                                     ├─ route (src/routes/*.js) → db.js → Hyperdrive → Supabase Postgres
                                                     ├─ storage.js → Supabase Storage (receipts, documents)
                                                     └─ views.render() → HTML
```

Files in `public/` are served by Cloudflare before the request reaches the app.

## Project structure

```
src/app.js          Builds the Express app: session, user loading, role flags, routes, error pages
src/server.js       Starts it as a normal Node server (npm start)
src/worker.mjs      Starts it on Cloudflare Workers; copies secrets into process.env on the first request
src/db.js           Schema (created/migrated on start), query helpers, Postgres/PGlite drivers, RLS
src/auth.js         Who can see what (requireAdmin, canUsePlant, plantFor, canUseVehicle), UserError, form parsing
src/status.js       Due / overdue rules for services, LOLER, MOT, tax and checks
src/categories.js   Asset categories, owners, statuses, service plans, employee types, card types
src/checklists.js   Walk-around and plant check sheet items
src/queries.js      Shared queries (e.g. syncCardVehicles)
src/documents.js    Document uploads on records, defects and people
src/mileage.js      SoTrack trip classification (work / personal)
src/xlsx.js         Minimal .xlsx reader (no library; uses DecompressionStream)
src/crumbs.js       Breadcrumb trail from ?from=
src/planned.js      Planned repairs on the calendar
src/storage.js      Receipt and document files
src/routes/         One file per area: home, plant, vehicles, checks, defects, fuel, fuel-cards,
                    mileage, users, projects, reports, training, auth, admin
views/              EJS pages and partials
public/static/      style.css, logo, favicon, pdf.js
scripts/            build-views.js, seed.js (demo data), dev.js
tests/              node:test suite and fixtures
docs/               This documentation
```

## Dependency rules

- Routes call `db.js` helpers (`get`, `all`, `run`, `transaction`); they don't open their own connections.
- Permission checks live in `src/auth.js` and are always run on the server, in the route.
- Business rules (due dates, mileage classification, categories) live in their own module, not in templates.
- Templates only format; they don't query the database.

## Cloudflare Workers rules

- No `eval` or runtime template compiling.
- No `__dirname` or `fs` at runtime on Workers.
- Database access and `env.HYPERDRIVE` reads only **inside a request**. Reading them at global scope fails the deploy (code 10021).
- Each request opens its own DB connection (`perRequest` / `endRequest` in `db.js`).

## Failure scenarios

| Failure | What happens |
| --- | --- |
| Database unreachable or a secret missing | Worker returns 503 with the reason (connection string masked) and the names of settings it can see |
| Upload too large (over 15 MB) | Friendly error page |
| Bad id in an address (`/plant/abc`) | 404, not a crash |
| Supabase Storage down | Upload fails with an error; the record isn't saved half-way |
| A bad release | Roll back in Cloudflare (Worker > Deployments > Rollback) |

See [DECISIONS.md](DECISIONS.md) for why these choices were made.
