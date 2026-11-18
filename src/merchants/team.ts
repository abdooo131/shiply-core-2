import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { hashPassword, requireMerchantAccess, type MerchantAccess, type SessionUser } from '@/accounts';
import { writeAudit } from '@/platform/audit-log';
import { runOnce } from '@/platform/idempotency';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';
import { normalizeEgyptianMobile } from '@/shared/egyptian-mobile';

const ONE_TIME_PASSWORD_BYTES = 12;
const ACCESS_LEVELS = ['full', 'orders_pickups', 'finance'] as const;

export type TeamMember = {
  userId: string;
  name: string;
  email: string | null;
  mobile: string | null;
  access: MerchantAccess;
  status: 'invited' | 'active' | 'removed';
};

const InviteInput = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(200).nullable().or(z.literal('').transform(() => null)),
  mobile: z.string().trim().max(30).nullable().or(z.literal('').transform(() => null)),
  access: z.enum(ACCESS_LEVELS),
});

export type InviteInput = z.input<typeof InviteInput>;

export async function listTeam(user: SessionUser, merchantId: string): Promise<TeamMember[]> {
  requireMerchantAccess(user, merchantId, 'team');
  const members = await db.merchantMember.findMany({
    where: { merchantId, status: { not: 'removed' } },
    include: { user: { select: { name: true, email: true, mobile: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return members.map((member) => ({
    userId: member.userId,
    name: member.user.name,
    email: member.user.email,
    mobile: member.user.mobile,
    access: member.access,
    status: member.status,
  }));
}

// Creates the person's account with a one-time password, shown once to the inviter.
// A repeat with the same idempotency key returns the same user and no password.
export async function inviteMember(
  user: SessionUser,
  merchantId: string,
  input: InviteInput,
  idempotencyKey: string,
): Promise<{ userId: string; oneTimePassword: string | null }> {
  requireMerchantAccess(user, merchantId, 'team');
  const parsed = InviteInput.safeParse(input);
  if (!parsed.success) throw new AppError('invalid_input');
  const { name, email, access } = parsed.data;
  if (!email && !parsed.data.mobile) throw new AppError('invalid_input');
  const mobile = parsed.data.mobile ? normalizeEgyptianMobile(parsed.data.mobile) : null;

  const oneTimePassword = randomBytes(ONE_TIME_PASSWORD_BYTES).toString('base64url');
  const passwordHash = await hashPassword(oneTimePassword);
  let createdNow = false;

  const result = await runOnce(idempotencyKey, `team.invite:${merchantId}`, async (tx) => {
    const existing = await tx.user.findFirst({
      where: { OR: [...(email ? [{ email }] : []), ...(mobile ? [{ mobile }] : [])] },
      select: { id: true },
    });
    if (existing) throw new AppError('account_exists', 409);

    const invited = await tx.user.create({ data: { name, email, mobile, passwordHash } });
    await tx.merchantMember.create({ data: { merchantId, userId: invited.id, access, status: 'active' } });
    await writeAudit(tx, {
      actorUserId: user.id,
      action: 'team.member_invited',
      entityType: 'MerchantMember',
      entityId: invited.id,
      before: null,
      after: { merchantId, access },
    });
    createdNow = true;
    return { userId: invited.id };
  });

  return { userId: result.userId, oneTimePassword: createdNow ? oneTimePassword : null };
}

async function findMembership(merchantId: string, memberUserId: string) {
  const membership = await db.merchantMember.findUnique({
    where: { merchantId_userId: { merchantId, userId: memberUserId } },
  });
  if (!membership || membership.status === 'removed') throw new AppError('not_found', 404);
  return membership;
}

export async function changeMemberAccess(
  user: SessionUser,
  merchantId: string,
  memberUserId: string,
  access: MerchantAccess,
): Promise<void> {
  requireMerchantAccess(user, merchantId, 'team');
  if (memberUserId === user.id) throw new AppError('cannot_change_self');
  if (!ACCESS_LEVELS.includes(access)) throw new AppError('invalid_input');
  const membership = await findMembership(merchantId, memberUserId);

  await db.$transaction(async (tx) => {
    await tx.merchantMember.update({ where: { id: membership.id }, data: { access } });
    await writeAudit(tx, {
      actorUserId: user.id,
      action: 'team.access_changed',
      entityType: 'MerchantMember',
      entityId: memberUserId,
      before: { access: membership.access },
      after: { access },
    });
  });
}

export async function deactivateMember(user: SessionUser, merchantId: string, memberUserId: string): Promise<void> {
  requireMerchantAccess(user, merchantId, 'team');
  if (memberUserId === user.id) throw new AppError('cannot_change_self');
  const membership = await findMembership(merchantId, memberUserId);

  await db.$transaction(async (tx) => {
    await tx.merchantMember.update({ where: { id: membership.id }, data: { status: 'removed' } });
    // End every open session so removed access takes effect immediately.
    await tx.session.updateMany({ where: { userId: memberUserId, revokedAt: null }, data: { revokedAt: new Date() } });
    await writeAudit(tx, {
      actorUserId: user.id,
      action: 'team.member_removed',
      entityType: 'MerchantMember',
      entityId: memberUserId,
      before: { status: membership.status },
      after: { status: 'removed' },
    });
  });
}
