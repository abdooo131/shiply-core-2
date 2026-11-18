import { Prisma } from '@prisma/client';

export type AuditEntry = {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: Prisma.InputJsonValue | null;
  after: Prisma.InputJsonValue | null;
};

// Called inside the same transaction as the change it records, so the change
// and its audit row are saved together or not at all.
export async function writeAudit(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeJson: entry.before ?? Prisma.DbNull,
      afterJson: entry.after ?? Prisma.DbNull,
    },
  });
}
