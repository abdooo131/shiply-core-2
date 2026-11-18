# Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running Shiply app on the owner's Mac: real database, Arabic and English with right to left, the Shiply brand shell from the mockup, sign-in, and working merchant settings (profile, business, team, payout bank account).

**Architecture:** One Next.js (App Router) app at the repository root. Domain folders under `src/` own their data and expose a small public interface (`index.ts`); screens call those interfaces through server actions. PostgreSQL 16 with PostGIS runs in Docker; Prisma owns the schema and migrations; append-only tables are enforced by database triggers.

**Tech Stack:** Node 22, pnpm 10, TypeScript (strict), Next.js 15, React 19, Prisma 6, PostgreSQL 16 + PostGIS 3.4 (`postgis/postgis:16-3.4` image), next-intl, zod, @node-rs/argon2, Vitest, Playwright, ESLint.

**Spec:** `docs/superpowers/specs/2026-11-18-first-version-design.md` (sections 5, 6, 7.1, 7.5 audit and idempotency, 8 Settings). Rules: `CLAUDE.md`. Look: `shiply-merchant-portal.html`.

## Plan sequence (each its own plan, written when the previous one is done)

1. **Foundation** (this plan)
2. Places and prices: governorates, areas, pricing zones, price lists with approval, settings values, fee calculation
3. Orders: create (six types, bulk upload), statuses and timeline, labels with barcodes
4. Orders list and order page: tabs, filter pills, saved views, bulk actions, details and tracking
5. Pickups
6. Staff stand-in screen: move orders along
7. Money: ledger, nightly cash cycle, wallet, cash-outs with approval, proof of transfer
8. Home, analytics, products, support chat on real data; full test day

## Global Constraints

- Node 22, pnpm 10, TypeScript `strict: true`. Dependencies are only those listed in this plan; any other needs the owner's OK first (`CLAUDE.md` rule 1).
- Money: integers in piastres, column and variable names end in `Piasters` (e.g. `codAmountPiasters`). Never floats.
- Time: stored in UTC, shown in `Africa/Cairo`.
- Every visible string comes from `messages/en.json` and `messages/ar.json`. Arabic pages have `dir="rtl"` and use IBM Plex Sans Arabic; English uses Plus Jakarta Sans.
- Brand tokens copied exactly from the mockup's `:root` (lines 16 onward of `shiply-merchant-portal.html`): Deep Navy `#10243A`, Electric Blue `#174BFF`, Lime `#DFFF00`, Creamy White `#FFF8ED`, Baby Blue `#A5E8F5`, plus its surface, line, text and status tokens and the dark theme values.
- No UI component library. No code copied from earlier Shiply versions.
- Every server action and route checks the signed-in user and their access. Every write that a double click could repeat uses an idempotency key.
- `audit_log` and `idempotency_keys` are append-only (database triggers refuse UPDATE and DELETE on `audit_log`).
- Secrets only in `.env` (git-ignored); `.env.example` lists every key without values.
- Egyptian mobiles: accept `01x xxxx xxxx`, `+201x…`, `00201x…` with or without spaces; store as `+201` followed by 9 digits; only prefixes 010, 011, 012, 015.

## Review Focus

1. **Phone written differently**: `01001234567`, `+20 100 123 4567` and `00201001234567` sign in to the same account; `0100123` is refused with a clear message. Test in Task 2 (`normalizeEgyptianMobile`) and Task 4 (sign-in by mobile).
2. **Double submit**: pressing Save or Invite twice creates one record. Test in Task 6 (invite twice with the same idempotency key → one user).
3. **Wrong access level**: a member with "orders and pickups" access opening Payouts or Team gets refused by the server (not just hidden). Test in Task 6.
4. **Arabic text in, Arabic text out**: business name "نايل ثريدز" and mixed "Nile ثريدز" are saved and shown unchanged, right to left. Test in Task 6 (profile round trip) and Task 5 (e2e in Arabic).
5. **Old sessions after a password change**: changing the password signs out every other device. Test in Task 4.

---

## File Structure

