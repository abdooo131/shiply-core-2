# Plan 4: Orders List and Order Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Merchants find, filter and act on their orders like in Bosta: an Orders page with tabs, search, filter pills, sorting, saved views, paging and bulk actions; and an Order page with details, frozen fees, the tracking timeline, notes and the actions a merchant may take.

**Architecture:** `src/orders/order-list.ts` (one validated query object → paged results + tab counts, all filtering in SQL through Prisma, indexed), `src/orders/order-detail.ts`, `src/orders/saved-views.ts`, `src/orders/merchant-status.ts` (internal status → what the merchant sees). Screens under `src/app/[locale]/(portal)/orders/` (list) and `orders/[number]/` (order page). Filters live in the URL so a view can be shared and reloaded.

**Spec:** design §7.3 (`saved_views`), §8 (Orders: tabs, filter pills, saved views, bulk actions; Order page: details, tracking, notes). Look: mockup `V.orders` (~line 1080), `OTABS`, `PRESET_VIEWS`, filter pills, `V.order` (~line 1153). Standing approval of 18 Nov (own plans, schema changes, defaults).

## Decisions (Claude's calls, listed for the owner)

1. **What the merchant sees per status:** new → New; pickup_requested → Pickup requested; picked_up → Picked up; in_progress → In progress; out_for_delivery → Out for delivery; attempt_failed → Delivery attempt failed; awaiting_merchant_action → Awaiting your action; rescheduled → Rescheduled; delivered → Delivered; returning → Returning to you; returned → Returned; canceled → Canceled. Pill colours from the mockup `STATUS` map.
2. **Tabs:** All, Needs action (awaiting_merchant_action), New (new + pickup_requested), In progress (picked_up, in_progress, attempt_failed, rescheduled), Out for delivery, Coming back (returning), Delivered, Returned, Canceled, Not printed (no `LabelPrint`). Each shows its count.
3. **Filters (pills):** created date (today, last 7 days, last 30 days, any), governorate, order type, payment (cash to collect / no cash), attempts (none, 1–2, 3). The mockup's "payout" filter comes with Money (Plan 7).
4. **Search:** order number, customer name, mobile (any format), merchant reference.
5. **Sort:** last updated (default), newest, oldest, highest cash. **Paging:** 25 per page, page numbers.
6. **Saved views:** stored per user in a `SavedView` table (name, query), plus the mockup's presets (Cash to collect · Cairo & Giza; Tried 3 times; Created today).
7. **Bulk actions:** print labels (A6/A4), cancel (only orders a merchant may cancel; others reported), export to CSV (exceljs). "Request pickup" arrives with Pickups (Plan 5).
8. **Order page actions:** print label, cancel (if allowed), answer "Awaiting your action" (deliver again → in_progress, or return → returning, with a note), add a note, create an Exchange or Return from this order (opens Create order with the type and original number filled).
9. **Phone:** the table becomes order cards under 860 px.

## Global Constraints
Plans 1–3 constraints. Every list query is scoped to the user's merchant and paged; no query inside a loop; filter columns indexed (add `Order(merchantId, updatedAt)` and a trigram-free `Order(customerMobile)` index; name search uses `contains`, insensitive).

## Review Focus
1. **A filter or page number edited in the URL** (bad value, page past the end) → falls back safely, never a crash. Test in Task 1.
2. **Another merchant's order number typed in the URL** → not found. Test in Task 2.
3. **Bulk cancel of a mix of cancellable and not cancellable orders** → the allowed ones cancel, the rest are listed with the reason. Test in Task 3.
4. **Arabic search** ("منى") and mobile in any format find the order. Test in Task 1.
5. **Counts per tab match the list** after filters are applied. Test in Task 1.

---

### Task 1: Order list query
**Files:** `src/orders/merchant-status.ts`, `src/orders/order-list.ts` (+tests), schema index migration.
**Produces:** `ORDER_TABS`, `merchantStatusOf(status)`; `parseOrderListQuery(searchParams): OrderListQuery` (zod, defaults, never throws); `listOrders(user, merchantId, query): Promise<{ orders: OrderListRow[]; total; page; pageCount; tabCounts: Record<OrderTab, number> }>`.
- [ ] Tests: each tab returns the right statuses; each filter; search by number, Arabic name, mobile in 3 formats, reference; sort orders; page 2 of 30 orders has 5; page 99 → last page; garbage params → defaults; tab counts respect filters and search; another merchant's orders never appear; finance-only → forbidden.
- [ ] Watch fail → implement → pass → commit.

### Task 2: Order page data and merchant actions
**Files:** `src/orders/order-detail.ts`, `src/orders/merchant-order-actions.ts` (+tests).
**Produces:** `getOrderDetail(user, merchantId, number)` (order, items, frozen fees, area, linked orders, timeline, label printed?, allowed merchant actions); `cancelOrders(user, merchantId, orderIds): { canceled: string[]; refused: { number; reason }[] }`; `answerAwaitingAction(user, merchantId, orderId, choice: 'deliver_again' | 'return', note)`.
- [ ] Tests: detail for own order; other merchant's number → not_found; allowed actions per status; bulk cancel mix; answer awaiting → status and note in timeline.
- [ ] Watch fail → implement (reuse `changeOrderStatus`) → pass → commit.

### Task 3: Saved views and CSV export
**Files:** `SavedView` model + migration, `src/orders/saved-views.ts`, `src/orders/order-export.ts` (+tests).
- [ ] Tests: save/list/delete own views only; names 1–40 chars; max 20 per user; export of the current filter returns CSV with Arabic intact (UTF-8 BOM), no more than 5,000 rows.
- [ ] Watch fail → implement → pass → commit.

### Task 4: Orders page
**Files:** `src/app/[locale]/(portal)/orders/page.tsx` + client pieces (tabs, search, filter pills, saved views menu, bulk bar, table / phone cards, pager), messages, `e2e/orders-list.spec.ts`; remove `orders` from coming soon.
- [ ] e2e (Arabic and English): tabs with counts; search Arabic name; a filter pill narrows the list and appears in the URL; save a view and re-apply it; select two orders → print labels opens the label page with both; bulk cancel; phone width shows cards without sideways scroll.
- [ ] Build to match the mockup; screenshots 1440/375, ar/en, light/dark → commit.

### Task 5: Order page
**Files:** `src/app/[locale]/(portal)/orders/[number]/page.tsx` + actions, messages, `e2e/order-page.spec.ts`.
- [ ] e2e: details and fee breakdown match the stored order; timeline shows created; add a note; cancel a new order; "Create exchange" opens Create order with type and number filled; other merchant's number → 404.
- [ ] Build to match the mockup; screenshots → commit.

### Finish
- [ ] Whole-plan review; fix findings test-first; merge to main and push.
