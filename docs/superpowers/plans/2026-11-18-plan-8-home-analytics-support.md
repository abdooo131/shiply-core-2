# Plan 8: Home, Analytics and Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The merchant's Home shows today's summary and what needs their action on real data; Analytics shows delivery and money performance over a period (calm, Bosta-like); Support lets merchants open tickets and follow replies. Ends with a full test day across every screen.

**Spec:** design §8 (Home, Analytics, Support), §9. Look: mockup `V.home` (~line 942), `chatPanel` (~912), `V.analytics` (~1631), `V.support` (~1701), `ticketModal`. Standing approval of 18 Nov.

## Decisions (Claude's calls)
1. **Home:** greeting by Cairo time of day with the merchant's name; "Today:" headline (created, picked up, delivered today); Needs your action (orders awaiting the merchant, answerable inline: deliver again / return, using `answerAwaitingAction`); deliveries chart for the last 14 Cairo days; cash collected this cycle (today's processing); next cash-out (date + amount); expected from active orders (COD of orders not yet final); Grow with Shiply card (static links).
2. **Analytics:** period 7 / 30 / 90 days (default 30), Cairo days. Delivery success rate = delivered ÷ (delivered + returned); average delivery time = picked up → delivered; attempts (share delivered on 1st / 2nd / 3rd try); reasons orders were not delivered (from `attempt_failed` event reasons); by governorate (orders, delivered %); cash collected and fees per day (ledger); cash-outs in the period. All computed with grouped queries, no per-order loops.
3. **Support:** tickets with topic (order, pickup, payment, account, other), optional order number (must be the merchant's), subject, first message; list (open / closed), thread with replies; merchant can reply and close; staff replies come from the staff area (Plan 6). Ticket number `T` + 6 digits. The chat button in the corner opens "New ticket".

## Review Focus
1. Empty data (new merchant) → every card shows a calm empty state, never NaN or errors.
2. Period boundaries in Cairo time.
3. Another merchant's ticket or order number → not found.
4. Arabic text in tickets round-trips.
5. Phone width: no sideways scrolling on Home, Analytics, Support.

### Task 1: Home (logic `src/home/home-summary.ts` + tests; screen replaces the welcome page)
### Task 2: Analytics (logic `src/analytics/*.ts` + tests; screen)
### Task 3: Support (`src/support/tickets.ts` + tests; screen + corner chat button)
### Task 4: Full test day — every e2e spec, every screen at 1440/375, ar/en, light/dark; fix what's found; merge to main.
