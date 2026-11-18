import { db } from '@/shared/db';
import { hashPassword } from './password';

export const TEST_PASSWORD = 'correct horse battery';

export async function createTestUser(
  overrides: { email?: string; mobile?: string; access?: 'full' | 'orders_pickups' | 'finance' } = {},
) {
  const user = await db.user.create({
    data: {
      email: overrides.email ?? 'owner@example.test',
      mobile: overrides.mobile ?? '+201001234567',
      name: 'Test Owner',
      passwordHash: await hashPassword(TEST_PASSWORD),
    },
  });
  const merchant = await db.merchant.create({ data: { nameEn: 'Test Shop', nameAr: 'متجر تجريبي' } });
  await db.merchantMember.create({
    data: { merchantId: merchant.id, userId: user.id, access: overrides.access ?? 'full' },
  });
  return { user, merchant };
}
