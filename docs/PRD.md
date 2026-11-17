# PRD: Marley Fleet & Plant System

Status: demo built and live on the preview address; Marley Construction have not signed yet.
Owner: Ben (Axholme ETM). Contact at Marley: Laura.

## Problem

Marley Construction Limited (MCL) and Marley Plant (MPL) run their plant, equipment, vans, fuel cards, mileage and staff training from a set of Excel sheets. The sheets disagree with each other, nobody gets warned when a service, LOLER test, MOT or ticket is due, check sheets are on paper, and working out personal miles from the SoTrack tracker export takes hours each week.

## Goal

One website (not an app to install) that the office, site managers and drivers use from a browser on a PC or phone, and that replaces the spreadsheets as the only source of truth.

## Target users

| User | Account | Main jobs |
| --- | --- | --- |
| Office admin | Admin | Keep the registers, check fuel receipts, upload mileage, keep training up to date, print reports |
| Manager | Employee type `manager` | See everything an admin sees, read-only |
| Site manager | Employee type `site_manager` | Weekly plant check sheets and defects for the plant on their projects, log fuel for their own vehicle |
| Fleet driver | Employee type `driver` | Daily walk-around check, report defects, log fuel with a receipt photo |
| Site worker | Employee type `worker`, usually no sign-in | Appears on the Training Matrix only |

## Core features and acceptance criteria

1. **Plant and Equipment registers** (MCL and MPL). Asset numbers follow the plant log (`MCL-EX-0001`, `MPL-DU-0001`). Each item has a service plan on running hours, LOLER / thorough examination / calibration dates, a combined history, documents and defects. Amber when due soon, red when overdue.
2. **Fleet register.** Reg, driver, MOT, tax and service dates, walk-arounds, defects, documents, history. SORN vehicles are not flagged.
3. **Checks and defects.** Weekly plant check sheet (overdue after 7 days) and daily vehicle walk-around. A failed item raises a defect with a severity; admins resolve or reopen it.
4. **Fuel.** Drivers log diesel, unleaded or AdBlue with a required receipt photo or PDF. The office prices and ticks each receipt on the fuel dashboard.
5. **Fuel cards.** Full card number for admins only; others see the last 4 digits. PINs are never stored. A person's cards follow their vehicle.
6. **Mileage.** Upload the SoTrack Trip List (.xlsx) each week; the system splits work and personal miles using saved sites, homes, allowed stops and unknown addresses; the office ticks each driver as checked.
7. **Employees.** Employee records with optional sign-in; vehicles and fuel cards are assigned from the person's page.
8. **Training Matrix** (admin only). General, NPORS and CPCS courses with expiry dates, card colours and certificate copies.
9. **Projects.** Each project has one site manager and its plant; a site manager sees only their projects' plant.
10. **Reports.** Printable A4 reports for plant, equipment, fleet, fuel cards, employees, projects, training and mileage.

## Non-goals

- A native phone app (it is a website).
- CSV exports (removed at Ben's request).
- Server-side PDF generation (reports use the browser's Print to PDF).
- Storing fuel card PINs, ever.
- Using or copying code from the Falgate repository.

## MVP scope

Everything above, plus the go-live work in [ROADMAP.md](ROADMAP.md): staging, CI, backups, login protection, forgot password and email reminders. Mileage may go live a few weeks later because Marley must tell staff first.

## Success metrics

- The office stops using the plant, van, fuel card and training spreadsheets.
- Every driver is ticked as checked on Mileage each week.
- No missed LOLER, MOT or ticket expiry after go-live.
- Weekly check sheets done on time for every machine that needs one.

## Constraints

- Hosted on Cloudflare Workers + Supabase (see [ARCHITECTURE.md](ARCHITECTURE.md)); costs kept low.
- Holds personal data (NI numbers, dates of birth, licences, trip locations), so UK data protection applies (see [SECURITY.md](SECURITY.md)).
- Pricing agreed with Ben: £3,500 up front, £945 a month (proposal in the project files under `business/pricing/`).

## Open questions

- Does Marley want texts as well as emails for reminders?
- Can drivers see their own mileage? (Default: no.)
- Is the Plant / Equipment split (`PLANT_SECTION` in `src/categories.js`) right?
- Can Managers see the Training Matrix? (Default: no.)
