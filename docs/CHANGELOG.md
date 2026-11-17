# Changelog

What users would notice, per release. Newest first. Add an entry with every merged change (Added, Changed, Fixed, Removed).

## 2026-11-17: Documentation

### Added
- `/docs` folder following the Vibe Coding Blueprint: PRD, design system, UX flows, architecture, database, routes, security, code style, testing, agent rules, environment, error handling, deployment, observability, decisions, roadmap and this changelog.
- `AGENTS.md` and `CLAUDE.md` at the root, pointing AI agents to `docs/AGENTS.md`.
- `.env.example` listing every setting.

### Changed
- `DEPLOY.md` moved to `docs/DEPLOYMENT.md` with release, rollback and production checklist sections.
- `test/` renamed to `tests/`.
- README trimmed to a summary with links into `/docs`.

No change to how the site works.

## 2026-10-16: Mileage, Training Matrix, site managers

### Added
- Mileage: upload SoTrack trip lists, split work and personal miles, dashboard, weekly trips with a Checked tick per driver, addresses as Sites, Homes, Allowed stops and Unknown, See trip in Google Maps, Mileage report.
- Training Matrix (admin only) with General, NPORS and CPCS courses, card colours, codes, certificate copies and a Training report.
- Manager employee type (read-only).
- Site managers limited to their projects' plant; projects page sets the site manager and plant.
- Employee documents (card copies).
- Breadcrumbs that follow the way you came.

### Changed
- Menu: Projects and Reports sit directly in the menu; Admin heading removed.
- Drivers only see their own fuel cards and cards on a vehicle they drive.

## 2026-10-15: Employees, documents, reports

### Added
- Employees page with vehicles and fuel cards assigned from each person.
- Documents on service, LOLER, thorough examination, MOT, repair and defect records.
- Reports (plant, equipment, fleet, fuel cards, employees, projects) printed to PDF.
- Marley logo and brand navy.

### Removed
- Admin page.

## 2026-10-13: First release

### Added
- Plant, Equipment and Fleet registers, service plans, LOLER, check sheets, walk-arounds, defects.
- Fuel logs with receipts, fuel dashboard, fuel cards.
- Data loaded from Marley's spreadsheets; live on Cloudflare Workers with Supabase.

### Removed
- CSV exports.