```
package.json, pnpm-lock.yaml, tsconfig.json, next.config.ts, eslint.config.mjs,
vitest.config.ts, playwright.config.ts, docker-compose.yml, .env.example, middleware.ts
messages/en.json, messages/ar.json                 all visible text
prisma/schema.prisma                               the database
prisma/migrations/                                  generated, plus raw SQL for triggers
prisma/seed.ts                                      governorates, Eve Chantelle, dev users
src/shared/money.ts                                 piastres helpers, VAT on top
src/shared/cairo-time.ts                            Cairo day start/end, formatting
src/shared/egyptian-mobile.ts                       normalise and validate mobiles
src/shared/db.ts                                    one Prisma client
src/shared/app-error.ts                             typed errors with a code and a message key
src/platform/audit-log.ts                           write an audit entry
src/platform/idempotency.ts                         run a write once per key
src/accounts/password.ts                            hash and verify (argon2id)
src/accounts/sessions.ts                            create, read, revoke sessions
src/accounts/sign-in.ts                             sign in by email or mobile, lockout
src/accounts/access.ts                              current user, merchant access checks
src/accounts/index.ts                               public interface of accounts
src/merchants/merchant-profile.ts                   read and update profile and business
src/merchants/team.ts                               list, invite, change access, deactivate
src/merchants/bank-account.ts                       request a change, approve by a second person
src/merchants/index.ts                              public interface of merchants
src/i18n/routing.ts, src/i18n/request.ts            next-intl setup (/en, /ar)
src/ui/tokens.css                                   brand tokens and dark theme
src/ui/shell/sidebar.tsx, top-bar.tsx, language-switch.tsx, theme-switch.tsx
src/ui/button.tsx, card.tsx, pill.tsx, field.tsx, toast.tsx
src/app/[locale]/layout.tsx                         fonts, dir, theme
src/app/[locale]/login/page.tsx                     sign-in screen
src/app/[locale]/(portal)/layout.tsx                portal shell (sidebar, top bar)
src/app/[locale]/(portal)/page.tsx                  Home placeholder ("Your orders will appear here")
src/app/[locale]/(portal)/settings/[tab]/page.tsx   preferences, profile, business, team, payouts
e2e/sign-in.spec.ts, e2e/settings.spec.ts
```

Tests sit next to code: `src/shared/money.test.ts`, `src/accounts/sign-in.test.ts`, etc.

---

### Task 1: Project setup

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `docker-compose.yml`, `.env.example`, `prisma/schema.prisma` (datasource and generator only), `src/shared/db.ts`, `src/app/[locale]/layout.tsx`, `src/app/[locale]/page.tsx` (temporary "Shiply" heading), `src/shared/db.test.ts`
- Modify: `.gitignore` (add `.next/`, `playwright-report/`, `test-results/`)

**Interfaces:**
- Produces: `db: PrismaClient` from `src/shared/db.ts`; scripts `pnpm dev`, `pnpm test`, `pnpm test:e2e`, `pnpm lint`, `pnpm typecheck`, `pnpm db:up`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:test:reset`.

- [ ] **Step 1:** Create the files above. `docker-compose.yml` runs `postgis/postgis:16-3.4` on port 5432 with a `shiply` database and a `shiply_test` database (init script). `.env.example` keys: `DATABASE_URL`, `DATABASE_URL_TEST`, `SESSION_SECRET`, `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD`, `SEED_STAFF_EMAIL`, `SEED_STAFF_PASSWORD`.
- [ ] **Step 2: Write the failing test** `src/shared/db.test.ts`: `it('connects to the test database and has PostGIS', …)` runs `SELECT postgis_version()` through `db` and expects a string starting with `3.`.
- [ ] **Step 3:** Run `pnpm db:up && pnpm test src/shared/db.test.ts`. Expected: FAIL until the Prisma client is generated, then PASS after `pnpm prisma generate`.
- [ ] **Step 4: Verify the toolchain** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm dev` and open `http://localhost:3000/en`. Expected: all clean, page shows "Shiply".
- [ ] **Step 5: Commit** `git commit -m "Set up Next.js, Postgres with PostGIS, tests and lint"`

### Task 2: Shared helpers (money, Cairo time, Egyptian mobiles)

**Files:**
- Create: `src/shared/money.ts`, `src/shared/cairo-time.ts`, `src/shared/egyptian-mobile.ts`, `src/shared/app-error.ts` and a `.test.ts` beside each of the first three

