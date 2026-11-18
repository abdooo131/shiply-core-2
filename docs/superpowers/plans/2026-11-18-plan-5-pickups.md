# Plan 5: Pickups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A merchant manages pickup locations and requests a courier to collect their ready orders on a chosen day (once or every week), sees upcoming and past pickups, and can cancel one; the orders in a pickup follow it (pickup requested → picked up, or back to new when canceled).

**Architecture:** New `src/pickups` domain (locations, pickups, weekly repeat) on the existing pattern; orders change status only through `changeOrderStatus`. Screens: Pickups page (Upcoming / History / Locations), request dialog, "Request pickup" bulk action on Orders. Staff marking a pickup collected is in Plan 6 (functions built and tested here).

**Spec:** design §7.4 (`pickups`, `pickup_orders`), §8 (Pickups). Look: mockup `V.pickups`, `pickupModal`, `rateModal` (~line 1330). Standing approval of 18 Nov.

## Decisions (Claude's calls)
1. **Pickup number:** 8 random digits, unique.
2. **Day:** from tomorrow (Cairo) up to 14 days ahead. Same-day pickups are not offered in the first version.
3. **One scheduled pickup per location per day** (a second request for the same place and day returns the existing one).
4. **Which orders go:** when a pickup is requested, the merchant's orders that are `new` at that moment are attached and move to `pickup_requested`. Orders created later can be added with "Request pickup" on the Orders page (they join the next scheduled pickup for that location, or a new one is requested).
5. **Collected (staff, Plan 6 screen):** the pickup becomes `collected` with the count of orders actually collected; those orders move to `picked_up`; attached orders not collected go back to `new`.
6. **Canceled (merchant, while scheduled):** attached orders go back to `new`.
7. **Every week:** a repeating pickup creates next week's pickup (same weekday, place, contact) when it is collected or canceled; "Stop repeating" ends the series.
8. **Locations:** label, address, area (area search), contact name and mobile, one default. Managed on the Pickups page ("Locations" tab). Seeded "Main warehouse · Nasr City" stays the default.
9. **Rating** a collected pickup (1–5 stars + comment), as in the mockup.

## Global Constraints
Plans 1–4 constraints. Pickup days stored as dates (Cairo calendar day); all writes idempotent and audited; one query per list, paged history (25).

## Review Focus
1. **Double click on "Request pickup"** → one pickup. Task 2.
2. **Request for a day in the past or too far ahead** → refused with a clear message. Task 2.
3. **Cancel after the courier collected** → refused. Task 2.
4. **An order attached to two pickups** → impossible (unique order in `PickupOrder`). Task 2.
5. **Deleting or renaming the default location while a pickup is scheduled there** → the scheduled pickup keeps its address snapshot. Task 1.

---

### Task 1: Pickup locations
**Files:** schema (`PickupLocation` gets `contactName`, `contactMobile`, `isActive`), migration; `src/pickups/locations.ts` (+test).
**Produces:** `listPickupLocations`, `savePickupLocation`, `setDefaultPickupLocation`, `archivePickupLocation` (need `orders`; mobile normalized; area must be served).
- [ ] Tests → fail → implement → pass → commit.

### Task 2: Pickups
**Files:** `Pickup` (number, merchantId, locationId, address snapshot, contact snapshot, pickupDate @db.Date, expectedCount, status scheduled|collected|canceled, repeatWeekly, seriesId, collectedCount, rating, ratingComment, createdBy, timestamps; unique (locationId, pickupDate) where scheduled — enforced in code inside a transaction with a lock on the location row), `PickupOrder` (pickupId, orderId unique); migration; `src/pickups/pickups.ts` (+test).
**Produces:** `requestPickup(user, merchantId, input, key)`, `addOrdersToPickup(user, merchantId, orderIds, locationId?)`, `cancelPickup`, `stopRepeating`, `ratePickup`, `listPickups(user, merchantId, { tab, page })`, `markPickupCollected(staffUser, pickupId, collectedOrderIds)`.
- [ ] Tests (Decisions 2–7 and Review Focus 1–4) → fail → implement (status changes via `changeOrderStatus`; staff = admin|operations) → pass → commit.

### Task 3: Pickups page and Request pickup
**Files:** `src/app/[locale]/(portal)/pickups/*`, Orders bulk action "Request pickup", messages, `e2e/pickups.spec.ts`; `pickups` leaves coming soon.
- [ ] e2e (ar/en): add a location; request a pickup for tomorrow (new orders attach, Orders shows "Pickup requested"); cancel it (orders back to New); weekly pickup shows "Every week"; bulk "Request pickup" from Orders. Screenshots 1440/375 ar/en light/dark vs mockup → commit.

### Finish
- [ ] Review; fix test-first; merge to main and push.
