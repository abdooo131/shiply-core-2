# Shiply Core 2.0

## What this system is
Shiply's own system for next-day parcel delivery in Egypt: merchants create orders and get paid, the
network picks up, sorts and delivers, couriers collect cash, customers track. Used by merchants, the
office team, hub staff, couriers and customers. If it fails, parcels and cash on delivery go missing.
Read `GOAL.md` first (the fixed end goal) and `PLAN.md` (the steps). Shiply Now is out of scope.

* Stack: TypeScript, Next.js 15 (App Router), React 19, Prisma 6, PostgreSQL 16 + PostGIS in Docker,
  next-intl (ar/en), zod, argon2, Vitest (real test DB), Playwright (uses installed Chrome).
* Main folders: `src/accounts` sign-in, sessions, access. `src/merchants` profile, team, payouts.
  `src/platform` audit log, idempotency. `src/shared` money, Cairo time, mobiles, db. `src/ui` brand
  shell and controls. `src/app/[locale]` pages. `messages/` Arabic and English text. `prisma/` schema,
  migrations, seed. `e2e/` browser tests. `shiply-merchant-portal.html`: the approved mockup.
* Domain terms: COD: cash on delivery. AWB: airway bill, the parcel label. RTO: return to origin.
  Cash cycle: the nightly close that books a day's cash and fees. Cash-out: payout to the merchant's
  bank. Hub safe: where couriers hand in cash. Sorting facility: inbound, sorting, outbound. Last-mile
  hub: receive, sort by zone, dispatch. Agent: outsourced courier company.

## Commands
* Install: `pnpm install` · Database: `pnpm db:up` (port 5434) · Seed: `pnpm db:seed`
* Dev server: `pnpm dev` (http://localhost:3000/ar)
* Tests: `pnpm test` · One file: `pnpm test src/accounts/sign-in.test.ts` · Browser: `pnpm test:e2e`
* Lint and types: `pnpm lint && pnpm typecheck` · Migration: `pnpm db:migrate --name <change>`

## Read before working in these areas
Load these only when the task touches them. Each is written when its area is built.
* Payments and COD settlement: docs/payments.md
* Couriers, Shopify, and other outside services: docs/integrations.md
* Background jobs and queues: docs/jobs.md
* Domain rules (returns, RTO, fees, rounding): docs/domain.md

## Priority when rules conflict
Non negotiable rules win, then Definition of done, then everything else.

## Non negotiable rules
1. Never do these without asking me first: delete data, run anything against production, deploy, force push, edit env files, change the database schema, add a dependency.
2. Never claim something works without running it and showing the output.
3. Find the root cause before fixing a bug. A guess fix hides the real problem.
4. After two failed attempts at the same problem, stop. Say what you tried, what you learned, and ask me.
5. Every endpoint checks who the caller is and whether they are allowed. Every webhook verifies its signature. Every external input is validated at the boundary.
6. Money is stored as integers in the smallest unit with the currency in the name (amountPiasters).
7. Anything that can run twice must be safe to run twice: webhooks, payments, order and shipment creation, background jobs, double clicks. Use idempotency keys or unique constraints.
8. Secrets live in environment variables only. Never hardcode or log them, and never log personal data.
9. Shiply only, no code from earlier versions (`../shiply`, `../shiplynow-finance`, `shiply-core/`, the `ShiplyNow` branch). Their docs may be read for a business rule, confirmed with me first.
10. Design first: every screen is a mockup I approve before it is built, and the built screen matches it. Behave like Bosta's merchant portal, look like Shiply; never use another company's colours, fonts, logo or style.

## Workflow by task size
When unsure, or when the change touches money, auth, or the schema, go one tier up.
* Small (one file, obvious change): just do it, then run lint and the relevant test.
* Medium (a feature inside one area): write a five line plan in the reply, use superpowers:test-driven-development, then superpowers:verification-before-completion.
* Large (new area, data model, payments, auth, many files): superpowers:brainstorming, then superpowers:writing-plans, then plan-reviews:plan-reviews before any code. Build in a worktree with superpowers:using-git-worktrees. Finish with superpowers:requesting-code-review.
* Any bug: superpowers:systematic-debugging.
* Any UI: design-html to build, design-qa:design-qa to check.
* Before a release: code-review-ship:code-review-ship including the security audit.

## Risky changes
For migrations, payment logic, and anything touching live data: state how to undo it before making it. If it can't be undone, say so and wait for my go ahead.

## Definition of done
* Tests pass, lint and typecheck are clean, no new warnings.
* New behavior has a test. Critical paths (order creation, order status, COD settlement, cash-out) have an integration test.
* Schema changes ship as a migration in the same change.
* Code you added or made unused in this change is cleaned up. Leave other old code alone.
* Screens: checked in the browser in Arabic and English, light and dark, laptop and phone.

## Testing
* Mock outside services. Never call live APIs in tests.
* Use a real test database, not a mocked one.
* Test behavior, not implementation details.

## Outside services and jobs
* Every outside call has a timeout, limited retries with backoff, and a defined behavior when the service is down.
* Two workers must never process the same record. Use locks or atomic status updates.

## Naming and structure
* Files and folders: kebab-case, for example `shiply-merchant-portal.html`, `cash-cycle-close.ts`.
* Organize by domain (orders, pickups, hubs, couriers, money) at the top level.
* A file name states exactly what is inside. Never utils, helpers, misc, common, or numbered copies.
* Tests sit next to the code they test.
* Functions are verbs, booleans read as questions (isPaid), units are in the name (weightKg, timeoutMs).

## Clarity
* A function does one thing. Return early instead of nesting. Named constants instead of magic values.
* Comments explain why, never what. Plain readable code over clever one liners.

## Data and performance
* Multi step writes go in a transaction.
* No queries inside loops. Lists are paginated. Lookup and filter columns get an index.
* Errors are handled explicitly and say what failed and what to do next.

## Always true here
* Currency is EGP. Times are stored in UTC and shown in Africa/Cairo.
* Text supports Arabic and English, including right to left layout.
* Brand: Shiply Brand Manual in `~/Downloads/Shiply` (Deep Navy #10243A, Electric Blue #174BFF, Lime #DFFF00 for highlights only, Creamy White #FFF8ED, Baby Blue #A5E8F5; Plus Jakarta Sans and IBM Plex Sans Arabic).

## Scope
* Smallest change that solves the problem. No refactors, renames, or reformatting outside the task.
* If you spot a real problem elsewhere, mention it in one line and leave it.
* If a wrong guess would cost real rework, ask one question. Otherwise pick the sensible default, say which, and continue.

## Token discipline
* Search first, then read only the lines you need. Do not read a file again that you already read this session.
* Run independent tool calls together.
* Replies: what changed, where, how it was verified, in plain language.
* Work in the main thread. Use subagents only for large, separable work, and require file paths and line numbers back.

## Keeping this file healthy
If I correct you on the same thing twice, propose one line to add here. Keep this file near 100 lines; move detail into docs.
