# Putting the system online

The site runs on **Cloudflare Workers**. The data and receipt photos are kept in **Supabase**, and the code lives on **GitHub**. Cloudflare builds the site from GitHub automatically, so every push to `main` goes live.

```
Phone / PC  →  Cloudflare (your domain, HTTPS, the website)  →  Supabase (database + receipt photos)
```

Cloudflare can't open an encrypted database connection by itself, so it reaches Supabase through **Hyperdrive** (part of Workers).

Cost: Cloudflare **Workers Paid** at $5 a month. The free plan only allows 10 ms of processing per request, which isn't enough to check a password safely. Supabase's free plan is enough to start with.

Keep passwords and keys in Cloudflare's settings only. Never put them in GitHub or paste them in chat.

## 1. Supabase: copy three values

Open the project in [supabase.com/dashboard](https://supabase.com/dashboard).

1. **Database connection string.** Click **Connect** at the top, then **Direct** and choose **Direct connection** (port **5432**). It looks like `postgresql://postgres:[YOUR-PASSWORD]@db.abcd….supabase.co:5432/postgres`. Replace `[YOUR-PASSWORD]` with the database password (brackets included). If you don't have it, reset it under **Project Settings > Database**, using letters and numbers only.
2. **Project URL.** Go to **Project Settings > Data API** and copy the URL, e.g. `https://abcd….supabase.co`. This is `SUPABASE_URL`.
3. **Secret key.** Go to **Project Settings > API Keys** and copy a **secret key** (`sb_secret_…`), or on the legacy tab the `service_role` key. This is `SUPABASE_SERVICE_ROLE_KEY`.

You don't need to create any tables or storage buckets. The site creates them the first time it starts. It also switches on row level security, so Supabase's public API can't read the data.

## 2. Cloudflare: create the site from GitHub

1. In the [Cloudflare dashboard](https://dash.cloudflare.com), go to **Workers & Pages > Create > Import a repository**.
2. Choose GitHub and the **AxholmeETM/marley-fleet-plant** repository. Allow the Cloudflare GitHub app access to it if you're asked.
3. Keep the project name **marley-fleet-plant**, the production branch **main**, and the deploy command `npx wrangler deploy`. Click **Deploy**.
4. Open **Workers & Pages > Plans** and choose **Workers Paid** if your account isn't on it already.

The first deploy finishes, but until steps 3 and 4 the site only shows "could not reach its database".

## 3. Cloudflare: Hyperdrive

1. Go to **Storage & databases > Hyperdrive > Connect database > Connect to public database**.
2. Name it `marley-db`, paste the connection string from step 1.1, and **untick Enable caching** (otherwise people can see stale data right after saving). Click through to create it.
3. The ID is in the page address after `/hyperdrive/`. It goes in `wrangler.jsonc` under `hyperdrive` (already set to the `marley-db` ID for Marley's account).

## 4. Cloudflare: add the secrets

Open the **marley-fleet-plant** Worker, then **Settings > Variables and Secrets** (the section that already lists `COOKIE_SECURE`, not the one under **Build**) **> Add**. Add each of these with the type **Secret**:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | the project URL from step 1.2 |
| `SUPABASE_SERVICE_ROLE_KEY` | the secret key from step 1.3 |
| `ADMIN_EMAIL` | your email, for the first admin account |
| `ADMIN_PASSWORD` | a password for it, at least 8 characters |

Click **Deploy** to save them. (The database connection comes from Hyperdrive, so no `DATABASE_URL` secret is needed.) Then open the `…workers.dev` address on the Worker's overview page and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. The admin email and password are only used to create that first account. Change the password later under your name, top right.

## 5. Your own address (optional)

The domain has to be in the same Cloudflare account.

1. Open the Worker, then **Settings > Domains & Routes > Add > Custom domain**.
2. Enter the address, e.g. `fleet.marleyconstruction.co.uk`, and click **Add domain**. Cloudflare creates the DNS record and the HTTPS certificate itself.

## Updating the site

Push to `main` on GitHub and Cloudflare rebuilds and deploys in a minute or two. To see build logs, open the Worker and go to **Deployments**.

## Backups

Supabase's paid plans back up the database daily (see **Database > Backups**). On the free plan, download the CSV exports under **Admin** now and then.

## Running it somewhere else

The same code also runs as a normal Node.js server (`npm start`). Set `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as environment variables, and put it behind HTTPS with `COOKIE_SECURE=true`. If you leave out `DATABASE_URL`, it uses a built-in database kept in `DATA_DIR`.
