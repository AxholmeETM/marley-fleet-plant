# Design system

All styles live in one file: `public/static/style.css`. Reuse its classes; don't add a second stylesheet or a CSS framework.

## Principles

- Apple-style: system font, white page, lots of space, rounded cards, few borders.
- Marley navy and white. **Light theme only** (Ben asked for no dark mode).
- Plain British English labels. Dates show as `dd/mm/yyyy` (`ukDate`), money as `£1,234.56` (`money`).

## Colour tokens (`:root` in style.css)

| Token | Value | Use |
| --- | --- | --- |
| `--navy` / `--brand` / `--accent` | `#01024c` | Menu bar, buttons, links in navigation. Taken from the Marley logo |
| `--accent-hover` | `#1c1e78` | Button hover |
| `--accent-soft` | `#e8e8f3` | Selected tab, soft highlights |
| `--ink` / `--ink-2` / `--muted` | `#0f1c33` / `#33415a` / `#64708a` | Text, secondary text, hints |
| `--line` / `--line-strong` | `#e3e8ef` / `#cfd7e3` | Dividers and card edges |
| `--red` / `--red-bg` | `#d70015` / `#ffeceb` | Overdue, unsafe, open defects, "Personal" funding |
| `--amber` / `--amber-bg` | `#a05a00` / `#fff4e0` | Due soon |
| `--green` / `--green-bg` | `#1a7f37` / `#e7f6ea` | OK, done, checked |
| `--grey-bg` | `#eef2f7` | Not applicable / inactive |

Status always comes from `src/status.js` as `{ level, text }` and is drawn with the `pill(status)` helper, so colours stay consistent.

## Typography

- Font stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Arial, sans-serif`, 15px, line-height 1.47.
- `h1` 2rem bold (page title in the top pane), `h2` 1.18rem semibold (card titles), `h3` 1rem.

## Shape and spacing

- `--radius: 18px` for cards, `--radius-sm: 12px` for inputs and small blocks.
- `--shadow` for cards, `--shadow-lift` for dialogs and hover.

## Layout

- **Navy menu down the left** (`.sidebar`, 208px) with the Marley logo (`public/static/logo.png`) top left.
- **Fixed white top pane** on every page: breadcrumb, title, action buttons and filters (`partials/header.ejs` … `partials/pane-end.ejs`).
- Filters are **drop-downs**, not button rows.
- Item pages (plant, vehicle): Details and plan on the left, one combined History with filter tabs on the right, a red strip for open defects, "Add record" opens a pop-up.

## Components

- Buttons `.btn` (navy filled), secondary and danger variants; one primary action per pane.
- Cards, KPI tiles (`.kpis-4`), dashboard grid (`.dash-grid`), tables, pills, tabs.
- Dialogs `.dlg` (full screen on phones under 600px).
- Date chips with a card-colour bar on the Training Matrix.
- Breadcrumbs follow the way you came (`src/crumbs.js`, `?from=`).

## States

- **Empty:** a muted sentence saying what will appear and, for admins, the button to add the first one.
- **Loading:** pages are server-rendered, so there are no spinners; long uploads disable the button while sending.
- **Error:** the shared `error.ejs` page with a plain sentence; form errors come back as a red flash message.
- **Success:** a green flash message at the top of the next page.

## Breakpoints

- ≤ 1100px: dashboard drops to one column, KPIs to two.
- ≤ 900px: the left menu becomes one scrolling row across the top, and grids drop to one column.
- ≤ 640px / 600px: tables and dialogs go full width.
- `@media print`: reports print as A4 landscape without the menu.

## Accessibility

- Real `<label>`s on every input; buttons are `<button>`, links are `<a>`.
- Status is never colour alone: pills carry text ("Overdue", "Due 12/11/2026").
- Touch targets at least 40px high on phones.
