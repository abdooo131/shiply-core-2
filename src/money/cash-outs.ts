import { randomInt } from 'node:crypto';
import type { CashOutSchedule } from '@prisma/client';
import { z } from 'zod';
import { requireMerchantAccess, type SessionUser } from '@/accounts';
import { maskIbanLast4 } from '@/merchants/iban';
import { writeAudit } from '@/platform/audit-log';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';
import { LEDGER_ACCOUNTS, postEntry, walletAccount } from './ledger';

const FINANCE_ROLES = new Set(['finance', 'admin']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SUNDAY = 0;
const MONDAY = 1;
const WEDNESDAY = 3;
const THURSDAY = 4;
const OPEN_STATUSES = ['prepared', 'approved', 'paid'] as const;

function requireFinance(user: SessionUser): void {
  if (!user.staffRoles.some((role) => FINANCE_ROLES.has(role))) throw new AppError('forbidden', 403);
}

function weekdayOf(cairoDate: string): number {
  if (!DATE_PATTERN.test(cairoDate)) throw new AppError('invalid_input');
  const [year, month, day] = cairoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

// Weekly = Monday; twice a week = Monday and Wednesday; daily = Egyptian working days (Sunday–Thursday).
export function isCashOutDay(schedule: CashOutSchedule, cairoDate: string): boolean {
  const weekday = weekdayOf(cairoDate);
  if (schedule === 'weekly') return weekday === MONDAY;
  if (schedule === 'twice_weekly') return weekday === MONDAY || weekday === WEDNESDAY;
  return weekday >= SUNDAY && weekday <= THURSDAY;
}

function cashOutNumber(): string {
  return `CO${randomInt(10_000_000, 100_000_000)}`;
}

export type PrepareResult = {
  created: { id: string; number: string; merchantId: string; amountPiasters: number }[];
  skipped: { merchantId: string; reason: 'no_bank_account' | 'nothing_to_pay' }[];
};

// For every merchant whose schedule pays out on this date: one cash-out of the net of
// closed, not-yet-paid cycles before that date. Running it again for the same date adds nothing.
export async function prepareCashOuts(financeUser: SessionUser, cairoDate: string): Promise<PrepareResult> {
  requireFinance(financeUser);
  weekdayOf(cairoDate);
  const scheduledDate = new Date(`${cairoDate}T00:00:00Z`);
  const merchants = await db.merchant.findMany({ where: { status: 'active' }, select: { id: true, cashOutSchedule: true } });
  const result: PrepareResult = { created: [], skipped: [] };

  for (const merchant of merchants.filter((candidate) => isCashOutDay(candidate.cashOutSchedule, cairoDate))) {
    await db.$transaction(async (tx) => {
      // One preparer at a time per merchant.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cash_out:${merchant.id}`}))`;
      const already = await tx.cashOut.findFirst({ where: { merchantId: merchant.id, scheduledDate, status: { in: [...OPEN_STATUSES] } } });
      if (already) return;
      const cycles = await tx.cashCycle.findMany({ where: { merchantId: merchant.id, cashOutId: null, cycleDate: { lt: scheduledDate } } });
      const amountPiasters = cycles.reduce((sum, cycle) => sum + cycle.netPiasters, 0);
      if (cycles.length === 0) return;
      if (amountPiasters <= 0) {
        result.skipped.push({ merchantId: merchant.id, reason: 'nothing_to_pay' });
        return;
      }
      const bank = await tx.bankAccount.findFirst({ where: { merchantId: merchant.id, status: 'active' }, select: { id: true } });
      if (!bank) {
        result.skipped.push({ merchantId: merchant.id, reason: 'no_bank_account' });
        return;
      }
      const cashOut = await tx.cashOut.create({
        data: { number: cashOutNumber(), merchantId: merchant.id, bankAccountId: bank.id, amountPiasters, scheduledDate, preparedBy: financeUser.id },
      });
      await tx.cashCycle.updateMany({ where: { id: { in: cycles.map((cycle) => cycle.id) } }, data: { cashOutId: cashOut.id } });
      await writeAudit(tx, { actorUserId: financeUser.id, action: 'cash_out.prepared', entityType: 'CashOut', entityId: cashOut.id, before: null, after: { amountPiasters, cycles: cycles.length } });
      result.created.push({ id: cashOut.id, number: cashOut.number, merchantId: merchant.id, amountPiasters });
    });
  }
  return result;
}

async function findCashOut(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new AppError('not_found', 404);
  const cashOut = await db.cashOut.findUnique({ where: { id } });
  if (!cashOut) throw new AppError('not_found', 404);
  return cashOut;
}

export async function approveCashOut(financeUser: SessionUser, cashOutId: string): Promise<void> {
  requireFinance(financeUser);
  const cashOut = await findCashOut(cashOutId);
  if (cashOut.preparedBy === financeUser.id) throw new AppError('second_person_required', 403);
  await db.$transaction(async (tx) => {
    const updated = await tx.cashOut.updateMany({ where: { id: cashOutId, status: 'prepared' }, data: { status: 'approved', approvedBy: financeUser.id } });
    if (updated.count === 0) throw new AppError('not_prepared', 409);
    await writeAudit(tx, { actorUserId: financeUser.id, action: 'cash_out.approved', entityType: 'CashOut', entityId: cashOutId, before: { status: 'prepared' }, after: { status: 'approved' } });
  });
}

const PaidInput = z.object({ bankReference: z.string().trim().min(3).max(60), receiptPath: z.string().max(300).optional() });

// Marks the transfer done and books it: the wallet is debited and the bank credited.
export async function markCashOutPaid(financeUser: SessionUser, cashOutId: string, input: z.input<typeof PaidInput>): Promise<void> {
  requireFinance(financeUser);
  const parsed = PaidInput.safeParse(input);
  if (!parsed.success) throw new AppError('invalid_input');
  const cashOut = await findCashOut(cashOutId);
  await db.$transaction(async (tx) => {
    const updated = await tx.cashOut.updateMany({
      where: { id: cashOutId, status: 'approved' },
      data: { status: 'paid', paidBy: financeUser.id, paidAt: new Date(), bankReference: parsed.data.bankReference, receiptPath: parsed.data.receiptPath },
    });
    if (updated.count === 0) throw new AppError('not_approved', 409);
    await postEntry(tx, {
      key: `cash_out:${cashOutId}:paid`,
      reason: 'cash_out_paid',
      cashOutId,
      merchantId: cashOut.merchantId,
      lines: [
        { account: walletAccount(cashOut.merchantId), amountPiasters: cashOut.amountPiasters },
        { account: LEDGER_ACCOUNTS.bank, amountPiasters: -cashOut.amountPiasters },
      ],
    });
    await writeAudit(tx, { actorUserId: financeUser.id, action: 'cash_out.paid', entityType: 'CashOut', entityId: cashOutId, before: { status: 'approved' }, after: { status: 'paid' } });
  });
}

export async function cancelCashOut(financeUser: SessionUser, cashOutId: string): Promise<void> {
  requireFinance(financeUser);
  await findCashOut(cashOutId);
  await db.$transaction(async (tx) => {
    const updated = await tx.cashOut.updateMany({ where: { id: cashOutId, status: { in: ['prepared', 'approved'] } }, data: { status: 'canceled' } });
    if (updated.count === 0) throw new AppError('not_cancellable', 409);
    await tx.cashCycle.updateMany({ where: { cashOutId }, data: { cashOutId: null } });
    await writeAudit(tx, { actorUserId: financeUser.id, action: 'cash_out.canceled', entityType: 'CashOut', entityId: cashOutId, before: null, after: { status: 'canceled' } });
  });
}

export type CashOutView = { id: string; number: string; amountPiasters: number; status: string; scheduledDate: string; paidAt: Date | null };

const MAX_LISTED_CASH_OUTS = 100;

export async function listCashOuts(user: SessionUser, merchantId: string): Promise<CashOutView[]> {
  requireMerchantAccess(user, merchantId, 'finance');
  const rows = await db.cashOut.findMany({
    where: { merchantId, status: { not: 'canceled' } },
    orderBy: { scheduledDate: 'desc' },
    take: MAX_LISTED_CASH_OUTS,
  });
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    amountPiasters: row.amountPiasters,
    status: row.status,
    scheduledDate: row.scheduledDate.toISOString().slice(0, 10),
    paidAt: row.paidAt,
  }));
}

