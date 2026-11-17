# Marley Construction – Fleet & Plant System

A website for Marley Construction Limited and Marley Plant to run the plant, equipment and fleet registers, checks and defects, fuel and fuel cards, mileage, employees, the training matrix, projects and reports. People use it in any browser on a PC or phone; there is nothing to install.

Live preview: https://marley-fleet-plant.ben-cc3.workers.dev

## Documentation

Everything about the product, design, data, rules and process is in [`/docs`](docs). Start with:

- [PRD](docs/PRD.md): what it is, who it's for, scope
- [UX flows](docs/UX_FLOWS.md): what each kind of user does
- [Architecture](docs/ARCHITECTURE.md) and [Database](docs/DATABASE.md)
- [Security](docs/SECURITY.md): who sees what, and what is never stored
- [Decisions](docs/DECISIONS.md) and [Roadmap](docs/ROADMAP.md)
- [Deployment](docs/DEPLOYMENT.md) and [Environment](docs/ENVIRONMENT.md)
- [AGENTS.md](docs/AGENTS.md): how an AI agent works on this repo

## Run it locally

Needs **Node.js 22.5 or newer**. Without `DATABASE_URL` it uses a built-in database in `./data`.

```bash
npm install
npm start                    # http://localhost:3000
npm run seed -- --force      # optional: WIPES the local database and loads demo data
npm test
```

First start creates `admin@marley.local` / `changeme` (or `ADMIN_EMAIL` / `ADMIN_PASSWORD`). Demo logins after seeding (password `password123`): `admin@marley.local`, `office@marley.local`, `kieran@marley.local` (site manager), `dave@marley.local` (fleet driver).

Settings are listed in [`.env.example`](.env.example) and explained in [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md).

## Layout

```
src/        App, routes and rules (see docs/ARCHITECTURE.md)
views/      Page templates (EJS), pre-built by scripts/build-views.js
public/     Styles, logo, pdf.js
scripts/    Build, dev server, demo data
tests/      node:test suite and fixtures
docs/       Project documentation (source of truth)
```
