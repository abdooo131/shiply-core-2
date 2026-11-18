# Shiply Core 2.0: first version design

Date: 18 Nov 2026. Status: draft for the owner's approval.
Read with `GOAL.md` (the fixed end goal), `PLAN.md` and `CLAUDE.md` (the working rules).

## 1. Intent

Turn the approved merchant portal mockup (`shiply-merchant-portal.html`) into a working system with
a real database, so **one merchant (Eve Chantelle) can run real next-day orders end to end** on the
merchant side: create orders, print labels, request pickups, follow each order, and see the cash
arrive in the wallet with proof of every transfer.

Why: this is the first step to Eve Chantelle shipping all next-day orders through Shiply instead of
Bosta (`GOAL.md` section 3).

## 2. Goals, non-goals, anti-goals

**Goals**
1. Merchant side of the mockup, working on real data, in Arabic and English, laptop and phone.
2. A database designed for the whole next-day system, not only the merchant side, so later parts
   (operations, hubs, couriers, customers) add tables without reshaping what exists.
3. Money that is always right: a ledger that adds up and never changes, with second-person
   approval for cash-outs.
4. A simple staff screen to move orders through their statuses, standing in for the hub and courier
   screens until those are designed.

**Non-goals (later rounds)**
- Operations dashboard, hub station, courier app, customer tracking page, WhatsApp/SMS.
- Shopify app, merchant API for outside systems, packaging shop payments, capital, insurance claims.
- Real bank transfers or card payments (cash-outs are marked paid by staff with the bank reference).
- Deployment to a public server.

**Anti-goals (a failure even if it works)**
- Screens that don't match the approved mockup, or look worse than it.
- Any money figure that can't be traced to ledger lines, or a balance stored instead of summed.
- Code copied from earlier Shiply versions.
- English-only text anywhere.

## 3. Constraints

- `CLAUDE.md` rules apply in full: money in integer piastres (`amountPiasters`), idempotent writes,
  every request authenticated and authorised, secrets only in environment variables, no personal
  data in logs, schema changes as migrations, tests against a real database.
- EGP only. Store times in UTC, show them in Africa/Cairo.
- Next-day Shiply only. No Shiply Now (60 minutes, dark stores, stock, riders).
- The owner approves every screen; built screens match the mockup.

## 4. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | **One Next.js app** (screens and server code together), PostgreSQL with PostGIS, typed database access, domain modules with clear boundaries | One codebase to run and deploy; fastest to a working, visible system; a clean versioned API can be added on the same services for phones and integrations later |
| B | Separate API server plus separate web app | More separation, but double the setup and deployment before anything is visible |
| C | Hosted backend service (e.g. Supabase) plus web app | Fastest start, but money rules end up in a vendor's database functions and auth; risky for the ledger |

Chosen by the owner on 18 Nov 2026 (left to Claude, recommendation A accepted).

## 5. Technical setup (Claude's calls, owner can change)

| Part | Choice | Why |
|---|---|---|
| Language | TypeScript, strict | One language everywhere, type safety for money |
| App | Next.js (App Router), React | Screens and server in one app |
| Database | PostgreSQL 16 + PostGIS | Reliable; PostGIS for zones and "which hub serves this point" |
| Database access | Prisma (schema and migrations) plus raw SQL for PostGIS queries | Typed queries, migrations kept in git |
| Validation | zod at every boundary (forms, API, uploads) | One place for input rules |
| Arabic/English | next-intl with message files `ar.json` and `en.json`; page direction follows the language | Every string translated at source, not after rendering |
| Styling | CSS variables from the mockup (brand tokens) and plain CSS modules; no UI kit | Pixel match with the mockup |
| Sign-in | Email or Egyptian mobile plus password; passwords hashed with argon2id; sessions in the database, sent as httpOnly secure cookies | No outside auth service; sessions can be revoked |
| Labels | PDF generated on the server with a Code 128 barcode; A6 thermal and A4 two-per-page | Matches the mockup's print options |
| Background jobs | A scheduled job runner inside the app (Postgres advisory lock so only one runs) for the nightly cash-cycle close | No extra queue service for one job; can move to a queue later |
| Tests | Vitest (rules and services) against a real Postgres test database; Playwright for main journeys | `CLAUDE.md` testing rules |
| Local running | Docker Compose for PostgreSQL + PostGIS | One command; nothing installed globally |
| Package manager | pnpm | Already installed |

