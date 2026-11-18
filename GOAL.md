# Shiply: the end goal

This page is the fixed reference for Shiply Core 2.0. Every screen, feature and decision is
checked against it. It changes only when the owner says so in writing, and every change is logged
at the bottom.

Taken from the owner's own documents: System Requirements v2.0 (April 2026), the Shiply Brand
Manual, the locked decisions in the earlier versions, and the conversations of 18 Nov 2026.

---

## 1. Why Shiply exists

Eve Chantelle ships its orders through third-party couriers today (Bosta). **Shiply is Eve
Chantelle's own courier company**, so it no longer depends on them, and so it can sell the same
service to other online merchants in Egypt.

Brand promise: *Ready, Set, Shiply.* Moving parcels should be simple, fast and reliable, with
clear communication from pickup to the customer's door.

## 2. The end goal

**A next-day courier company that merchants prefer to Bosta, run on its own system.**

That system does the whole job end to end:

1. **Merchants** sign up, create orders, print labels, request pickups, follow every order, and
   get their cash on time with proof. The portal works as well as Bosta's and looks like Shiply.
2. **Shiply's network** picks parcels up, scans them through the sorting facility and last-mile
   hubs, and delivers the next day, without losing anything.
3. **Couriers** have a simple phone app: today's run, deliver, record why a delivery failed,
   collect cash, hand it in.
4. **Customers** know where their parcel is and can reschedule or fix their address themselves,
   by WhatsApp and a tracking link.
5. **Money is always right.** Every pound of cash on delivery is traced from the customer to the
   courier, the hub safe, the merchant's wallet and the bank, with second-person approval and
   proof of every transfer.
6. **The office team** runs the day from one place: what's waiting, what's late, where the cash
   is.

## 3. What success looks like

- **Eve Chantelle ships all of its next-day orders through Shiply** instead of Bosta.
- Other merchants sign up and stay because the portal is clearer and they're paid on time.
- No parcel or pound goes missing without the system showing where and who.
- Most failed deliveries are saved by the customer rescheduling or fixing the address.
- The owner looks at any screen and is proud of it.

## 4. What Shiply Core 2.0 builds (fixed)

| In | Out (not in this version) |
|---|---|
| Next-day parcels in Cairo and Giza first, then more governorates | Shiply Now (60 minutes, dark stores, stock, riders) |
| Merchant portal | International shipping and drop-off points |
| Operations for the office team | HR, Sales, Purchasing |
| Hub station (scan in, sort, bag, dispatch, returns) | Full accounting (tax returns, budgets) |
| Courier phone app | The public marketing website |
| Customer tracking page with WhatsApp and SMS | Code from earlier Shiply versions |
| Cash, merchant wallets, cash-outs and proof of transfer | |

**After launch, in this order unless the owner changes it:** Shopify app, merchant API,
deeper analytics, QC audits, agents' own screen, tax invoices.

## 5. How it must be built (fixed)

1. **Design first.** Every screen is a clickable mockup the owner approves before it is built.
   The built screen matches it.
2. **One part at a time**, finished and checked by the owner in the browser before the next.
3. **Behaves like Bosta, looks like Shiply.** Bosta's portal is the reference for what each
   screen does. The Shiply brand manual decides how it looks. Calm, clear, table first.
4. **Arabic and English** on every screen, phone and laptop.
5. **Money is exact:** whole piastres, a ledger that is never edited, approvals by a second
   person.
6. **Nothing hard-coded:** prices, fees, limits and times are settings.
7. **Every action is recorded:** who, what, when.

## 6. Business rules already decided by the owner

These came from the owner's earlier locked decisions and are kept unless the owner changes them.

1. **Couriers work through agents** (outsourced courier companies), paid by one settlement per
   period.
2. **Cash:** couriers hand cash to the hub safe at the end of the day, counted by both sides; a
   difference opens a case at once.
3. **The network:** pickup → sorting facility (inbound, sorting, outbound, sealed bags) → night
   truck → last-mile hub (receive, sort by zone, dispatch) → courier → customer. Returns go the
   same way back.
4. **Failed delivery:** the reason is recorded and the call log checked. Up to 3 attempts, then
   the parcel returns to the merchant.
5. **Fees:** shipping by zone and size, VAT 14%, 1% COD fee above EGP 3,000, EGP 7 to let the
   customer open the package.
6. **Payouts:** on the merchant's schedule, approved by a second person, with proof of transfer.
7. **Phone screens** are one installable web app, working offline.

## 7. How we stop going back and forth

1. Before building anything, we check it against this page. If it doesn't serve section 2, it
   waits.
2. A new idea goes into "After launch" unless the owner says it's needed for launch.
3. A decision, once made, is written in the log below and not reopened unless the owner asks.
4. Earlier Shiply versions are history. They're read only to remember a rule, never merged.

## Decision log

| Date | Decision |
|---|---|
| 18 Nov 2026 | Shiply Core 2.0 is a fresh, standalone system. No code from earlier versions. |
| 18 Nov 2026 | Shiply next-day only. Shiply Now stays separate. |
| 18 Nov 2026 | Its own git repository, separate from `IA`. |
| 18 Nov 2026 | This page is the fixed reference for the end goal. |
