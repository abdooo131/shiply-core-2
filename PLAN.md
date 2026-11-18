# Shiply Core 2.0: plan

Date: 18 Nov 2026. Owner: Abdelrahman Elassal.

The end goal and the fixed decisions are in `GOAL.md`. This plan is how we get there.

## 1. What this version is

**A new, standalone system for Shiply: next-day parcel delivery.** It is built from scratch in
this folder, looks and works the way the owner approves screen by screen, and stays small enough
to finish properly.

**Not in this version**
- **Shiply Now** (60-minute delivery from dark stores). It stays separate and can connect later
  through an API if wanted.
- **Code from earlier versions.** Nothing is copied or merged from the ShiplyNow platform, Shiply
  Core or the `shiply` rebuild. Their documents may be read to remember a business rule, but every
  rule is confirmed with the owner before it is used.
- HR, Sales, Purchasing, full accounting, the public website. These can come later as separate
  steps if the business needs them.

## 2. Why earlier versions disappointed, and what changes

| Before | Now |
|---|---|
| Everything built at once (one version reached a full system in a day) | One part at a time, each finished before the next |
| Features first, design after, so screens looked assembled | **Design first**: every screen approved as a clickable mockup before it is built |
| Scope kept growing (HR, Sales, website, two services) | One service, a fixed launch scope, extras only after launch |
| Several codebases merged and restarted | One clean codebase that never imports old code |
| Hard to see progress | The owner checks every step in the browser and approves it |

**Quality bar for every screen**
- It matches its approved mockup.
- It works in Arabic (right to left) and English, in light mode, on a laptop and on a phone.
- Empty, loading and error states are designed, not left blank.
- It feels like Bosta in behaviour and like Shiply in look: calm, clear, table first.

## 3. Launch scope

What Shiply needs to deliver real parcels for real merchants:

| Part | Who uses it | What it covers |
|---|---|---|
| **Merchant portal** | Merchants | Sign up, create orders (single and bulk), labels, pickups, orders and tracking, wallet and cash-outs, settings |
| **Operations** | Office team | Merchants and prices, pickups, the hub flow (receive, sort, dispatch, returns), couriers, cash, alerts |
| **Hub station** | Hub staff (phone or tablet) | Scan in, sort, bag, dispatch, returns |
| **Courier app** | Couriers (phone) | Today's run, deliver, failed attempt with reason, collect cash, pickups, hand cash to the hub |
| **Customer page** | End customers | Track, reschedule, fix the address, rate |
| **Money** | Finance | Cash from couriers to hub safes, merchant wallets, nightly cash cycles, cash-outs with second-person approval, proof of transfer |
| **Messages** | Customers | WhatsApp and SMS for confirmation, out for delivery, failed attempt |

Later, after launch: Shopify app, merchant API, analytics in depth, QC audits, agents' own portal,
tax invoices, reports.

## 4. Steps

### Step 1: Design everything first (about 2 weeks)
Clickable mockups like `shiply-merchant-portal.html`, one per part in section 3, each approved by
the owner before any building starts.
1. Finish the merchant portal: Arabic and RTL, the remaining next-day items (Sign & Return and
   Pick & Choose order types, insurance, support chat), remove drop-off points and international
   shipping, owner sign-off. No 60-minute parts.
2. Operations screens for the office team.
3. Hub station and courier screens (phone size).
4. Customer tracking page.
5. A short design system page: colours, type, buttons, tables, forms, pills, drawers, phone
   patterns. Every later screen uses only these pieces.

### Step 2: Decide the technical setup (2 to 3 days)
Proposed, to confirm:
- **Own git repository** for this folder (done 18 Nov), separate from the `IA` repository.
- TypeScript, Next.js for every screen, a typed API, PostgreSQL with PostGIS for zones, hosted in a
  managed cloud with daily backups.
- An installable web app for hub and courier phones, with offline scanning.
- Rules from the start: money in whole piastres, every change audited, nothing deleted, every
  business value a setting, Arabic and English for every string.

### Step 3: Build, one part at a time (about 10 to 12 weeks)
Each part is planned, built with tests, checked by the owner in the browser against its mockup,
then frozen before the next starts.
1. Accounts and login, merchants and their prices.
2. Orders, address and zone detection, labels with barcodes.
3. Pickups and the hub flow with scanning.
4. Courier app and delivery, failed attempts, returns.
5. Cash, wallets, cash cycles, cash-outs, proof of transfer.
6. Customer page and WhatsApp/SMS messages.
7. Operations dashboard and alerts.

### Step 4: Launch (about 2 weeks)
Security and backup checks, a full test day with Eve Chantelle's own orders, training for the hub,
couriers and finance, then go live in one area and expand.

## 5. Start now: things that take weeks
- WhatsApp Business API and message templates (Meta approval, 2 to 4 weeks).
- Settlement bank account with bulk transfers.
- Real delivery zone borders and the first hub location.
- Courier supply (agents or direct) and their contracts.
- Google Maps key, hosting and a domain.

## 6. Decisions needed from the owner
1. ~~**Scope**~~ **Decided 18 Nov:** Shiply next-day only. Shiply Now stays separate; no
   60-minute orders, dark stores, stock or riders in this version.
2. ~~**Repository**~~ **Decided 18 Nov:** this folder is its own git repository (branch `main`),
   separate from the `IA` repository and its old branches. The `IA` repository ignores this folder.
3. ~~**Couriers**~~ Kept from earlier decisions (GOAL.md section 6): through agents.
4. ~~**Cash**~~ Kept from earlier decisions (GOAL.md section 6): handed to the hub safe.
5. **Start:** begin Step 1 by finishing the merchant portal design in Arabic and English?
