# Decisions

Decisions Ben has made, so they aren't re-made. Newest first within each area. Add one whenever Ben decides something: date, decision, why, and what it rules out.

## Product and scope

| Date | Decision | Why / notes |
| --- | --- | --- |
| 2026-10-21 | Pricing: £3,500 up front, £945 a month | Proposal in project files `business/pricing/` |
| 2026-10-16 | Reminder texts or emails for missed checks and ticket renewals are promised for go-live | Promised in the pitch deck; not built yet |
| 2026-10-13 | It is a **website**, not an app. Call it "the system" | Ben |
| 2026-10-13 | Built as a demo to pitch to Marley; stays on the workers.dev address until they sign | Custom domain `admin.marleyconstruction.co.uk` deferred |
| 2026-10-13 | CSV exports removed | Ben asked |
| 2026-10-13 | Never use or copy the Falgate repo | Ben |

## Data

| Date | Decision | Why / notes |
| --- | --- | --- |
| 2026-10-15 | The site is the only source; ignore the spreadsheets after import. Fleet, Employees and Fuel cards must always agree on who has which vehicle | `vehicles.driver_id` is the driver; cards follow the vehicle |
| 2026-10-15 | Employees created automatically from fuel card names (no button) | Run-once job `employees_from_fuel_cards` |
| 2026-10-13 | Load Ben's spreadsheets into the site; keep the **full fuel card number** | Full number admin-only; others see last 4 |
| 2026-10-13 | **Never copy PINs** | Hard rule |
| 2026-10-13 | Plant owner is Marley Construction (`MCL-`) or Marley Plant (`MPL-`); asset numbers follow the plant log | `src/categories.js` |

## Rules

| Date | Decision | Why / notes |
| --- | --- | --- |
| 2026-10-13 | Service plan default 50, 250, 500 then every 500 h or 12 months; dumpers 100, 250, 500; small petrol plant 20 h then every 100 h or 6 months. Keep 250 h for the second service | Researched; Ben confirmed 250 h |
| 2026-10-13 | Unconfirmed defaults: weekly plant check overdue after 7 days; LOLER 12 or 6 months; due soon 30 days; fuel card expiry flagged 45 days ahead; receipt required for fuel | Change only if Ben asks |
| 2026-10-16 | Mileage: a journey runs until home or a gap of 4 h+; journeys that reach no site are personal; any trip to or from an Unknown address is personal; allowed stops count as the rest of the journey; a weekday stop of 3 h+ starting before noon is a guessed "Site?" | `src/mileage.js classify` |
| 2026-10-16 | Mileage defaults (not confirmed): drivers can't see their own mileage; the period defaults to the latest week by date | |

## Access

| Date | Decision | Why / notes |
| --- | --- | --- |
| 2026-10-16 | Site managers see only plant on projects assigned to them, their own vehicle and fuel card; get a dashboard limited to that; no Fuel cards, Employees or admin pages. Each project has one site manager | Supersedes "all plant" (2026-10-13) |
| 2026-10-16 | Site managers only add check sheets and report defects on plant. Services, LOLER, repairs, planned repairs and documents are admin only | |
| 2026-10-16 | Drivers only see and use their own fuel cards and cards on a vehicle they drive; shared cards hidden | Server returns 403 |
| 2026-10-16 | Manager employee type: sees what an admin sees, read-only; last 4 of card numbers; no Training Matrix | Last two parts are my default, unconfirmed |
| 2026-10-16 | Training Matrix is admin only | |

## Design

| Date | Decision | Why / notes |
| --- | --- | --- |
| 2026-10-16 | Menu: Dashboard, Registers (Plant, Fleet, Equipment), Fuel (Fuel Logs, Fuel Cards, Mileage), Employees, Training Matrix, Projects, Reports. Admin heading and Admin page removed | Ben |
| 2026-10-16 | Training Matrix: short horizontal course codes, official NPORS/CPCS names, card colour as a swatch on each date; no slanted headers | Ben disliked slanted headers |
| 2026-10-15 | Marley logo top left; brand navy `#01024c` from the logo | |
| 2026-10-13 | Apple style, white with navy, **no dark mode**; navy menu on the left; fixed white top pane with breadcrumb, title, buttons, filters; filters as drop-downs | Ben |
| 2026-10-13 | Item pages: Details and Service plan left, one combined History right, red strip for open defects, Add record pop-up | |

## Technical

| Date | Decision | Why / notes |
| --- | --- | --- |
| 2026-11-17 | Follow the Vibe Coding Blueprint: `/docs` is the source of truth; `tests/` folder; `.env.example` | Ben |
| 2026-10-16 | No Vercel. Staging = second Worker + Supabase project + Hyperdrive. Backups to R2. Email via Resend; texts (Twilio) only if Marley want them. Reminders via a daily Cron Trigger | Go-live plan |
| 2026-10-15 | Reports print to PDF in the browser; no server-side PDF | Workers can't run a PDF renderer |
| 2026-10-13 | Host on Cloudflare Workers (Ben already uses Cloudflare), data on Supabase via Hyperdrive with caching off, code on GitHub, push to `main` deploys. Not Render | Workers can't do TLS Postgres directly; caching off avoids stale reads |
| 2026-10-13 | Workers Paid ($5/month) | Free plan's 10 ms CPU isn't enough for bcrypt |
| 2026-10-13 | Templates pre-built at build time | Workers can't compile EJS at runtime |