**Interfaces:**
- Produces:
  - `parseEgpToPiasters(input: string): number` (accepts `"1,234.5"`, `"١٢٣"` Arabic digits; throws `AppError('invalid_amount')`)
  - `formatPiasters(amountPiasters: number, locale: 'en'|'ar'): string` → `"EGP 1,234.50"` / `"1,234.50 ج.م"`
  - `addVatPiasters(netPiasters: number, vatBasisPoints: number): { netPiasters; vatPiasters; grossPiasters }` (half up to the piastre)
  - `cairoDayStartUtc(date: Date): Date`, `cairoDayEndUtc(date: Date): Date`, `formatCairo(date: Date, locale, style: 'date'|'dateTime'|'time'): string`
  - `normalizeEgyptianMobile(input: string): string` → `"+201001234567"`; throws `AppError('invalid_mobile')`
  - `class AppError extends Error { code: string; messageKey: string; status: number }`

- [ ] **Step 1: Write the failing tests**
  - `addVatPiasters(6800, 1400)` → `{ netPiasters: 6800, vatPiasters: 952, grossPiasters: 7752 }`
  - `addVatPiasters(1, 1400)` → `vatPiasters: 0`; `addVatPiasters(4, 1400)` → `vatPiasters: 1` (0.56 rounds half up)
  - `parseEgpToPiasters('1,234.5')` → `123450`; `parseEgpToPiasters('١٢٣')` → `12300`; `parseEgpToPiasters('1.234')` throws `invalid_amount` (more than 2 decimals)
  - `normalizeEgyptianMobile` for `'01001234567'`, `'+20 100 123 4567'`, `'00201001234567'` → `'+201001234567'`; `'0100123'` and `'01301234567'` throw `invalid_mobile`
  - `cairoDayStartUtc(new Date('2026-11-18T01:00:00Z'))` → `2026-11-17T22:00:00.000Z` (Cairo is UTC+2 in November)
- [ ] **Step 2:** Run `pnpm test src/shared`. Expected: FAIL (functions missing).
- [ ] **Step 3:** Implement the signatures above. Use `Intl.DateTimeFormat` with `timeZone: 'Africa/Cairo'` for Cairo time (no fixed offset); `ar` formatting uses Latin digits (`numberingSystem: 'latn'`).
- [ ] **Step 4:** Run `pnpm test src/shared`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add money, Cairo time and Egyptian mobile helpers"`

### Task 3: Base database schema and seed

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration `prisma/migrations/<timestamp>_foundation/migration.sql` (generated) plus `prisma/migrations/<timestamp>_append_only/migration.sql` (hand-written triggers), `prisma/seed.ts`, `src/platform/audit-log.ts`, `src/platform/idempotency.ts`, `src/platform/audit-log.test.ts`, `src/platform/idempotency.test.ts`, `src/shared/test-db.ts`

**Interfaces:**
- Produces tables (Prisma models): `User` (id, email unique nullable, mobile unique nullable, name, passwordHash, language `en|ar`, status `active|disabled`, failedSignIns, lockedUntil), `Session` (id, userId, tokenHash unique, expiresAt, revokedAt, userAgent), `StaffRole` (userId, role `admin|operations|finance`), `Merchant` (id, nameEn, nameAr, industry, website, logoUrl, status, cashOutSchedule `weekly|twice_weekly|daily` default `twice_weekly`), `MerchantMember` (merchantId, userId, access `full|orders_pickups|finance`, status), `PickupLocation` (merchantId, label, addressText, areaId nullable for now, isDefault), `BankAccount` (merchantId, bankName, holderName, ibanLast4, ibanEncrypted, status `pending|active|replaced`, requestedBy, approvedBy), `Governorate` (code, nameEn, nameAr), `Setting` (key, scope `global|merchant:<id>`, valueJson), `AuditLog` (append-only: actorUserId, action, entityType, entityId, beforeJson, afterJson, at), `IdempotencyKey` (key unique, scope, resultJson, createdAt)
  - `writeAudit(tx, { actorUserId, action, entityType, entityId, before, after }): Promise<void>`
  - `runOnce<T>(key: string, scope: string, work: (tx) => Promise<T>): Promise<T>` (second call with same key and scope returns the first result without running `work`)
  - `resetTestDatabase(): Promise<void>` in `src/shared/test-db.ts` (truncates everything except seed reference data)

- [ ] **Step 1: Write the failing tests**
  - `audit-log.test.ts`: after `writeAudit`, raw `UPDATE "AuditLog" …` and `DELETE FROM "AuditLog"` both throw (trigger message `append_only`).
  - `idempotency.test.ts`: `runOnce('k1','test', work)` twice calls `work` once and returns the same value both times; two concurrent calls with the same key also call `work` once.
  - `seed` test: running `pnpm db:seed` twice leaves exactly 27 governorates, 1 merchant "Eve Chantelle", 1 owner user, 1 staff admin user.
