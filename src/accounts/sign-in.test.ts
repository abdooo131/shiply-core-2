import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { createTestUser, TEST_PASSWORD } from './accounts-test-fixtures';
import { hashPassword, verifyPassword } from './password';
import { signIn } from './sign-in';

const AGENT = 'vitest';

describe('passwords', () => {
  it('hashes with argon2id and verifies', async () => {
    const hashed = await hashPassword('secret-pass');
    expect(hashed.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hashed, 'secret-pass')).toBe(true);
    expect(await verifyPassword(hashed, 'wrong-pass')).toBe(false);
  });
});

describe('signIn', () => {
  beforeEach(resetTestDatabase);

  it('accepts email or mobile in any common format for the same user', async () => {
    const { user } = await createTestUser();
    for (const identifier of ['owner@example.test', ' Owner@Example.test ', '01001234567', '+20 100 123 4567']) {
      const result = await signIn(identifier, TEST_PASSWORD, AGENT);
      expect(result.user.id).toBe(user.id);
      expect(result.sessionToken.length).toBeGreaterThan(40);
    }
  });

  it('rejects a wrong password or unknown account with the same error', async () => {
    await createTestUser();
    await expect(signIn('owner@example.test', 'nope', AGENT)).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(signIn('nobody@example.test', TEST_PASSWORD, AGENT)).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    await expect(signIn('not a phone', TEST_PASSWORD, AGENT)).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('locks the account after 5 wrong passwords, then unlocks when the lock expires', async () => {
    const { user } = await createTestUser();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(signIn('owner@example.test', 'nope', AGENT)).rejects.toMatchObject({ code: 'invalid_credentials' });
    }
    await expect(signIn('owner@example.test', TEST_PASSWORD, AGENT)).rejects.toMatchObject({ code: 'account_locked' });

    await db.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    const result = await signIn('owner@example.test', TEST_PASSWORD, AGENT);
    expect(result.user.id).toBe(user.id);
  });

  it('still locks when many wrong passwords arrive at the same moment', async () => {
    await createTestUser();
    const attempts = Array.from({ length: 10 }, () => signIn('owner@example.test', 'nope', AGENT).catch(() => null));
    await Promise.all(attempts);
    await expect(signIn('owner@example.test', TEST_PASSWORD, AGENT)).rejects.toMatchObject({ code: 'account_locked' });
  });

  it('rejects a disabled account', async () => {
    const { user } = await createTestUser();
    await db.user.update({ where: { id: user.id }, data: { status: 'disabled' } });
    await expect(signIn('owner@example.test', TEST_PASSWORD, AGENT)).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
  });

  it('audits sign-ins without the password or the full phone number', async () => {
    await createTestUser();
    await signIn('01001234567', TEST_PASSWORD, AGENT);
    await expect(signIn('01001234567', 'wrong-secret', AGENT)).rejects.toThrow();
    const entries = await db.auditLog.findMany({ where: { action: { startsWith: 'auth.sign_in' } } });
    expect(entries.map((entry) => entry.action).sort()).toEqual(['auth.sign_in', 'auth.sign_in_failed']);
    const logged = JSON.stringify(entries);
    expect(logged).not.toContain(TEST_PASSWORD);
    expect(logged).not.toContain('wrong-secret');
    expect(logged).not.toContain('1001234567');
  });
});
