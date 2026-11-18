# Plan 3: Creating Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A merchant creates real orders of all six types (one by one or from a spreadsheet), each priced with fees frozen at creation, with a 10-digit order number, a timeline, a status that only moves along allowed paths, and a printable airway bill (AWB) label with a scannable barcode.

**Architecture:** New `src/orders` domain (customers, products, orders, status rules, timeline, labels, bulk upload) on the Plan 1–2 pattern: access-checked functions, audit, idempotency, tests against the real test DB. Fees come from `quoteOrderFees` (Plan 2) and are stored on the order; they never change after creation. Screens: Create order, bulk upload, Products, and the label print page.

**Tech Stack:** As before, plus `bwip-js` (barcodes) and `exceljs` (spreadsheets), approved by the owner on 18 Nov 2026.

**Spec:** `docs/superpowers/specs/2026-11-18-first-version-design.md` §7.3 Orders, §8 screens, §9 testing, §10. Look: `shiply-merchant-portal.html` `V.create` / `bindCreate` (~line 1223), `bulkModal`, Products page, label print options. Business rules: `GOAL.md` §6. Approvals: standing approval of 18 Nov (own plans, schema changes, defaults; see memory `feedback-run-continuously`).

## Decisions (Claude's calls under the standing approval; listed for the owner)

