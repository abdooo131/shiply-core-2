import { z } from 'zod';
import { requireMerchantAccess, type SessionUser } from '@/accounts';
import { writeAudit } from '@/platform/audit-log';
import { runOnce } from '@/platform/idempotency';
import { AppError } from '@/shared/app-error';
import { encryptText } from '@/shared/data-encryption';
import { db } from '@/shared/db';
import { maskIbanLast4, normalizeEgyptianIban } from './iban';

const APPROVER_ROLES = new Set(['finance', 'admin']);
const IBAN_VISIBLE_DIGITS = 4;

export type BankAccountView = {
  id: string;
  bankName: string;
  holderName: string;
  maskedIban: string;
  status: 'pending' | 'active' | 'replaced';
  createdAt: Date;
};

const BankChangeInput = z.object({
  bankName: z.string().trim().min(1).max(120),
  holderName: z.string().trim().min(1).max(120),
  iban: z.string().max(60),
});

export type BankChangeInput = z.input<typeof BankChangeInput>;

export async function listBankAccounts(user: SessionUser, merchantId: string): Promise<BankAccountView[]> {
  requireMerchantAccess(user, merchantId, 'finance');
  const accounts = await db.bankAccount.findMany({
    where: { merchantId, status: { in: ['pending', 'active'] } },
    orderBy: { createdAt: 'desc' },
  });
  return accounts.map((account) => ({
    id: account.id,
    bankName: account.bankName,
    holderName: account.holderName,
    maskedIban: maskIbanLast4(account.ibanLast4),
    status: account.status,
    createdAt: account.createdAt,
  }));
}

// A new payout account never takes effect on the merchant's word alone:
// it stays pending until a second person at Shiply finance approves it.
export async function requestBankAccountChange(
  user: SessionUser,
  merchantId: string,
  input: BankChangeInput,
  idempotencyKey: string,
): Promise<{ id: string; status: 'pending' }> {
  requireMerchantAccess(user, merchantId, 'finance');
  const parsed = BankChangeInput.safeParse(input);
  if (!parsed.success) throw new AppError('invalid_input');
  const iban = normalizeEgyptianIban(parsed.data.iban);
  const ibanLast4 = iban.slice(-IBAN_VISIBLE_DIGITS);

  return runOnce(idempotencyKey, `bank_account.request:${merchantId}`, async (tx) => {
    const account = await tx.bankAccount.create({
      data: {
        merchantId,
        bankName: parsed.data.bankName,
        holderName: parsed.data.holderName,
        ibanLast4,
        ibanEncrypted: encryptText(iban),
        status: 'pending',
        requestedBy: user.id,
      },
    });
    await writeAudit(tx, {
      actorUserId: user.id,
      action: 'bank_account.requested',
      entityType: 'BankAccount',
      entityId: account.id,
      before: null,
      after: { merchantId, bankName: account.bankName, ibanLast4 },
    });
    return { id: account.id, status: 'pending' as const };
  });
}

export async function approveBankAccountChange(staffUser: SessionUser, bankAccountId: string): Promise<void> {
  if (!staffUser.staffRoles.some((role) => APPROVER_ROLES.has(role))) throw new AppError('forbidden', 403);

  const request = await db.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!request) throw new AppError('not_found', 404);
  if (request.status !== 'pending') throw new AppError('not_pending', 409);
  if (request.requestedBy === staffUser.id) throw new AppError('second_person_required', 403);

  await db.$transaction(async (tx) => {
    // Atomic status check: if two approvers race, only one update matches.
    const approved = await tx.bankAccount.updateMany({
      where: { id: bankAccountId, status: 'pending' },
      data: { status: 'active', approvedBy: staffUser.id },
    });
    if (approved.count === 0) throw new AppError('not_pending', 409);

    await tx.bankAccount.updateMany({
      where: { merchantId: request.merchantId, status: 'active', id: { not: bankAccountId } },
      data: { status: 'replaced' },
    });
    await writeAudit(tx, {
      actorUserId: staffUser.id,
      action: 'bank_account.approved',
      entityType: 'BankAccount',
      entityId: bankAccountId,
      before: { status: 'pending' },
      after: { status: 'active', requestedBy: request.requestedBy },
    });
  });
}
