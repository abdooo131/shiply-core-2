import { db } from './db';

// Reference data that the seed loads once and tests rely on.
const KEPT_TABLES = new Set(['_prisma_migrations', 'Governorate', 'PricingZone', 'Area', 'spatial_ref_sys']);
const TEST_DATABASE_NAME = 'shiply_test';

// Empties every table except reference data. Only ever runs on the test database.
export async function resetTestDatabase(): Promise<void> {
  const [current] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (current?.name !== TEST_DATABASE_NAME) {
    throw new Error(`resetTestDatabase refused: connected to "${current?.name}", not ${TEST_DATABASE_NAME}`);
  }

  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  const toTruncate = tables
    .map((row) => row.tablename)
    .filter((name) => !KEPT_TABLES.has(name))
    .map((name) => `"${name}"`);
  if (toTruncate.length === 0) return;

  await db.$executeRawUnsafe(`TRUNCATE ${toTruncate.join(', ')} RESTART IDENTITY CASCADE`);
}
