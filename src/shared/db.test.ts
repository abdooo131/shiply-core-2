import { describe, expect, it } from 'vitest';
import { db } from './db';

describe('database connection', () => {
  it('connects to the test database and has PostGIS', async () => {
    const rows = await db.$queryRaw<{ version: string; database: string }[]>`
      SELECT postgis_version() AS version, current_database() AS database`;
    expect(rows[0]?.version.startsWith('3.')).toBe(true);
    expect(rows[0]?.database).toBe('shiply_test');
  });
});
