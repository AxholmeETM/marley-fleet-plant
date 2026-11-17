# Environment

Every setting the app reads, where it comes from, and whether it is secret. A copy with no real values is in [`/.env.example`](../.env.example).

## Where settings live

| Where | How |
| --- | --- |
| Live (Cloudflare) | Worker **marley-fleet-plant** → Settings → **Variables and Secrets** (the runtime section, not Build). Plain vars in `wrangler.jsonc` `vars` |
| Local Cloudflare (`npm run cf:dev`) | `.dev.vars` (git-ignored) |
| Local Node (`npm start`) | Shell environment or a `.env` you load yourself (git-ignored) |

All settings are server-side only. Nothing is sent to the browser.

## Settings

| Name | Secret | Default | Live value / notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | none → embedded PGlite in `DATA_DIR` | Not set on Cloudflare: Hyperdrive binding `HYPERDRIVE` supplies it on each request |
| `DATABASE_SSL` | no | on for remote hosts | Set to `off` automatically behind Hyperdrive |
| `DATABASE_CA` | no | none | Optional CA certificate for a direct TLS connection |
| `DATABASE_POOL` | no | `5` | Pool size (Node only) |
| `SUPABASE_URL` | yes | none → files in `DATA_DIR/uploads` | Required on Cloudflare |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | none | Required on Cloudflare. `sb_secret_…` or legacy `service_role` key |
| `SUPABASE_BUCKET` | no | `receipts` | Private bucket, created automatically |
| `ADMIN_EMAIL` | yes | `admin@marley.local` | First admin only (when there are no users) |
| `ADMIN_PASSWORD` | yes | `changeme` | First admin only |
| `SESSION_SECRET` | yes | generated and kept in `settings` | **Should be set before go-live** |
| `COOKIE_SECURE` | no | `false` | `true` on Cloudflare (`wrangler.jsonc`) |
| `TRUST_PROXY` | no | `1` | Express trust proxy hops |
| `PORT` | no | `3000` | Node only |
| `DATA_DIR` | no | `./data` | Node only |
| `DEFAULT_SERVICE_SCHEDULE` | no | `50, 250, 500` | First services (hours) for new machines |
| `DEFAULT_SERVICE_HOURS` | no | `500` | Repeat interval (hours) |
| `DUE_SOON_DAYS` | no | `30` | "Due soon" window for MOT, tax, LOLER, services |
| `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` | yes | none | Only for `npm run cf:dev` |

## Bindings (`wrangler.jsonc`)

- `HYPERDRIVE`: Hyperdrive config `marley-db` (id in `wrangler.jsonc`), caching **off**.
- `assets`: serves `./public`.

## Planned for go-live

| Name | For |
| --- | --- |
| `RESEND_API_KEY` | Reminder and password emails |
| R2 bucket `marley-backups` + access key | Nightly backups |
| Staging Worker, Supabase project and Hyperdrive `marley-db-staging` | Staging site |

## Rules

- Never commit real values. `.env`, `.dev.vars` and `data/` are git-ignored.
- Never paste secrets into chat, issues or docs.
- When adding a setting: read it from `process.env`, add it to this table and to `.env.example`.
