# UX flows

Each flow lists who does it, the steps, and what happens on success, failure and when there's nothing to show.

## Menu

Admin: **Dashboard · Registers (Plant, Fleet, Equipment) · Fuel (Fuel Logs, Fuel Cards, Mileage) · Employees · Training Matrix · Projects · Reports**.
Site manager: Dashboard (their plant and fleet, with Calendar), Plant, their vehicle, Log fuel. No Fuel Cards, Employees or admin pages.
Fleet driver: a home page for their vehicle(s): walk-around, defect, log fuel.
Manager: the admin menu, read-only, without the Training Matrix.

## 1. Sign in

1. Open the site, enter email and password.
2. **Success:** goes to their home page for their role.
3. **Failure:** "Email or password is incorrect." Same message whether the email exists or not.
4. Change password under their name, top right (current password, new one twice, 8+ characters).

## 2. Driver: daily walk-around

1. Home page → **Walk-around** on their vehicle.
2. Tick each item OK / defect, enter mileage, notes.
3. **Success:** saved; any failed item creates a defect; flash "Walk-around saved".
4. **Failure:** another person's vehicle → 403 "No access".

## 3. Site manager: weekly plant check sheet

1. Plant → item → **Plant check** (or Checks → New).
2. Enter hours and project; tick items.
3. **Success:** running hours update; service plan recalculates; failed items create defects.
4. Overdue after 7 days without a check.
5. **Empty:** a site manager with no projects sees "No plant yet"; an admin must assign them a project.

## 4. Report and resolve a defect

1. Anyone who can see the asset → **Report defect**: description, severity (Minor, Major, Unsafe – do not use), photos.
2. Item page shows a red strip while it is open.
3. Admin → Defects → **Resolve** with what was done (and documents); or **Reopen**.

## 5. Log fuel (driver or site manager)

1. **Log fuel**: vehicle, date, fuel type (diesel, unleaded, AdBlue), litres, mileage, station, fuel card, **receipt photo or PDF (required)**.
2. Only their own cards and cards on a vehicle they drive are offered; "paid another way" is allowed.
3. **Success:** saved, flash shown. **Failure:** no receipt, wrong card (403), file over 15 MB.

## 6. Office: check fuel receipts

1. Fuel Logs → Fuel dashboard → open an unchecked receipt.
2. Receipt shows beside the entry; correct details, enter the cost, tick checked.
3. **Save & next receipt** moves to the next unchecked one. **Empty:** "All receipts checked".

## 7. Office: weekly mileage

1. Mileage → **Upload** the SoTrack Trip List (.xlsx).
2. Trips link to vehicles by reg and to each vehicle's driver.
3. Addresses → **To sort** lists new addresses: save each as Site, Home, Allowed stop or Unknown.
4. Weekly trips → open the week → review each driver, flip any trip work/personal (with Undo), tick **Checked**.
5. **Failure:** not an .xlsx → "Please upload the Trip List as an Excel .xlsx file." Re-uploading the same week doesn't duplicate trips.

## 8. Add an employee

1. Employees → **Add**: name, job role, type (Fleet driver, Site manager, Manager, Site worker / no sign-in).
2. For a sign-in: email and a password of 8+ characters, told to them in person.
3. Lands on their training page to tick "Needs this" and enter dates already held.
4. On their page, **Assign** vehicle and fuel card (cards follow the vehicle).
5. Site manager: Projects → project → set as site manager.

## 9. Add plant, equipment or a vehicle

1. Registers → Plant / Equipment / Fleet → **Add**.
2. Owner (MCL or MPL) and category suggest the next asset number.
3. Service plan, LOLER and dates; project for plant.
4. Upload certificates on the item page; **Add record** for services, LOLER, thorough examination, MOT, tax, repairs and planned repairs.

## 10. Training

1. Training Matrix (admin only) → Dashboard shows expiring in 30 days, expired, needed.
2. Matrix tab: click a cell to set the expiry, card colour and note.
3. Person page: card copies and certificates.

## 11. Reports

1. Reports → choose a report (and dates or people where asked).
2. A4 landscape page opens; **Save as PDF** uses the browser's print.

## Leaving and disposal

- A leaver is made inactive: can't sign in, history stays.
- Sold, stolen or scrapped assets get that status, not deleted.
