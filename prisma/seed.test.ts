import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';

function runSeed(extraEnv: Record<string, string> = {}): void {
  execFileSync('pnpm', ['db:seed'], { stdio: 'pipe', env: { ...process.env, ...extraEnv } });
}

describe('seed', () => {
  beforeAll(resetTestDatabase);

  it('can run twice without creating duplicates', async () => {
    runSeed();
    runSeed();
    expect(await db.governorate.count()).toBe(27);
    expect(await db.merchant.count({ where: { nameEn: 'Eve Chantelle' } })).toBe(1);
    expect(await db.merchantMember.count({ where: { access: 'full' } })).toBe(1);
    expect(await db.staffRole.count({ where: { role: 'admin' } })).toBe(1);
    expect(await db.user.count()).toBe(2);
  });

  it('refuses to run in production', () => {
    expect(() => runSeed({ NODE_ENV: 'production' })).toThrow();
  });
});
