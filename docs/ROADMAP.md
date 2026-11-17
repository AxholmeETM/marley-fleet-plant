# Roadmap

The live status page is the [Marley Road to MVP](https://claude.ai/artifact/5D7ceB9TKjFAPZtZFDznoc). This file is the short version that sits with the code. The full reasoning is the go-live plan in the project files (`business/go-live/GO-LIVE-PLAN.md`).

**Feature freeze:** the system already does more than an MVP needs. New features wait until after go-live unless Ben asks.

## Now (before Marley sign, costs nothing extra)

| # | Item | Who |
| --- | --- | --- |
| 1 | Two-step sign-in on GitHub, Cloudflare, Supabase | Ben |
| 2 | Tests run on every change (GitHub Actions); Dependabot | Claude |
| 3 | Staging: second Supabase project, second Worker on `staging`, Hyperdrive `marley-db-staging`, made-up data | Ben + Claude |
| 4 | Protect `main` on GitHub | Ben |
| 5 | Login rate limit and lock-out, `SESSION_SECRET`, shorter admin and manager sign-ins | Ben + Claude |
| 6 | Resend account and sending domain | Ben |
| 7 | Email reminders (missed plant checks, missed walk-arounds, training due in 30 days), Reminders page, forgot password, invite emails, error emails | Claude |
| 8 | Nightly backups of database and files to R2; one practice restore | Ben + Claude |
| 9 | Printable guides for the office, drivers and site managers | Claude |
| 10 | Tests for the critical rules (driver can't see another's vehicle; full card numbers admin-only) | Claude |

## Next (when Marley sign)

| # | Item | Who |
| --- | --- | --- |
| 11 | Supabase Pro (daily backups) | Ben |
| 12 | Data processing agreement; staff notice for Mileage | Ben + Marley |
| 13 | Clear the "Demo" rows; reload fresh spreadsheet data if changed | Claude |
| 14 | Real accounts for admins, managers, site managers, drivers | Ben / Marley office |
| 15 | Domain to Cloudflare; `admin.marleyconstruction.co.uk` | Ben + Marley IT |
| 16 | Uptime monitor | Ben |
| 17 | Two training days for admin and manager users, then go live | Ben |

## Later

- One round of changes after Marley have used it (in the price), then small changes from the monthly hours.
- Text message reminders (Twilio) if Marley want them.
- Mileage go-live once Marley's policy and staff notice are in place.

## Deferred / waiting on a decision

- Plant / Equipment category split (needs Marley).
- Whether drivers can see their own mileage.
- Whether Managers can see the Training Matrix.

## Not planned

- A phone app.
- CSV exports.
- Vercel or any second host.
- Server-side PDF generation.
- Storing fuel card PINs.
