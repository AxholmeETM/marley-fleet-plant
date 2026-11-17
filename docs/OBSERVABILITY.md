# Observability

## Today

- **Cloudflare Workers logs** (`observability.enabled` in `wrangler.jsonc`): every request and anything written with `console.error`. Worker → Logs in the Cloudflare dashboard.
- **Deployments**: Worker → Deployments shows each build from GitHub, its log, and **Rollback**.
- **Supabase**: Database → Reports for size and load; Logs for query errors.
- The app logs unexpected errors (`console.error(err)` in the error handler), start-up failures, DB connection errors, and failures of the run-once data jobs.

## What to log

- Unexpected exceptions with the route.
- Start-up and database connection failures (with connection strings masked).
- Background or run-once jobs: started, finished, failed.
- Planned: each reminder email batch (how many sent, failures).

## Never log

- Passwords or password hashes, session cookies, `SESSION_SECRET`.
- Connection strings or Supabase keys.
- Full fuel card numbers, PINs (never held anyway), NI numbers, dates of birth, home addresses.
- Uploaded file contents.

## Planned for go-live (see [ROADMAP.md](ROADMAP.md))

| What | How | Alert to |
| --- | --- | --- |
| Site down | Free uptime monitor (e.g. UptimeRobot) every 5 minutes | Ben, email |
| Repeated errors | Error emails from the Worker via Resend | Ben, email |
| Nightly backup failed | Backup job reports failure | Ben, email |
| Reminder job failed | Cron Trigger logs and email | Ben, email |
| Library security updates | Dependabot on GitHub | Ben, GitHub |
| Supabase plan limits | Supabase usage emails | Ben |
