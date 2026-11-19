# Plan 6: Staff Area Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Shiply's own team can run the network from the app: move orders through their statuses, collect pickups, approve bank and price changes, close cash cycles and pay cash-outs, and answer support tickets. Without this, nothing a merchant creates can reach "delivered" outside tests.

**Spec:** design §6 (staff), the owner's answer of 19 Nov: "Start building directly", meaning a plain internal stand-in in the Shiply style, to be replaced when a staff mockup is approved. Standing approval of 18 Nov covers the plan, the local schema change and merge/push.

## Decisions (Claude's calls)
1. **Where:** `/[locale]/staff/*`, its own simple layout (Shiply navy sidebar, same tokens and controls as the merchant portal). Any staff role may open it; each screen and action checks the role the domain function already requires (orders and pickups: admin, operations; approvals and money: admin, finance; support: admin, operations, finance). A non-staff user gets "not found".
2. **Sign-in:** a user with a staff role and no merchant membership lands on `/staff` (from the merchant Home redirect). Staff with a membership keep the merchant Home, plus a "Staff area" link in the top bar.
3. **Screens:** Overview (queue counts), Orders (status tabs, search by number, next-status buttons with a reason for a failed attempt), Pickups (scheduled pickups with their orders, tick the collected ones), Approvals (pending bank accounts and price lists), Money (close a day's cash cycles, prepare cash-outs for a date, approve / mark paid with bank reference / cancel), Support (open and answered tickets, thread, reply).
4. **Logic:** new `src/staff/staff-queues.ts` holds only the cross-merchant reads; every write reuses the existing tested function. `nextStatusesFor(status, attempts)` is exported from `order-status.ts` so the screen shows only moves the server will accept.
5. **Schema:** add `@@index([status, updatedAt])` on Order (staff list filters by status across merchants). Undo: a migration dropping the index.

## Review Focus
1. A merchant-only user opening `/staff` → not found; an operations user calling a finance action → refused.
2. Approving your own request (bank, price list, cash-out you prepared) → "a second person must approve" message, not a crash.
3. Double click on a status button → one change; the second shows "already changed".
4. Lists are paginated or capped; no query inside a loop.
5. Arabic and English, light and dark, phone width without sideways scroll.

### Task 1: staff queries + `nextStatusesFor` + index migration (tests first)
### Task 2: staff layout, access guard, sign-in landing, Overview and Orders screens
### Task 3: Pickups, Approvals, Money, Support screens
### Task 4: e2e: staff delivers an order end to end and the merchant's wallet shows the money; full suite; merge to main.