## 6. How the code is organised

By domain, each folder owns its own data and exposes a small public interface. Other folders call
that interface, never its tables directly.

```
src/
  app/                  screens and route handlers (per language: /ar, /en)
  accounts/             users, sessions, sign-in, roles, team members
  merchants/            merchant profile, pickup locations, prices, settings
  location/             governorates, areas, zones (PostGIS), area lookup for an address
  orders/               orders, order types, statuses and allowed changes, events, labels
  pickups/              pickup requests and the orders in each pickup
  money/                ledger, wallet, cash cycles, cash-outs, proof of transfer
  operations/           the stand-in staff screen to move orders along
  shared/               money in piastres, Cairo dates, ids, errors, i18n helpers
```

Tests sit next to the code they test.

## 7. Database

All money columns are integers in piastres with the unit in the name. Every table has `id`,
`created_at`, `updated_at` unless it is append-only. Nothing is hard-deleted; records are archived.

### 7.1 People and access
| Table | Holds |
|---|---|
| `users` | Everyone who signs in: name, email, Egyptian mobile, password hash, language, status |
| `sessions` | Active sign-ins (hashed token, expiry, device), revocable |
| `staff_roles` | Shiply staff role per user: admin, operations, finance |
| `merchants` | Merchant company: names (en, ar), logo, industry, website, status, cash-out schedule |
| `merchant_members` | Which users belong to which merchant and their access: full, orders and pickups, finance only |
| `pickup_locations` | Merchant warehouses and showrooms, with area and point on the map; one default |
| `bank_accounts` | Merchant payout account (bank, holder, IBAN masked when shown); a change needs a second person |

### 7.2 Places and prices
| Table | Holds |
|---|---|
| `governorates` | The 27 governorates (names en, ar) |
| `areas` | Districts and neighbourhoods with names in both languages and an optional PostGIS shape |
| `pricing_zones` | Cairo & Giza, Alexandria, Delta, Canal, Upper Egypt, Red Sea & Sinai; each area belongs to one |
| `price_lists` | A merchant's prices, versioned; a new version needs a second person to activate |
| `price_list_lines` | Price per pricing zone × package size × order type |
| `settings` | Every business value (open package fee, COD fee threshold and percent, VAT, insurance percent, attempts allowed, cycle close time), global or per merchant |

### 7.3 Orders
| Table | Holds |
|---|---|
| `customers` | A merchant's customers: name, mobile, past addresses (for the returning-customer lookup) |
| `orders` | Order number (10 digits), merchant, type (deliver, pick and choose, exchange, return, sign and return, cash collection), customer, address and area, size, items and description, COD amount, open package, deposit, insurance and item value, reference, notes, status, attempts, expected date, fees frozen at creation |
| `order_items` | Products chosen for Pick & Choose (up to 3) and item lines |
| `order_links` | Exchange and return orders linked to the original order |
| `order_events` | Append-only timeline: every status change, note, attempt, with who, when and why |
| `order_status_rules` | The allowed status changes (in code and checked in the database) |
| `products` | Merchant catalog for Pick & Choose (name en, ar, price, active) |
| `labels` | Each label printed: order, format, printed by, when (for "not printed" filters) |
| `bulk_uploads` | Uploaded spreadsheets, row results and errors |
| `saved_views` | A user's saved order filters |

**Statuses** (internal, each mapped to what the merchant sees): New, Pickup requested, Picked up,
In progress, Out for delivery, Attempt failed, Awaiting merchant action, Rescheduled, Delivered,
Returning, Returned, Canceled. Allowed changes are a fixed list; anything else is refused.

