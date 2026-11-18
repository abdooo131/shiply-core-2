import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { createTestUser, TEST_PASSWORD } from './accounts-test-fixtures';
import { MAX_FAILED_ATTEMPTS_PER_ADDRESS } from './sign-in-throttle';
import { signIn } from './sign-in';

const AGENT = 'vitest';
const ADDRESS_A = '203.0.113.7';
const ADDRESS_B = '198.51.100.20';

describe('sign-in limit per network address', () => {
  beforeEach(resetTestDatabase);

  it('pauses an address after too many failed attempts, across all accounts', async () => {
    await createTestUser();
    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS_PER_ADDRESS; attempt += 1) {
      await signIn(`guess${attempt}@example.test`, 'nope', AGENT, ADDRESS_A).catch(() => null);
    }
    await expect(signIn('owner@example.test', TEST_PASSWORD, AGENT, ADDRESS_A)).rejects.toMatchObject({
      code: 'too_many_attempts',
      status: 429,
    });
    // Another address is not affected.
    await expect(signIn('owner@example.test', TEST_PASSWORD, AGENT, ADDRESS_B)).resolves.toBeDefined();
  });

  it('counts attempts that arrive at the same moment', async () => {
    const burst = Array.from({ length: MAX_FAILED_ATTEMPTS_PER_ADDRESS + 10 }, (_, index) =>
      signIn(`guess${index}@example.test`, 'nope', AGENT, ADDRESS_A).catch((error: unknown) => error),
    );
    const results = await Promise.all(burst);
    const passedThrough = results.filter((result) => (result as { code?: string }).code === 'invalid_credentials');
    expect(passedThrough.length).toBeLessThanOrEqual(MAX_FAILED_ATTEMPTS_PER_ADDRESS);
  });

  it('does not count successful sign-ins', async () => {
    await createTestUser();
    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS_PER_ADDRESS + 5; attempt += 1) {
      await signIn('owner@example.test', TEST_PASSWORD, AGENT, ADDRESS_A);
    }
    expect(await db.signInAttempt.count()).toBe(0);
  });

  it('never stores the address itself', async () => {
    await signIn('nobody@example.test', 'nope', AGENT, ADDRESS_A).catch(() => null);
    expect(JSON.stringify(await db.signInAttempt.findMany())).not.toContain(ADDRESS_A);
  });
});
