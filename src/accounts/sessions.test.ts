import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { createTestUser, TEST_PASSWORD } from './accounts-test-fixtures';
import { changePassword, getSessionUser, revokeSession } from './sessions';
import { signIn } from './sign-in';

const AGENT = 'vitest';

describe('sessions', () => {
  beforeEach(resetTestDatabase);

  it('stores only the SHA-256 hash of a random 32-byte token', async () => {
    await createTestUser();
    const { sessionToken } = await signIn('owner@example.test', TEST_PASSWORD, AGENT);
    expect(Buffer.from(sessionToken, 'base64url')).toHaveLength(32);
    const stored = await db.session.findFirstOrThrow();
    expect(stored.tokenHash).toBe(createHash('sha256').update(sessionToken).digest('hex'));
    expect(JSON.stringify(stored)).not.toContain(sessionToken);
  });

  it('returns the user with roles and merchant access for a live session', async () => {
    const { user, merchant } = await createTestUser({ access: 'finance' });
    const { sessionToken } = await signIn('owner@example.test', TEST_PASSWORD, AGENT);
    expect(await getSessionUser(sessionToken)).toEqual({
      id: user.id,
      name: 'Test Owner',
      language: 'ar',
      staffRoles: [],
      memberships: [{ merchantId: merchant.id, access: 'finance' }],
    });
  });

  it('returns null for unknown, expired or revoked sessions', async () => {
    await createTestUser();
    expect(await getSessionUser('made-up-token')).toBeNull();

    const expired = await signIn('owner@example.test', TEST_PASSWORD, AGENT);
    await db.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await getSessionUser(expired.sessionToken)).toBeNull();

    const revoked = await signIn('owner@example.test', TEST_PASSWORD, AGENT);
    await revokeSession(revoked.sessionToken);
    expect(await getSessionUser(revoked.sessionToken)).toBeNull();
  });

  it('changing the password signs out every other session', async () => {
    const { user } = await createTestUser();
    const current = await signIn('owner@example.test', TEST_PASSWORD, AGENT);
    const other = await signIn('owner@example.test', TEST_PASSWORD, AGENT);

    await changePassword(user.id, TEST_PASSWORD, 'a brand new passphrase', current.sessionToken);

    expect(await getSessionUser(other.sessionToken)).toBeNull();
    expect(await getSessionUser(current.sessionToken)).not.toBeNull();
    await expect(signIn('owner@example.test', 'a brand new passphrase', AGENT)).resolves.toBeDefined();
  });

  it('refuses a password change with the wrong current password or a short new one', async () => {
    const { user } = await createTestUser();
    const current = await signIn('owner@example.test', TEST_PASSWORD, AGENT);
    await expect(changePassword(user.id, 'wrong', 'a brand new passphrase', current.sessionToken)).rejects.toMatchObject(
      { code: 'invalid_credentials' },
    );
    await expect(changePassword(user.id, TEST_PASSWORD, 'short', current.sessionToken)).rejects.toMatchObject({
      code: 'weak_password',
    });
  });
});
