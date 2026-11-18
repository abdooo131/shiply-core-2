import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { getMerchantProfile, updateMerchantProfile } from './merchant-profile';
import { makeMerchant, makeSessionUser } from './merchants-test-fixtures';

describe('merchant profile', () => {
  beforeEach(resetTestDatabase);

  it('keeps Arabic and mixed-language names exactly', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    await updateMerchantProfile(owner, merchant.id, {
      nameEn: 'Nile ثريدز',
      nameAr: 'نايل ثريدز',
      industry: 'Fashion',
      website: 'https://nilethreads.example',
    });
    expect(await getMerchantProfile(merchant.id)).toMatchObject({
      nameEn: 'Nile ثريدز',
      nameAr: 'نايل ثريدز',
      industry: 'Fashion',
      website: 'https://nilethreads.example',
    });
    expect(await db.auditLog.count({ where: { action: 'merchant.profile_updated' } })).toBe(1);
  });

  it('allows only full access to change business details', async () => {
    const merchant = await makeMerchant();
    const finance = await makeSessionUser({ merchantId: merchant.id, access: 'finance' });
    await expect(
      updateMerchantProfile(finance, merchant.id, { nameEn: 'X', nameAr: 'س', industry: null, website: null }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rejects empty names and a website that is not a web address', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    await expect(
      updateMerchantProfile(owner, merchant.id, { nameEn: '  ', nameAr: 'س', industry: null, website: null }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      updateMerchantProfile(owner, merchant.id, { nameEn: 'A', nameAr: 'س', industry: null, website: 'javascript:alert(1)' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
