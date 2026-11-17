# Error handling

## Status codes

| Code | When | What the user sees |
| --- | --- | --- |
| 302 | After any successful form post, and to `/login` when signed out | The next page, with a green flash message |
| 400 | `UserError` from a form (bad number, missing field), or a bad value in a POST | Error page with the `UserError` message, or "Some of the details entered were not valid. Please go back and check the form." |
| 401 | Wrong email or password | Sign-in page: "Email or password is incorrect." |
| 403 | No access to a page, record or action; a Manager trying to change something | "No access", "Admins only" or "View only" page |
| 404 | Unknown page, bad id (`/plant/abc`), or a report the user can't run | "That page does not exist." |
| 413-style | Upload over the limit (`LIMIT_FILE_SIZE`) | "That file is too large (15 MB maximum)." |
| 500 | Anything unexpected | "Something went wrong." (details only in the log) |
| 503 | Worker can't reach the database or a secret is missing | Plain text reason with the connection string masked, and the **names** of settings it can see |

The handler is at the bottom of `createApp()` in `src/app.js`. Postgres errors `22P02`, `22003`, `22007`, `22008` (bad id, number or date) are treated as the visitor's mistake.

## Rules

- Throw `new UserError('Plain sentence.', status)` for anything the user can fix. Only `UserError` (`expose = true`) messages are shown.
- Never show stack traces, SQL or connection strings.
- Validate on the server even when the form has `required` or `type=number`.
- Saving with a file: upload first, then write the row; if the row fails, remove the uploaded file (see `POST /fuel`).
- Unique clashes (`isUniqueViolation`) become a friendly message, e.g. "Another asset already has that asset number."

## Message style

British English, one or two short sentences, say what to do next. Examples:
- "New password must be at least 8 characters."
- "Please upload the Trip List as an Excel .xlsx file."
- "Managers can view everything but not make changes."

## Retries and timeouts

- No automatic retries in the app. Each request opens its own DB connection on Workers; if it fails the user gets the 503 page and can reload.
- If the first request fails to start the app, the next request tries again (`app = null` in `worker.mjs`).
- Storage bucket creation is retried on the next upload if it failed.