- [ ] **Step 2:** Run `pnpm test src/platform`. Expected: FAIL.
- [ ] **Step 3:** Write the models, run `pnpm db:migrate --name foundation`, add the trigger migration, implement `writeAudit`, `runOnce` (unique key insert inside the same transaction as the work; a conflict waits and returns the stored result), and the seed (creates only missing rows; passwords from `SEED_*` env keys; refuses to run when `NODE_ENV=production`).
- [ ] **Step 4:** Run `pnpm test src/platform && pnpm db:seed && pnpm db:seed`. Expected: PASS, seed counts unchanged on the second run.
- [ ] **Step 5: Commit** `git commit -m "Add base schema, append-only audit log, idempotency and seed"`

### Task 4: Sign-in, sessions and access

**Files:**
- Create: `src/accounts/password.ts`, `sessions.ts`, `sign-in.ts`, `access.ts`, `index.ts` and tests `sign-in.test.ts`, `sessions.test.ts`, `access.test.ts`

**Interfaces:**
- Consumes: `normalizeEgyptianMobile`, `AppError`, `db`, `writeAudit`
- Produces:
  - `hashPassword(plain: string): Promise<string>`, `verifyPassword(hash: string, plain: string): Promise<boolean>` (argon2id)
  - `signIn(identifier: string, password: string, userAgent: string): Promise<{ sessionToken: string; user: SessionUser }>`; throws `AppError('invalid_credentials')` or `AppError('account_locked')`
  - `getSessionUser(sessionToken: string): Promise<SessionUser | null>`; `revokeSession(sessionToken)`; `changePassword(userId, current, next)` (revokes all other sessions)
  - `type SessionUser = { id: string; name: string; language: 'en'|'ar'; staffRoles: string[]; memberships: { merchantId: string; access: 'full'|'orders_pickups'|'finance' }[] }`
  - `requireUser(): Promise<SessionUser>` (reads the `shiply_session` cookie; redirects to `/<locale>/login`)
  - `requireMerchantAccess(user, merchantId, need: 'orders'|'finance'|'team'): void` (`full` passes all; `orders_pickups` passes `orders`; `finance` passes `finance`; else `AppError('forbidden', 403)`)

- [ ] **Step 1: Write the failing tests**
  - sign in with email, with `01001234567`, and with `+20 100 123 4567` → same user id
  - wrong password 5 times within 15 minutes → 6th attempt (even with the right password) throws `account_locked`; after `lockedUntil` passes it works
  - session token is random (32 bytes), only its SHA-256 hash is stored; expired or revoked token → `getSessionUser` returns `null`
  - `changePassword` → the user's other sessions return `null`, the current one still works
  - `requireMerchantAccess` with `orders_pickups` and need `finance` → throws `forbidden`
- [ ] **Step 2:** Run `pnpm test src/accounts`. Expected: FAIL.
- [ ] **Step 3:** Implement the signatures. Session lifetime 30 days, cookie `shiply_session`, `httpOnly`, `secure` outside development, `sameSite: 'lax'`. Every sign-in and failure writes an audit entry without the password or full phone.
- [ ] **Step 4:** Run `pnpm test src/accounts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add sign-in by email or mobile, sessions, lockout and access checks"`

### Task 5: Arabic and English, brand shell and sign-in screen

**Files:**
- Create: `messages/en.json`, `messages/ar.json`, `src/i18n/routing.ts`, `src/i18n/request.ts`, `middleware.ts`, `src/ui/tokens.css`, `src/ui/shell/*.tsx`, `src/ui/button.tsx`, `card.tsx`, `pill.tsx`, `field.tsx`, `toast.tsx`, `src/app/[locale]/login/page.tsx`, `src/app/[locale]/(portal)/layout.tsx`, `src/app/[locale]/(portal)/page.tsx`, `e2e/sign-in.spec.ts`
- Modify: `src/app/[locale]/layout.tsx`

**Interfaces:**
- Consumes: `signIn`, `requireUser`, `revokeSession`
- Produces: the portal shell every later screen renders inside; `t()` keys grouped by screen (`shell.*`, `login.*`, `settings.*`)

