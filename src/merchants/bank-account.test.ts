import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/shared/db';
import { decryptText } from '@/shared/data-encryption';
import { resetTestDatabase } from '@/shared/test-db';
import { approveBankAccountChange, listBankAccounts, requestBankAccountChange } from './bank-account';
import { BAD_CHECK_DIGITS_IBAN, makeMerchant, makeSessionUser, VALID_IBAN } from './merchants-test-fixtures';

const CHANGE = { bankName: 'Nile Commercial Bank', holderName: 'Nile Threads LLC', iban: VALID_IBAN };

describe('bank account changes', () => {
  beforeEach(resetTestDatabase);

  it('stores a request as pending with the IBAN encrypted and masked', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const request = await requestBankAccountChange(owner, merchant.id, CHANGE, 'bank-1');
    expect(request.status).toBe('pending');

    const stored = await db.bankAccount.findUniqueOrThrow({ where: { id: request.id } });
    expect(stored.ibanLast4).toBe('0002');
    expect(stored.ibanEncrypted).not.toContain(VALID_IBAN);
    expect(decryptText(stored.ibanEncrypted)).toBe(VALID_IBAN);
    expect(JSON.stringify(await db.auditLog.findMany())).not.toContain('263180002');

    const listed = await listBankAccounts(owner, merchant.id);
    expect(listed[0]).toMatchObject({ maskedIban: 'EG•• •••• ••0002', status: 'pending' });
  });

  it('creates one request when the same change is sent twice', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    await requestBankAccountChange(owner, merchant.id, CHANGE, 'bank-1');
    await requestBankAccountChange(owner, merchant.id, CHANGE, 'bank-1');
    expect(await db.bankAccount.count()).toBe(1);
  });

  it('rejects an IBAN with wrong check digits', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    await expect(
      requestBankAccountChange(owner, merchant.id, { ...CHANGE, iban: BAD_CHECK_DIGITS_IBAN }, 'bank-1'),
    ).rejects.toMatchObject({ code: 'invalid_iban' });
  });

  it('refuses orders & pickups access', async () => {
    const merchant = await makeMerchant();
    const ops = await makeSessionUser({ merchantId: merchant.id, access: 'orders_pickups' });
    await expect(requestBankAccountChange(ops, merchant.id, CHANGE, 'bank-1')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('needs a second person from Shiply finance to approve', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const firstFinance = await makeSessionUser({ staffRole: 'finance' });
    const secondFinance = await makeSessionUser({ staffRole: 'finance' });
    const operations = await makeSessionUser({ staffRole: 'operations' });

    const first = await requestBankAccountChange(owner, merchant.id, CHANGE, 'bank-1');
    await approveBankAccountChange(firstFinance, first.id);

    // A Shiply finance person requesting on the merchant's behalf cannot approve their own request.
    await db.merchantMember.create({ data: { merchantId: merchant.id, userId: firstFinance.id, access: 'finance' } });
    const financeAsMember = { ...firstFinance, memberships: [{ merchantId: merchant.id, access: 'finance' as const }] };
    const second = await requestBankAccountChange(financeAsMember, merchant.id, { ...CHANGE, bankName: 'Second Bank' }, 'bank-2');

    await expect(approveBankAccountChange(firstFinance, second.id)).rejects.toMatchObject({ code: 'second_person_required' });
    await expect(approveBankAccountChange(operations, second.id)).rejects.toMatchObject({ code: 'forbidden' });

    await approveBankAccountChange(secondFinance, second.id);
    const accounts = await db.bankAccount.findMany({ orderBy: { createdAt: 'asc' } });
    expect(accounts.map((account) => account.status)).toEqual(['replaced', 'active']);
    expect(accounts[1]?.approvedBy).toBe(secondFinance.id);
    expect(await db.auditLog.count({ where: { action: 'bank_account.approved' } })).toBe(2);
  });

  it('a newer request replaces an older one still waiting, so the old one can never be approved', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const finance = await makeSessionUser({ staffRole: 'finance' });
    const older = await requestBankAccountChange(owner, merchant.id, CHANGE, 'bank-1');
    const newer = await requestBankAccountChange(owner, merchant.id, { ...CHANGE, bankName: 'Newer Bank' }, 'bank-2');

    await expect(approveBankAccountChange(finance, older.id)).rejects.toMatchObject({ code: 'not_pending' });
    await approveBankAccountChange(finance, newer.id);
    expect((await listBankAccounts(owner, merchant.id)).map((account) => account.bankName)).toEqual(['Newer Bank']);
  });

  it('cannot approve the same request twice', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const finance = await makeSessionUser({ staffRole: 'finance' });
    const request = await requestBankAccountChange(owner, merchant.id, CHANGE, 'bank-1');
    await approveBankAccountChange(finance, request.id);
    await expect(approveBankAccountChange(finance, request.id)).rejects.toMatchObject({ code: 'not_pending' });
  });
});
