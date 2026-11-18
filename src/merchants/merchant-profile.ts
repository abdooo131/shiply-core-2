import { z } from 'zod';
import { requireMerchantAccess, type SessionUser } from '@/accounts';
import { writeAudit } from '@/platform/audit-log';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';

export type MerchantProfile = {
  id: string;
  nameEn: string;
  nameAr: string;
  industry: string | null;
  website: string | null;
};

const MAX_NAME_LENGTH = 120;

const ProfileInput = z.object({
  nameEn: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  nameAr: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  industry: z.string().trim().max(80).nullable().transform((value) => value || null),
  website: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .transform((value) => value || null)
    .refine((value) => value === null || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(value)),
});

export type MerchantProfileInput = z.input<typeof ProfileInput>;

const PROFILE_FIELDS = { id: true, nameEn: true, nameAr: true, industry: true, website: true } as const;

export async function getMerchantProfile(merchantId: string): Promise<MerchantProfile> {
  return db.merchant.findUniqueOrThrow({ where: { id: merchantId }, select: PROFILE_FIELDS });
}

export async function updateMerchantProfile(
  user: SessionUser,
  merchantId: string,
  input: MerchantProfileInput,
): Promise<MerchantProfile> {
  requireMerchantAccess(user, merchantId, 'business');
  const parsed = ProfileInput.safeParse(input);
  if (!parsed.success) throw new AppError('invalid_input');

  return db.$transaction(async (tx) => {
    const before = await tx.merchant.findUniqueOrThrow({ where: { id: merchantId }, select: PROFILE_FIELDS });
    const after = await tx.merchant.update({ where: { id: merchantId }, data: parsed.data, select: PROFILE_FIELDS });
    await writeAudit(tx, {
      actorUserId: user.id,
      action: 'merchant.profile_updated',
      entityType: 'Merchant',
      entityId: merchantId,
      before,
      after,
    });
    return after;
  });
}
