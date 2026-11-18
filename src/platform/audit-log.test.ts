import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { writeAudit } from './audit-log';

describe('audit log', () => {
  beforeEach(resetTestDatabase);

  it('records an entry', async () => {
    await db.$transaction((tx) =>
      writeAudit(tx, {
        actorUserId: null,
        action: 'merchant.update',
        entityType: 'Merchant',
        entityId: 'm1',
        before: { nameEn: 'Old' },
        after: { nameEn: 'New' },
      }),
    );
    const rows = await db.auditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.afterJson).toEqual({ nameEn: 'New' });
  });

  it('cannot be changed or deleted once written', async () => {
    await db.$transaction((tx) =>
      writeAudit(tx, {
        actorUserId: null,
        action: 'merchant.update',
        entityType: 'Merchant',
        entityId: 'm1',
        before: null,
        after: { nameEn: 'New' },
      }),
    );
    await expect(db.$executeRaw`UPDATE "AuditLog" SET "action" = 'tampered'`).rejects.toThrow(
      /append_only/,
    );
    await expect(db.$executeRaw`DELETE FROM "AuditLog"`).rejects.toThrow(/append_only/);
  });
});
