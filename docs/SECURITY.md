# Security

## What we protect

- **Personal data:** NI numbers, dates of birth, home addresses, licence numbers, emergency contacts, card and certificate copies, and **vehicle trip locations** (Mileage).
- **Fuel card numbers** (full number held for admins).
- Purchase prices and hire rates.

Marley own the data; Ben looks after it. A data processing agreement and a staff notice (especially for Mileage) are needed before go-live.

## Authentication

- Email + password. Passwords hashed with bcrypt (cost 10); minimum 8 characters.
- Session in a signed cookie (`marley_session`): `httpOnly`, `sameSite=lax`, `secure` when `COOKIE_SECURE=true` (always on Cloudflare), 30 days.
- Sign-in is optional per employee: no email means no sign-in. Admins must have an email.
- The first admin is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` only when there are no users.

## Authorisation (always on the server)

| Role | Sees | Can change |
| --- | --- | --- |
| Admin (`role = 'admin'`) | Everything | Everything |
| Manager (`employee_type = 'manager'`) | Everything an admin sees except the Training Matrix; fuel cards as last 4 only | Only their own password and card copies. Any other non-GET request gets 403 in `app.js` |
| Site manager | Plant on projects where they are `manager_id`, their own vehicle and fuel cards | Plant check sheets, defects, fuel for their cards |
| Fleet driver | Only vehicles where they are `driver_id` | Walk-arounds, defects, fuel for their cards |

Rules in code: `src/auth.js` (`requireAdmin`, `canUsePlant`, `plantFor`, `canUseVehicle`). Every route checks access before reading data. Hiding a button is never the only protection.

## Never

- **Never store fuel card PINs** anywhere: database, files, logs, docs, chat.
- Never show a full card number to anyone but an admin.
- Never put secrets in Git, `wrangler.jsonc` or chat. They go in Cloudflare's Variables and Secrets (or `.dev.vars` locally, which is git-ignored).
- Never log passwords, connection strings, card numbers, NI numbers or session cookies. The Worker's 503 page masks connection strings and lists setting **names** only.
- Never make the Supabase bucket public. Files go through the app's permission check.

## Secrets

See [ENVIRONMENT.md](ENVIRONMENT.md). Secrets: `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, `SESSION_SECRET`, database password (inside Hyperdrive). If the Supabase key leaks, create a new one in Supabase and update Cloudflare.

## Database

Row level security is enabled on every table, with no policies, so Supabase's public REST API returns nothing. Only the app's direct connection can read data.

## Uploads

- Photos and PDFs only (plus `.xlsx` for SoTrack), 15 MB max (10 MB for `.xlsx`).
- Stored under random file names, never the uploader's name.
- Served with the app's own access check.

## Known gaps (go-live work, see [ROADMAP.md](ROADMAP.md))

- No limit on password guesses yet: add a Cloudflare rate-limit rule on `/login` and a lock-out.
- No "forgot password" yet: admins reset passwords.
- `SESSION_SECRET` not set in Cloudflare, so the secret is kept in the `settings` table.
- 30-day sessions for admins and managers should be shorter.
- 2FA on GitHub, Cloudflare, Supabase (Ben's accounts).
- Real employee data sits in the pre-contract demo.
