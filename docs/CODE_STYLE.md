# Code style

## Language and modules

- Plain JavaScript (CommonJS `require`) in `src/`; only `src/worker.mjs` is an ES module. No TypeScript, no build step except pre-building views.
- Node 22.5+ built-ins first (`node:test`, `fetch`, `DecompressionStream`). Add a dependency only when there's no reasonable built-in way, and say why in the PR.

## Naming

| Thing | Rule | Example |
| --- | --- | --- |
| Files | kebab-case | `fuel-cards.js`, `plant-view.ejs` |
| Routes | lower-case nouns, plural lists | `/fuel-cards/:id/edit` |
| Functions / variables | camelCase | `canUsePlant`, `syncCardVehicles` |
| Constants and lookup tables | UPPER_SNAKE | `PLANT_SECTION`, `FUEL_LABELS` |
| DB tables / columns | snake_case | `fuel_entries.fill_date` |
| Views | `<area>-<page>.ejs`; shared bits in `views/partials/` | `mileage-weeks.ejs` |

## Where things go

- A new page: route in `src/routes/<area>.js`, template in `views/`, styles appended to `public/static/style.css`.
- Lists of options (categories, statuses, card types): `src/categories.js`.
- Due-date rules: `src/status.js`. Permission rules: `src/auth.js`. Shared queries: `src/queries.js`.
- Schema changes: end of `SCHEMA` in `src/db.js` (see [DATABASE.md](DATABASE.md)).

## Error handling

- Throw `UserError(message, status)` for anything the user did wrong; the message is shown to them.
- Let unexpected errors reach the error handler in `app.js`, which logs them and shows "Something went wrong."
- Parse form numbers with `numberField(value, label, opts)`, text with `text(value)`.

## Comments

- Explain **why** and **who asked**, not what the line does: `// Ben (16/10): unknown addresses count as personal.`
- Keep the comment at the top of each file saying what the file is for.

## Writing in the interface

- British English. Short, plain labels. Sentence case.
- Dates `dd/mm/yyyy`, money `£`, hours with `fmtHours`.
- Say "the system" or "the site", never "the app", to Marley users.

## Do

- Reuse existing partials, classes and helpers before writing new ones.
- Keep Workers-safe (see [ARCHITECTURE.md](ARCHITECTURE.md)).
- Keep changes small and on topic.

## Don't

- Don't add a front-end framework, CSS framework or ORM.
- Don't add CSV exports (Ben removed them).
- Don't query the database from templates.
- Don't copy anything from the Falgate repository.

There is no linter or formatter configured; match the surrounding code (2-space indent, single quotes, semicolons).
