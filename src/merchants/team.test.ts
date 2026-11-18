import { beforeEach, describe, expect, it } from 'vitest';
import { getSessionUser } from '@/accounts/sessions';
import { signIn } from '@/accounts/sign-in';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { makeMerchant, makeSessionUser } from './merchants-test-fixtures';
import { changeMemberAccess, deactivateMember, inviteMember, listTeam } from './team';

const NEW_MEMBER = { name: 'Ops Lead', email: 'ops@nilethreads.example', mobile: '01112345678', access: 'orders_pickups' as const };

describe('team', () => {
  beforeEach(resetTestDatabase);

  it('invites a member who can sign in with the one-time password', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const invite = await inviteMember(owner, merchant.id, NEW_MEMBER, 'invite-1');
    expect(invite.oneTimePassword).toMatch(/^.{12,}$/);
    const signedIn = await signIn('01112345678', invite.oneTimePassword ?? '', 'vitest');
    expect(signedIn.user.memberships).toEqual([{ merchantId: merchant.id, access: 'orders_pickups' }]);
  });

  it('creates one member when the same invite is sent twice', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const first = await inviteMember(owner, merchant.id, NEW_MEMBER, 'invite-1');
    const second = await inviteMember(owner, merchant.id, NEW_MEMBER, 'invite-1');
    expect(second.userId).toBe(first.userId);
    expect(second.oneTimePassword).toBeNull();
    expect(await db.user.count({ where: { email: NEW_MEMBER.email } })).toBe(1);
    expect(await db.merchantMember.count({ where: { userId: first.userId } })).toBe(1);
  });

  it('never stores the one-time password in the clear', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const invite = await inviteMember(owner, merchant.id, NEW_MEMBER, 'invite-1');
    const everything = JSON.stringify([await db.idempotencyKey.findMany(), await db.auditLog.findMany(), await db.user.findMany()]);
    expect(everything).not.toContain(invite.oneTimePassword ?? 'missing');
  });

  it('refuses an email or mobile that already has an account', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    await inviteMember(owner, merchant.id, NEW_MEMBER, 'invite-1');
    await expect(inviteMember(owner, merchant.id, NEW_MEMBER, 'invite-2')).rejects.toMatchObject({ code: 'account_exists' });
  });

  it('lists the team for full access and refuses orders & pickups access', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const ops = await makeSessionUser({ merchantId: merchant.id, access: 'orders_pickups' });
    expect((await listTeam(owner, merchant.id)).members.map((member) => member.access).sort()).toEqual(['full', 'orders_pickups']);
    await expect(listTeam(ops, merchant.id)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('pages through a large team without repeats or gaps', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    for (let index = 0; index < 5; index += 1) await makeSessionUser({ merchantId: merchant.id, access: 'orders_pickups' });

    const seen: string[] = [];
    let after: string | undefined;
    let pages = 0;
    do {
      const page = await listTeam(owner, merchant.id, { after, pageSize: 2 });
      expect(page.members.length).toBeLessThanOrEqual(2);
      seen.push(...page.members.map((member) => member.userId));
      after = page.nextCursor ?? undefined;
      pages += 1;
    } while (after);

    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(6);
  });

  it('changes access and deactivates a member, ending their sessions', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const invite = await inviteMember(owner, merchant.id, NEW_MEMBER, 'invite-1');
    const memberSession = await signIn(NEW_MEMBER.email, invite.oneTimePassword ?? '', 'vitest');

    await changeMemberAccess(owner, merchant.id, invite.userId, 'finance');
    expect((await getSessionUser(memberSession.sessionToken))?.memberships[0]?.access).toBe('finance');

    await deactivateMember(owner, merchant.id, invite.userId);
    expect(await getSessionUser(memberSession.sessionToken)).toBeNull();
    expect(await db.auditLog.count({ where: { action: { startsWith: 'team.' } } })).toBe(3);
  });

  it('does not let a person change or remove their own access', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    await expect(changeMemberAccess(owner, merchant.id, owner.id, 'finance')).rejects.toMatchObject({ code: 'cannot_change_self' });
    await expect(deactivateMember(owner, merchant.id, owner.id)).rejects.toMatchObject({ code: 'cannot_change_self' });
  });
});
