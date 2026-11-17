# Routes (API)

There is no JSON API. Every route returns an HTML page or redirects after a form post. Forms are `application/x-www-form-urlencoded`, or `multipart/form-data` when they carry a file.

## Conventions

- `GET` shows a page; `POST` changes something and then **redirects** (post/redirect/get) with a flash message.
- Lists at `/thing`, one item at `/thing/:id`, forms at `/thing/new` and `/thing/:id/edit`, actions as `POST /thing/:id/<verb>` (`/resolve`, `/remove`, `/done`).
- Everything except `/login` needs a signed-in user (redirects to `/login`).
- Permission failures return **403** with the shared error page; unknown pages and bad ids return **404**.
- Validation failures throw `UserError` (400) with a message shown to the user.
- Links between sections add `?from=<page>` so the breadcrumb shows the way back.

## Who can call what

Legend: **A** admin, **M** manager (read-only, `GET` only), **S** site manager, **D** fleet driver.

| Area | Routes | Access |
| --- | --- | --- |
| Sign in | `GET/POST /login`, `POST /logout`, `GET /account`, `POST /account/password` | Everyone |
| Dashboard | `GET /`, `GET /calendar` | All (each sees their own scope) |
| Plant / Equipment | `GET /plant`, `GET /equipment`, `GET /plant/:id` | A, M, S (S only for their projects' plant) |
| | `GET /plant/new`, `POST /plant`, `GET /plant/:id/edit`, `POST /plant/:id`, `POST /plant/:id/records`, `POST /plant/:id/records/:rid/done` | A |
| Fleet | `GET /vehicles`, `GET /vehicles/:id` | A, M; S and D only their own vehicle |
| | `GET /vehicles/new`, `POST /vehicles`, `GET /vehicles/:id/edit`, `POST /vehicles/:id`, `POST /vehicles/:id/records`, `POST /vehicles/:id/records/:rid/done` | A |
| Checks | `GET /checks/vehicle/new`, `POST /checks/vehicle` | Driver of that vehicle, A |
| | `GET /checks/plant/new`, `POST /checks/plant` | A, S |
| | `GET /checks`, `GET /checks/:type/:id` | A, M (and the person who did it) |
| Defects | `GET /defects/new`, `POST /defects` | Anyone who can see the asset |
| | `GET /defects`, `POST /defects/:id/resolve`, `/reopen`, `/documents` | A |
| Fuel | `GET /fuel/new`, `POST /fuel` (receipt required) | All; non-admins only with their own cards or cards on a vehicle they drive |
| | `GET /fuel`, `GET /fuel/log`, `GET /fuel/next`, `GET /fuel/:id`, `POST /fuel/:id` | A |
| | `GET /receipts/:file` | A, M, the person who logged it, and the vehicle's driver |
| Fuel cards | `/fuel-cards`, `/fuel-cards/new`, `/fuel-cards/:id/edit`, `POST /fuel-cards/:id`, `/delete` | A (M sees last 4 only) |
| Mileage | `GET /mileage`, `/mileage/weeks`, `/mileage/drivers`, `/mileage/addresses`, `/mileage/:reg` | A, M |
| | `POST /mileage/upload`, `/mileage/check`, `/mileage/weeks/remove`, `/mileage/addresses…`, `/mileage/trips/:id` | A |
| Employees | `GET /users`, `/users/:id`, `/users/new`, `/users/:id/edit`; `POST /users`, `/users/:id`, `/users/:id/vehicles…`, `/users/:id/cards…` | A (M view) |
| Projects | `GET /projects`, `/projects/:code`; `POST /projects`, `/projects/:code`, `/projects/:code/plant…` | A (M view) |
| Training | `GET /training`, `/training/matrix`, `/training/people/:id`; `POST /training/people…`, `/training/courses` | A only |
| Reports | `GET /reports`, `GET /reports/:key` (`plant`, `equipment`, `fleet`, `fuel-cards`, `employees`, `projects`, `training`, `mileage`; `?print=1` opens Print) | A, M (managers get last-4 card numbers; Training is A only) |
| Documents | `GET /documents/:id`, `POST /documents`, `POST /documents/:id/remove` | Whoever can see the record; employees can add/remove their own card copies |

## Uploads

| Upload | Field | Types | Limit |
| --- | --- | --- | --- |
| Fuel receipt | `receipt` | Photo or PDF | 15 MB, 1 file |
| Documents | `docs` | Photo or PDF | 15 MB each, 10 files |
| SoTrack trip list | `file` | `.xlsx` | 10 MB, 1 file |

Uploaded files are never public. They are fetched through `/receipts/:file` or `/documents/:id`, after the app's own permission check.

## Adding a route

1. Put it in the matching `src/routes/*.js` file.
2. Add the permission check first (`requireAdmin`, `requirePlantAccess`, `canUsePlant`, `canUseVehicle`).
3. Parse numbers with `numberField` and text with `text` from `src/auth.js`.
4. Add a test that a user without access gets 403 (see [TESTING.md](TESTING.md)).
5. Add it to this table.