- [ ] **Step 1: Write the failing e2e test** `e2e/sign-in.spec.ts`:
  - `/en/login` → sign in as the seeded owner → lands on `/en` with sidebar items Home, Orders, Pickups, Wallet, Packaging, Credits, Products, Analytics, Applications, Capital, Support, Settings, and the "Insurance active" badge
  - press the language button → URL becomes `/ar`, `<html dir="rtl" lang="ar">`, sidebar shows "الرئيسية", "الطلبات"
  - wrong password shows the translated error in both languages; sign out returns to the login page
- [ ] **Step 2:** Run `pnpm test:e2e e2e/sign-in.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Build the shell to match the mockup's sidebar (light: white menu with navy text and blue active item; dark: navy menu), top bar (search box placeholder only, language, theme, bell, store avatar) and phone bottom tab bar under 860 px. Logo files: copy `2-02` (light) and `2-03` (dark) from the brand folder into `public/brand/` at 400 px wide. Unbuilt menu items open a "Coming in a later step" page, translated.
- [ ] **Step 4:** Run `pnpm test:e2e e2e/sign-in.spec.ts`, then open `/en` and `/ar` at 1440 and 375 px wide and compare with the mockup. Expected: PASS; no sideways scrolling.
- [ ] **Step 5: Commit** `git commit -m "Add Arabic and English, brand shell and sign-in screen"`

### Task 6: Merchant settings (preferences, profile, business, team, payouts)

**Files:**
- Create: `src/merchants/merchant-profile.ts`, `team.ts`, `bank-account.ts`, `index.ts` with tests beside each; `src/app/[locale]/(portal)/settings/[tab]/page.tsx` and its server actions; `e2e/settings.spec.ts`

**Interfaces:**
- Consumes: `requireUser`, `requireMerchantAccess`, `runOnce`, `writeAudit`, `hashPassword`, `normalizeEgyptianMobile`
- Produces:
  - `getMerchantProfile(merchantId)`, `updateMerchantProfile(user, merchantId, { nameEn, nameAr, industry, website })`
  - `listTeam(user, merchantId)`, `inviteMember(user, merchantId, { name, email, mobile, access }, idempotencyKey)` (creates the user with a one-time password shown once), `changeMemberAccess(user, merchantId, memberUserId, access)`, `deactivateMember(...)` (also revokes their sessions)
  - `requestBankAccountChange(user, merchantId, { bankName, holderName, iban }, idempotencyKey)` → status `pending`; `approveBankAccountChange(staffUser, bankAccountId)` → requires a staff `finance` or `admin` role and a different person from the requester; previous account becomes `replaced`
  - IBAN check: `EG` + 27 digits (29 characters), mod-97 check; shown masked as `EG•• •••• ••1234`

- [ ] **Step 1: Write the failing tests**
  - profile round trip keeps `"نايل ثريدز"` and `"Nile ثريدز"` exactly
  - `inviteMember` twice with the same idempotency key → one user, one membership
  - a member with `orders_pickups` calling `listTeam` or `requestBankAccountChange` → `forbidden`
  - `approveBankAccountChange` by the same person who requested → `AppError('second_person_required')`; by another finance user → active, old account `replaced`, audit entry written
  - invalid IBAN `EG12…` (wrong check digits) → `AppError('invalid_iban')`
  - e2e `settings.spec.ts`: owner edits the Arabic business name, invites a member, and requests a bank change, in Arabic; the member signs in and does not see Team or Payouts tabs, and opening `/ar/settings/payouts` directly shows the "no access" page
- [ ] **Step 2:** Run `pnpm test src/merchants && pnpm test:e2e e2e/settings.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the functions and the Settings tabs to match the mockup (Preferences: language and theme; Profile; Business; Team; Payouts). Tabs not in this plan (Security, Pricing, Billing, API) show "Coming in a later step".
- [ ] **Step 4:** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`. Expected: all PASS, no warnings.
- [ ] **Step 5: Commit** `git commit -m "Add merchant settings: profile, business, team and payout account"`

### Task 7: Owner check

- [ ] **Step 1:** Run `pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm dev`, open the app in the browser pane, and walk the owner through: sign in (email and mobile), switch language and theme, edit business names, invite a member, request a bank account change.
- [ ] **Step 2:** Record the owner's changes as new tasks or approve. Plan 1 is done when the owner approves.
