import { beforeEach, describe, expect, it } from 'vitest';
import { resetTestDatabase } from '@/shared/test-db';
import { runOnce } from './idempotency';

describe('runOnce', () => {
  beforeEach(resetTestDatabase);

  it('runs the work once and returns the first result on a repeat', async () => {
    let calls = 0;
    const work = async () => {
      calls += 1;
      return { orderNumber: 1000 + calls };
    };
    const first = await runOnce('k1', 'test', work);
    const second = await runOnce('k1', 'test', work);
    expect(calls).toBe(1);
    expect(second).toEqual(first);
  });

  it('runs the work once when two calls arrive at the same time', async () => {
    let calls = 0;
    const work = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { orderNumber: 1000 + calls };
    };
    const [a, b] = await Promise.all([runOnce('k2', 'test', work), runOnce('k2', 'test', work)]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
  });

  it('treats the same key in another scope as separate work', async () => {
    let calls = 0;
    const work = async () => ++calls;
    await runOnce('k3', 'orders', work);
    await runOnce('k3', 'pickups', work);
    expect(calls).toBe(2);
  });

  it('lets a failed attempt be retried', async () => {
    await expect(
      runOnce('k4', 'test', async () => {
        throw new Error('courier down');
      }),
    ).rejects.toThrow('courier down');
    expect(await runOnce('k4', 'test', async () => 'ok')).toBe('ok');
  });
});
