# Putting the system online

The system needs one always-on server with a little storage for the database and receipt photos.

## Option 1: Render (recommended)

About $7 a month for the server plus $0.25 per GB of storage (5 GB is plenty to start). Gives a secure `https://` address straight away; you can add your own, e.g. `fleet.marleyconstruction.co.uk`.

1. Put this folder in a private GitHub repository.
2. Sign up at render.com, then **New > Blueprint** and choose the repository. Render reads `render.yaml`.
3. When asked, enter `ADMIN_EMAIL` (your email) and `ADMIN_PASSWORD` (at least 8 characters). This is the first admin account.
4. Wait for the deploy to finish, open the address Render gives you and sign in.
5. Add users under **Admin > Users**, then plant, vehicles and fuel cards.

Backups: Render snapshots the disk daily. For an extra copy, download the CSV exports under **Admin** now and then.

## Option 2: Any server with Docker

```bash
docker build -t marley-fleet-plant .
docker run -d --name marley -p 3000:3000 -v marley-data:/data \
  -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD=choose-a-password -e COOKIE_SECURE=true \
  --restart unless-stopped marley-fleet-plant
```

Put it behind HTTPS (e.g. Caddy: `fleet.example.co.uk { reverse_proxy localhost:3000 }`). Back up the `marley-data` volume.

## Option 3: Office PC without Docker

Install Node.js 22 or newer, then in this folder run `npm install` and `npm start`. Drivers on site need it reachable over HTTPS, e.g. with a Cloudflare Tunnel. Keep the PC on and back up the `data` folder.

## Settings

See the table in README.md (`PORT`, `DATA_DIR`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `COOKIE_SECURE`, service plan defaults).