export async function getTransferProof(user: SessionUser, merchantId: string, cashOutId: string) {
  requireMerchantAccess(user, merchantId, 'finance');
  if (!z.string().uuid().safeParse(cashOutId).success) throw new AppError('not_found', 404);
  const cashOut = await db.cashOut.findFirst({
    where: { id: cashOutId, merchantId, status: 'paid' },
    include: { cycles: { select: { cycleDate: true } } },
  });
  if (!cashOut) throw new AppError('not_found', 404);
  const [bank, merchant] = await Promise.all([
    db.bankAccount.findUniqueOrThrow({ where: { id: cashOut.bankAccountId }, select: { bankName: true, holderName: true, ibanLast4: true } }),
    db.merchant.findUniqueOrThrow({ where: { id: merchantId }, select: { nameEn: true, nameAr: true } }),
  ]);
  return {
    number: cashOut.number,
    amountPiasters: cashOut.amountPiasters,
    bankReference: cashOut.bankReference,
    paidAt: cashOut.paidAt,
    bankName: bank.bankName,
    holderName: bank.holderName,
    maskedIban: maskIbanLast4(bank.ibanLast4),
    merchantNameEn: merchant.nameEn,
    merchantNameAr: merchant.nameAr,
    cycleCount: cashOut.cycles.length,
    cycleDates: cashOut.cycles.map((cycle) => cycle.cycleDate.toISOString().slice(0, 10)).sort(),
    hasReceipt: Boolean(cashOut.receiptPath),
  };
}