1. **Labels are a print-ready page** (`/[locale]/orders/labels?ids=…&format=a6|a4`) with a Code 128 barcode drawn by bwip-js as SVG; the browser prints or saves it as PDF. The spec said "PDF generated on the server", which needs a PDF package not approved; the printed result is the same.
2. **Products page (basic)** comes now because Pick & Choose needs products: list, add, edit, turn on/off. Analytics on products stay in Plan 8.
3. **Size for Cash collection and Sign & Return** is priced as `small` (no parcel / documents only).
4. **Pick & Choose** always allows opening the package (the customer must see the items) and takes 1 to 3 products.
5. **Return**: the amount field is a refund paid to the customer, never collected; it is stored as `refundPiasters`, and `codAmountPiasters` is 0. **Cash collection** has a direction: collect from or give to the customer.
6. **Deposit**: a yes/no "ask for a deposit first" flag on the order (amount agreed by the merchant's call centre), as in the mockup.
7. **Return location**: the merchant's default pickup location; the seed gives Eve Chantelle one in Nasr City. Managing locations comes with Pickups (Plan 5).
8. **Order numbers**: 10 random digits, first digit not 0, unique (retry on clash).
9. **Status rules** (spec list): `new → pickup_requested | picked_up | canceled`; `pickup_requested → picked_up | new | canceled`; `picked_up → in_progress`; `in_progress → out_for_delivery | awaiting_merchant_action | returning`; `out_for_delivery → delivered | attempt_failed`; `attempt_failed → out_for_delivery | rescheduled | awaiting_merchant_action | returning`; `rescheduled → out_for_delivery`; `awaiting_merchant_action → in_progress | returning`; `returning → returned`. `delivered`, `returned`, `canceled` are final. After 3 failed attempts the only way on is `returning`. Merchants may only cancel (`new`, `pickup_requested`) and answer `awaiting_merchant_action`; Shiply staff do the rest.
10. **Bulk upload**: `.xlsx` or `.csv`, up to 500 rows, one template with Arabic and English headers; valid rows become orders, invalid rows come back with the reason per row; re-uploading the same file creates nothing twice (row idempotency key = file hash + row number).

## Global Constraints

- Everything in Plans 1–2 Global Constraints (money in piastres, UTC, all text in `messages/*.json`, brand tokens, kebab-case, tests beside code, real test DB, Arabic and English with RTL).
- Fees on an order are frozen at creation: `shippingPiasters`, `openPackagePiasters`, `codFeePiasters`, `insurancePiasters`, `vatPiasters`, `totalFeePiasters`.
- Customer mobiles are stored normalized (`+201…`) and never logged; audit entries hold ids, not names or phones.
- Every order write is idempotent (client key) and every status change goes through `changeOrderStatus`.

## Review Focus

1. **Double click on Create order** → one order (idempotency key from the form). Test in Task 2.
2. **Two staff moving the same order at once** → one change wins, the other is refused (atomic status update). Test in Task 3.
3. **Arabic customer names and addresses** saved and printed on the label unchanged, right to left. Test in Tasks 2 and 4.
4. **A spreadsheet with mixed good and bad rows, uploaded twice** → good rows created once, bad rows reported with reasons. Test in Task 6.
5. **An order for an area not served or without a price** → refused with the message, never created at a guessed price. Test in Task 2.

---

### Task 1: Order data, numbers and customers

**Files:** `prisma/schema.prisma` (enums `OrderStatus`, `CashDirection`, `LabelFormat`; models `Customer`, `Product`, `Order`, `OrderItem`, `OrderLink`, `OrderEvent`, `LabelPrint`, `BulkUpload`), migration `<ts>_orders` plus a hand-written trigger migration making `OrderEvent` append-only (undo: drop the tables, enums, trigger); `src/orders/order-number.ts`, `src/orders/customers.ts` with tests; seed: Eve Chantelle default pickup location in Nasr City and three sample products.
**Produces:** `generateOrderNumber(): string` (10 digits, first not 0); `findCustomerByMobile(user, merchantId, mobile): Promise<{ name; addressText; areaId; orderCount } | null>` (needs `orders`); `Order` columns per spec §7.3 incl. `number` unique, `merchantId`, `type`, `status` default `new`, `customerId`, `customerName`, `customerMobile`, `addressText`, `addressExtra`, `areaId`, `size`, `description`, `codAmountPiasters`, `refundPiasters`, `cashDirection`, `allowOpenPackage`, `depositRequired`, `insuredValuePiasters`, frozen fee columns, `merchantReference`, `courierNote`, `returnLocationId`, `attempts` default 0, `expectedDeliveryDate`, `createdBy`, timestamps; indexes `(merchantId, status, createdAt)`, `(merchantId, createdAt)`, `areaId`, unique `(merchantId, idempotency)` not needed (runOnce).
- [ ] Tests: number is 10 digits, never starts with 0, 1,000 generated are unique; `OrderEvent` UPDATE/DELETE fail with `append_only`; customer lookup finds a past customer by `01001234567` or `+20 100 123 4567`, is scoped to the merchant, refuses `finance`-only access.
- [ ] Watch fail → implement → pass → commit `Add order data, order numbers and customer lookup`.

### Task 2: Create an order (all six types)

**Files:** `src/orders/create-order.ts`, `src/orders/order-input.ts` (zod schemas per type), `src/orders/products.ts`, tests beside each, `src/orders/index.ts`.
**Consumes:** `quoteOrderFees`, `getArea`, `normalizeEgyptianMobile`, `runOnce`, `writeAudit`, `requireMerchantAccess(…, 'orders')`.
**Produces:** `createOrder(user, merchantId, input: CreateOrderInput, idempotencyKey): Promise<{ id; number }>`; `CreateOrderInput` discriminated by `type`; `listProducts`, `saveProduct`, `setProductActive` (need `orders`).
- [ ] Tests: each type creates with the right fields and frozen fees (Small Nasr City deliver total 7752); Pick & Choose with 0 or 4 products → `invalid_input`, forces open package; Cash collection needs amount > 0 and a direction; Return stores refund and COD 0; exchange/return may link an original order of the same merchant by number (another merchant's number → `not_found`); unknown or unserved area → `area_not_found` / `area_not_served`; bad mobile → `invalid_mobile`; same key twice → one order; Arabic name and address round-trip; customer is created or updated; timeline gets `created`; `finance`-only member → `forbidden`.
- [ ] Watch fail → implement (one transaction: customer upsert, order, items, link, event, audit) → pass → commit `Create orders of all six types with frozen fees`.

### Task 3: Status changes and timeline

**Files:** `src/orders/order-status.ts`, test.
**Produces:** `ORDER_STATUS_TRANSITIONS`; `changeOrderStatus(actor: SessionUser, orderId, to: OrderStatus, details?: { reason?: string; note?: string }): Promise<void>`; `addOrderNote(actor, orderId, note)`; `getOrderTimeline(user, orderId)`.
- [ ] Tests: every allowed change works and writes an event with who/when/why; a change not in the list → `invalid_transition`; merchant may cancel `new`/`pickup_requested` only; merchant may move `awaiting_merchant_action → in_progress | returning` only; third failed attempt blocks `out_for_delivery`; attempts counted on `attempt_failed`; two staff changing the same order at once → one wins, the other gets `invalid_transition` (atomic `updateMany` on current status); notes are append-only events.
- [ ] Watch fail → implement → pass → commit `Add order status rules and timeline`.

### Task 4: Airway bill labels

**Files:** `src/orders/labels.ts` (+test), `src/app/[locale]/orders/labels/page.tsx` (outside the portal shell, print CSS), `src/orders/barcode.ts` (+test).
**Produces:** `barcodeSvg(orderNumber): string` (Code 128 via bwip-js `toSVG`); `recordLabelPrint(user, orderIds, format)`; label shows order number + barcode, merchant name, customer name, mobile, address and area (Arabic as entered), COD amount, size, type, courier note, Shiply logo; A6 one per page, A4 two per page.
- [ ] Tests: SVG contains a `<svg`; label page for an order of another merchant → 404; printing records one `LabelPrint` per order; Arabic address appears in the HTML unchanged.
- [ ] Watch fail → implement → pass → commit `Add printable AWB labels with barcodes`.

### Task 5: Products page and Create order screen

**Files:** `src/app/[locale]/(portal)/products/page.tsx` (+forms), `src/app/[locale]/(portal)/orders/new/page.tsx` + client form + server actions (`quoteAction`, `createOrderAction`), `src/app/api/areas/route.ts` (signed-in only, uses `searchAreas`), messages, nav: Create order button and tab-bar "+" go to `/orders/new`; `e2e/create-order.spec.ts`.
- [ ] e2e: in Arabic and English, create one order of each type; the summary shows Shipping, VAT 14%, Shiply fee and "You receive after delivery" with the quote's numbers; area search by Arabic spelling; returning customer offer by mobile; "Create and add another" keeps the type; errors shown per field; after creating, "Print label" opens the label page.
- [ ] Build to match the mockup (type cards, three numbered cards, sticky summary; stacked on phone). Watch fail → implement → pass; screenshots 1440/375, ar/en, light/dark → commit `Add Create order and Products screens`.

### Task 6: Bulk upload

**Files:** `src/orders/bulk-upload.ts` (+test with fixture files), template download route, upload modal on the Create order page, messages, `e2e/bulk-upload.spec.ts`.
**Produces:** `parseOrderSheet(buffer, fileName): ParsedRow[]`; `importOrderSheet(user, merchantId, buffer, fileName): Promise<{ uploadId; created; failed: { row; errors }[] }>`.
- [ ] Tests: .xlsx and .csv both parse; Arabic and English headers; 501 rows → refused; mixed rows → good ones created, bad ones with reasons; same file twice → nothing created the second time; each created order is priced like a manual one.
- [ ] Watch fail → implement → pass → commit `Add bulk order upload from Excel or CSV`.

### Finish
- [ ] Whole-plan self-review against this plan and the spec; fix findings test-first; merge to main and push (standing approval).
