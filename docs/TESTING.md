# Testing

## Commands

| What | Command |
| --- | --- |
| All tests (builds the views first) | `npm test` |
| One test by name | `npm run build && node --test --test-name-pattern="mileage" tests/` |
| Build the views | `npm run build` |
| Run the site locally | `npm start` (or `npm run dev` to reload on change) |
| Demo data | `npm run seed -- --force` (**wipes the local database**) |
| Cloudflare version locally | `npm run cf:dev` (needs `.dev.vars`) |

There is no lint or type-check step.

## Tools and layout

- Node's built-in test runner (`node:test`) and `assert`. No test libraries.
- `tests/app.test.js` starts the real Express app on a fresh embedded PGlite database in a temporary folder and drives it with `fetch`, signing in as each kind of user.
- `tests/fixtures/` holds sample files (a SoTrack `trip-list.xlsx`).

## What is covered

| Test | Covers |
| --- | --- |
| status rules | Service hours, LOLER, MOT, tax and check due/overdue rules |
| admin and driver flows | Sign-in, registers, checks, defects, fuel, fuel cards, who can see what |
| training matrix and view-only managers | Training Matrix, Manager read-only (403 on changes) |
| employee documents | Card copies on people |
| mileage from a SoTrack trip list | Upload, classify work/personal, ticks, addresses |
| allowed stop | Journey classification with an allowed stop |

## Critical flows (must always pass)

1. A fleet driver can't open, check or fuel another driver's vehicle (403).
2. A site manager only sees plant on their projects.
3. A manager can't change anything (403 on POST).
4. Non-admins never see a full fuel card number.
5. A fuel entry without a receipt is refused.
6. Overdue and due-soon flags appear at the right dates.
7. Mileage counts trips to unknown addresses as personal.

## Definition of done

- `npm test` passes.
- New rules or permissions have a test, including the "not allowed" case.
- The page was opened in a browser (desktop and phone width) for UI changes.
- Docs updated (see [AGENTS.md](AGENTS.md)).

## Planned (go-live)

- GitHub Actions running `npm test` on every push and pull request, and `main` protected.
- Dependabot for library updates.
- A staging site with made-up data for checking changes before live.
