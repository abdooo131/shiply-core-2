# Plan 2: Places and Prices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shiply knows where a parcel goes and what it costs: every district of Cairo and Giza plus the main city of every other governorate, grouped into six pricing zones; a versioned price list that needs a second person to switch on; business settings (VAT, fees) as data; one function that prices any order; and the merchant's Pricing tab from the mockup.

**Architecture:** A new `src/location` domain owns zones and areas; `src/pricing` owns settings values, price lists and the fee quote. Both follow Plan 1's pattern: functions with access checks and audit, a small `index.ts`, tests beside the code against the real test database. Prices and fees are rows, never constants in code.

**Tech Stack:** As Plan 1. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-18-first-version-design.md` §7.2 (places and prices), §7.4 "What gets booked", §10 owner decisions. Business rules: `GOAL.md` §6 item 5 (fees). Look: `shiply-merchant-portal.html` Settings → Pricing (`V.settings` `pricing`, lines ~1735–1740) and the sample prices (`ZONES`, `SIZES`, `BASE`, `ZONE_ADD`, lines 800–813). Rules: `CLAUDE.md`.

## Owner decisions this plan relies on

Decided:
1. **Areas (18 Nov):** every district of Cairo and Giza (about 80, Arabic and English) plus the main city of each of the other 25 governorates. More districts are added later as data.
2. **Sample prices** until Shiply's real list (spec §10.1), copied from the mockup: Deliver = `BASE[size] + ZONE_ADD[zone]`; Exchange = Deliver + 12; Return = Deliver − 4; Cash collection = 55 + `ZONE_ADD[zone]` (same for every size). Amounts in EGP.
3. **VAT 14%** on top of Shiply's fees; **return fee 50%** of shipping; **open package EGP 7**; **COD fee 1% above EGP 3,000** (GOAL §6.5).

To confirm at plan approval (my proposed default in bold; changing one is a settings or seed-data edit, not code):
4. COD fee: **1% of the part of the cash above EGP 3,000** (EGP 5,000 cash → EGP 20 fee), or 1% of the whole amount once above EGP 3,000 (→ EGP 50).
5. Pick & Choose costs **the same as Deliver**; Sign & Return costs **the same as Exchange**. The mockup gives no price for either.
6. Matrouh is in the **Red Sea & Sinai** zone (remote); New Valley, Faiyum, Beni Suef and Minya are in **Upper Egypt**; Qalyubia is in **Delta**.
7. Insurance fee: **0% until you set it** (the mockup shows insurance cover but no price).

## Not in this plan (and where it goes)

- Map shapes for areas (spec §7.2 "optional PostGIS shape") and "which hub serves this point": with hubs and routing, after the merchant portal. Areas are chosen from the list until then.
- Settings for delivery attempts and the cash-cycle close time: added by the plans that use them (Orders, Money).
- A staff screen to propose and approve price lists: Plan 6 (staff stand-in screen). Until then the default list is seeded and the functions are covered by tests.

## Global Constraints

- Everything in Plan 1's Global Constraints still applies (`docs/superpowers/plans/2026-11-18-plan-1-foundation.md`): money in integer piastres named `…Piasters`, UTC storage, all text from `messages/*.json`, brand tokens from the mockup, kebab-case files, tests beside code, real test database.
- Percentages are stored as **basis points** (`…BasisPoints`, 1400 = 14%). Rounding is half up to the piastre, done once per fee line (reuse `addVatPiasters`' integer method).
- Zone codes: `cairo_giza`, `alexandria`, `delta`, `canal`, `upper_egypt`, `red_sea_sinai`. Sizes: `small`, `medium`, `large`, `light_bulky`, `heavy_bulky`. Order types: `deliver`, `pick_and_choose`, `exchange`, `return`, `sign_and_return`, `cash_collection`.
- A price list covers all 6 zones × 5 sizes × 6 types = **180 lines**, or it is refused.
- Schema changes ship as migrations, approved by the owner with this plan (`CLAUDE.md` rule 1); each migration states its undo.

## Review Focus

1. **Arabic spellings of the same place:** "مدينه نصر", "مدينة نصر" and "Nasr City" find the same area; so do "المعادى"/"المعادي" and "أكتوبر"/"اكتوبر". Test in Task 1.
2. **A price change racing another:** two approvals at once never leave two active lists for one merchant. Test in Task 3.
3. **Boundary amounts:** COD of exactly EGP 3,000 pays no COD fee; EGP 3,000.01 pays the fee on one piastre (rounds to 0). Test in Task 4.
4. **A merchant with their own prices:** their list wins over the default; a merchant without one gets the default. Test in Task 3.
5. **An area outside service:** an area marked not served is refused with a clear message, never priced at a guess. Test in Task 4.

---

### Task 1: Pricing zones and areas

**Files:**
- Modify: `prisma/schema.prisma` (add `PricingZone`, `Area`; `PickupLocation.areaId` gets a foreign key), migration `prisma/migrations/<ts>_places/migration.sql` (undo: drop `Area`, `PricingZone`, the foreign key)
- Create: `prisma/seed-data/places.ts` (zones, governorate → zone map, areas), `src/location/areas.ts`, `src/location/arabic-search-normalization.ts`, `src/location/index.ts`, tests `src/location/areas.test.ts`, `src/location/arabic-search-normalization.test.ts`
- Modify: `prisma/seed.ts` (load places), `prisma/seed.test.ts`

**Interfaces:**
- Produces:
  - Models `PricingZone { code PK, nameEn, nameAr, sortOrder }`, `Area { id uuid, governorateCode → Governorate, zoneCode → PricingZone, nameEn, nameAr, searchKey, isServed default true, createdAt }`, unique `(governorateCode, nameEn)`, index `zoneCode`. `searchKey` = `normalizeForSearch(nameAr + ' ' + nameEn + ' ' + governorate names)`, written whenever an area is created or renamed (the seed uses the same function).
  - `getArea(areaId: string): Promise<AreaView | null>`; `type AreaView = { id; nameEn; nameAr; governorateCode; governorateNameEn; governorateNameAr; zoneCode; isServed }`
  - `searchAreas(query: string, options?: { limit?: number }): Promise<AreaView[]>` (default limit 20, served areas first)
  - `normalizeForSearch(text: string): string`

- [ ] **Step 1: Write the failing tests**
  - `normalizeForSearch`: `'مدينه نصر'` and `'مدينة نصر'` give the same result; `'أكتوبر'`, `'إكتوبر'`, `'اكتوبر'` the same; `'المعادى'` = `'المعادي'`; removes tashkeel and tatweel; English lower-cased and trimmed.
  - `searchAreas('مدينه نصر')[0].nameEn === 'Nasr City'`; `searchAreas('nasr')` finds it; `searchAreas('   ')` → `[]`; a query matching more than 20 returns 20.
  - seed: exactly 6 zones; every one of the 27 governorates has at least one area; Cairo + Giza have at least 70 areas; every area has a zone; Cairo and Giza areas are `cairo_giza`; running the seed twice adds nothing.
- [ ] **Step 2:** Run `pnpm test src/location prisma`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Write the models and migration (`pnpm db:migrate --name places`); `places.ts` with the zones (names in both languages, mockup order), the governorate → zone map from owner decision 6, and the areas (Cairo and Giza districts in full; one main-city area per other governorate). Normalization: strip tashkeel `ً-ٟ` and tatweel `ـ`; أ إ آ → ا; ة → ه; ى → ي; Arabic-Indic digits → Latin; lower-case. Search normalizes the query and matches it with `contains` on the stored `searchKey`, served first, then by name. (About 110 rows today; a trigram index comes when the full country list arrives.)
- [ ] **Step 4:** Run `pnpm test src/location prisma`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add pricing zones and areas with Arabic-friendly search"`

### Task 2: Business settings as data

**Files:**
- Create: `src/pricing/settings-values.ts`, `src/pricing/settings-values.test.ts`
- Modify: `prisma/seed.ts` (global values)

**Interfaces:**
- Consumes: `Setting` model (Plan 1), `writeAudit`, `SessionUser`
- Produces:
  - `SETTING_KEYS = ['vat_basis_points', 'return_fee_basis_points', 'cod_fee_basis_points', 'cod_fee_threshold_piasters', 'open_package_fee_piasters', 'insurance_basis_points'] as const`; `type SettingKey`
  - Seed values: 1400, 5000, 100, 300000, 700, 0
  - `getSettingValue(key: SettingKey, merchantId?: string): Promise<number>` (merchant value if set, else global; a missing global throws `Error` naming the key)
  - `setSettingValue(staffUser: SessionUser, key: SettingKey, value: number, merchantId?: string): Promise<void>` (staff `admin` or `finance` only; integer ≥ 0; audited with before and after)

- [ ] **Step 1: Write the failing tests:** global value read; merchant override wins for that merchant only; `setSettingValue` by a merchant user → `forbidden`; `-1` or `1.5` → `invalid_input`; unknown key rejected by the type and at runtime; audit entry written.
- [ ] **Step 2:** `pnpm test src/pricing/settings-values.test.ts` → FAIL.
- [ ] **Step 3:** Implement; scope string `global` or `merchant:<id>` (Plan 1 `Setting` model); value stored as `{ "value": n }`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5: Commit** `git commit -m "Add business settings values with merchant overrides"`

### Task 3: Price lists with second-person approval

**Files:**
- Modify: `prisma/schema.prisma` (enums `PackageSize`, `OrderType`, `PriceListStatus { pending active retired replaced }`; models `PriceList`, `PriceListLine`, `ActivePriceList`), migration `<ts>_price_lists` (undo: drop the three tables and the enums). No hand-written indexes: Prisma would drop them in a later migration. "One active list per scope" is the primary key of `ActivePriceList`.
- Create: `src/pricing/price-lists.ts`, `src/pricing/sample-price-lines.ts`, `src/pricing/price-lists.test.ts`
- Modify: `prisma/seed.ts` (one active default list built from the sample lines)

**Interfaces:**
- Consumes: `writeAudit`, `runOnce`, `SessionUser`, zone codes from Task 1
- Produces:
  - `PriceList { id, merchantId nullable (null = default for all merchants), version int, status, requestedBy, approvedBy nullable, activatedAt nullable, createdAt }`; `PriceListLine { priceListId, zoneCode, size, orderType, shippingPiasters }` unique on the last four; `ActivePriceList { scope PK ('default' or the merchant id), priceListId unique, updatedAt }`
  - `type PriceLine = { zoneCode; size; orderType; shippingPiasters }`
  - `buildSamplePriceLines(): PriceLine[]` (180 lines from owner decisions 2 and 5)
  - `proposePriceList(staffUser, { merchantId: string | null; lines: PriceLine[] }, idempotencyKey): Promise<{ id; status: 'pending' }>` (staff `admin`/`finance`; exactly the 180 combinations, each `shippingPiasters` a positive integer)
  - `approvePriceList(staffUser, priceListId): Promise<void>` (staff `admin`/`finance`; not the requester → else `second_person_required`; atomic `pending → active`; previous active of the same scope → `retired`)
  - `getShippingPiasters(merchantId: string, zoneCode, size, orderType): Promise<number>` (merchant's active list, else the default; no line → `AppError('price_missing')`)
  - `getActivePriceLines(merchantId: string): Promise<PriceLine[]>` (for the Pricing tab)

- [ ] **Step 1: Write the failing tests**
  - `buildSamplePriceLines()` has 180 lines; Small · Cairo & Giza · deliver = 6800; Heavy bulky · Red Sea & Sinai · exchange = (330 + 40 + 12) × 100 = 38200; return in Alexandria, Medium = (76 + 7 − 4) × 100 = 7900; cash collection, any size, Delta = (55 + 10) × 100 = 6500; pick_and_choose = deliver; sign_and_return = exchange.
  - seeded default: `getShippingPiasters(anyMerchant, 'cairo_giza', 'small', 'deliver') === 6800`.
  - merchant list wins over default after approval; a different merchant still gets the default.
  - proposal with 179 lines, a duplicate combination, or `0` → `invalid_input`; a merchant user proposing → `forbidden`.
  - approve by requester → `second_person_required`; by another finance user → active, old one `retired`, audit entry `price_list.approved`.
  - two different pending lists for one merchant approved at the same time → exactly one active afterwards (the other fails with `not_pending` or a conflict, never two active).
- [ ] **Step 2:** `pnpm test src/pricing/price-lists.test.ts` → FAIL.
- [ ] **Step 3:** Implement approval in one transaction: lock the scope's `ActivePriceList` row (`SELECT … FOR UPDATE`, inserting it if missing), move the list `pending → active` with an atomic `updateMany` on status, mark the previously pointed-to list `retired`, point the row at the new list, write the audit entry. A new proposal for a scope marks that scope's older pending proposal `replaced` (the Plan 1 review finding about stale requests). `getShippingPiasters` reads the merchant's pointer, else `'default'`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5: Commit** `git commit -m "Add versioned price lists with second-person approval"`

### Task 4: Fee quote for an order

**Files:**
- Create: `src/pricing/fee-quote.ts`, `src/pricing/fee-quote.test.ts`, `src/pricing/index.ts`

**Interfaces:**
- Consumes: `getArea` (Task 1), `getSettingValue` (Task 2), `getShippingPiasters` (Task 3), `addVatPiasters` (Plan 1)
- Produces:
  - `quoteOrderFees(input: { merchantId: string; areaId: string; size: PackageSize; orderType: OrderType; codAmountPiasters: number; allowOpenPackage: boolean; insuredValuePiasters: number }): Promise<FeeQuote>`
  - `type FeeQuote = { shippingPiasters; openPackagePiasters; codFeePiasters; insurancePiasters; netPiasters; vatPiasters; totalPiasters; zoneCode }`
  - `returnFeePiasters(shippingPiasters: number, returnFeeBasisPoints: number): number`

- [ ] **Step 1: Write the failing tests** (default settings, sample prices, a Nasr City area)
  - Small deliver, no COD, no open package → shipping 6800, others 0, net 6800, VAT 952, total 7752.
  - COD 500000 (EGP 5,000) → COD fee 2000 (1% of 200000, owner decision 4); COD 300000 → 0; COD 300001 → 0 (half-up of 0.01 piastre).
  - open package → 700; VAT is on the sum: net 6800 + 700 = 7500 → VAT 1050.
  - insurance 0 by default → 0; with `insurance_basis_points` set to 100 and insured value 1000000 → 10000.
  - `returnFeePiasters(6800, 5000) === 3400`; `returnFeePiasters(6801, 5000) === 3401` (half up).
  - area with `isServed = false` → `AppError('area_not_served')`; unknown area → `AppError('area_not_found')`; negative COD or insured value → `invalid_input`.
- [ ] **Step 2:** `pnpm test src/pricing/fee-quote.test.ts` → FAIL.
- [ ] **Step 3:** Implement; one rounding per line (half up, integer arithmetic as in `addVatPiasters`), VAT on `netPiasters`. Add `AppError` codes `area_not_served`, `area_not_found`, `price_missing` to both message files.
- [ ] **Step 4:** Same command → PASS; then `pnpm test` → all PASS.
- [ ] **Step 5: Commit** `git commit -m "Add order fee quote with VAT, COD, open package and insurance fees"`

### Task 5: Settings → Pricing tab

**Files:**
- Create: `src/app/[locale]/(portal)/settings/pricing-table.tsx` (client: zone chips and the VAT toggle), `e2e/pricing.spec.ts`
- Modify: `src/app/[locale]/(portal)/settings/[tab]/page.tsx` (render the tab), `settings-tabs.ts` (`pricing` needs `finance`; remove it from coming soon), `messages/en.json`, `messages/ar.json` (`settings.pricing.*`)

**Interfaces:**
- Consumes: `getActivePriceLines`, `getSettingValue`, merchant `cashOutSchedule`, `formatPiasters`

- [ ] **Step 1: Write the failing e2e test** `e2e/pricing.spec.ts`:
  - owner opens `/en/settings/pricing`: zone chips in mockup order; Cairo & Giza selected; Small row shows Deliver `68.00`, Exchange `80.00`, Return `64.00`, Cash collection `55.00`; clicking "Upper Egypt" shows Small Deliver `94.00`.
  - turning on "Include VAT" shows Small Deliver `77.52`.
  - side cards: cash-out schedule "Twice a week", "1% collection fee" with "Applies to cash above EGP 3,000 per order", open package fee "EGP 7".
  - the same page in Arabic (`/ar/settings/pricing`) shows `68.00` with Arabic labels and `dir="rtl"`.
  - a member with "Orders and pickups" access sees no Pricing tab and gets the no-access page by URL.
- [ ] **Step 2:** `pnpm test:e2e e2e/pricing.spec.ts` → FAIL.
- [ ] **Step 3:** Build the tab to match the mockup's Pricing layout (price card with chips and table on the left, three stat cards on the right; stacked under 860 px). Values come only from the database and settings; VAT toggle multiplies on screen using `vat_basis_points`.
- [ ] **Step 4:** `pnpm test:e2e` → all PASS; screenshots at 1440 and 375 px, Arabic and English, light and dark (`e2e/visual-capture.spec.ts` with `settings/pricing` added) compared with the mockup.
- [ ] **Step 5: Commit** `git commit -m "Add the merchant Pricing tab"`

### Task 6: Owner check

- [ ] The owner opens Settings → Pricing in Arabic and English, checks the sample prices and fee wording, and reads the Cairo and Giza area list in `prisma/seed-data/places.ts` (or a printed table of it) for missing or misspelled districts. Fixes are data edits in that file plus `pnpm db:seed`.