### 7.4 Pickups
| Table | Holds |
|---|---|
| `pickups` | Requested day, location, contact, expected count, status (scheduled, collected, canceled), repeat weekly |
| `pickup_orders` | Which orders were collected in which pickup |

### 7.5 Money
| Table | Holds |
|---|---|
| `ledger_accounts` | Chart of accounts, plus one wallet account per merchant |
| `ledger_entries` | Append-only journal entries: reason, link to the order, cycle or cash-out, idempotency key |
| `ledger_lines` | Append-only lines; each entry's lines add up to zero (checked by the database) |
| `cash_cycles` | One per Cairo day: closed at 23:59, totals of cash collected and fees |
| `cash_outs` | Prepared, approved (by a second person), paid (with bank reference), canceled |
| `cash_out_proofs` | Proof of transfer document for each paid cash-out |
| `audit_log` | Append-only: who changed what, before and after, for every action |
| `idempotency_keys` | Requests already handled, so a repeat is applied once |

**What gets booked**
1. **Delivered with cash:** the courier holds the cash; the merchant's wallet is owed it; the fees
   (shipping, open package, COD fee, insurance) and VAT 14% are charged to the wallet.
2. **Returned or failed for good:** shipping and the return fee are charged; no cash.
3. **Cash cycle close (nightly):** the day's delivered orders are grouped into the cycle; the
   wallet shows two lines, cash collected and fees.
4. **Cash-out:** on the merchant's schedule, finance prepares it, a second person approves it,
   finance marks it paid with the bank reference, and the proof of transfer is created.

Balances are always summed from ledger lines, never stored.

## 8. Screens in this version

Every merchant screen in the mockup, working on real data: Home, Orders (tabs, filter pills,
saved views, bulk actions), Order page (details, tracking, notes), Create order (all six types,
bulk upload), Pickups, Wallet (balance and breakdown, transactions, cash cycles, cash-out receipt,
proof of transfer), Analytics, Products, Settings (preferences, profile, business, team, pricing,
payouts), Support chat (stored as messages; no live agent yet).

Shown but not working yet (as in the mockup, clearly marked): Packaging shop checkout, Credits
top-up, Applications, Capital, API keys.

**Staff stand-in screen** (`/staff/orders`): find an order and move it along (picked up, out for
delivery, delivered with cash amount, failed with one of the 7 reasons, returned), and prepare,
approve and mark paid cash-outs. Ugly is allowed here; it is replaced by the operations screens.

## 9. Testing and checks

- Every status change, fee calculation, ledger posting, cash-cycle close and cash-out step has tests
  against a real test database.
- Integration tests for the critical paths: create order → deliver → cash cycle → cash-out → proof.
- Playwright journeys: sign in, create each order type, print a label, request a pickup, see the
  wallet update after delivery, in both languages.
- Each part is shown to the owner in the browser before the next starts.

## 10. Owner decisions (18 Nov 2026) and Claude's calls

**Decided by the owner (proposed defaults accepted)**
1. **Prices:** start with the mockup's sample price list (Small in Cairo & Giza EGP 68; extra per
   farther zone, larger size and some order types). Replaced by Shiply's real price list before
   launch; prices are data, so this is a settings change, not code.
2. **VAT:** 14% added on top of Shiply's fees.
3. **Return fee:** 50% of the shipping fee when an order comes back undelivered.
4. **Cash-out fee:** none for bank transfers.

**Claude's calls (the owner may change them)**
- Order numbers: 10 digits, random, unique.
- Cash cycle closes at 23:59 Africa/Cairo every day.
- Labels: A6 thermal and A4 two per page.
- Sign-in and sessions handled by the app itself; no outside sign-in service.
- Up to 3 delivery attempts, then the order returns to the merchant.

## 11. Left to the builder

Exact table columns and indexes, component structure, file names (following `CLAUDE.md`), the
order of tasks inside each part, and test cases.
