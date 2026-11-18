import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireMerchantAccess, type SessionUser } from '@/accounts';
import { getArea } from '@/location';
import { writeAudit } from '@/platform/audit-log';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';
import { normalizeEgyptianMobile } from '@/shared/egyptian-mobile';

// A merchant keeps a handful of places; the cap only bounds the query.
const MAX_LOCATIONS_LISTED = 100;

const LocationSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(60),
  addressText: z.string().trim().min(3).max(300),
  areaId: z.string().uuid(),
  contactName: z.string().trim().min(1).max(80),
  contactMobile: z.string().max(30),
});

export type PickupLocationInput = z.input<typeof LocationSchema>;

export type PickupLocationView = {
  id: string;
  label: string;
  addressText: string;
  areaId: string | null;
  areaNameEn: string | null;
  areaNameAr: string | null;
  contactName: string;
  contactMobile: string;
  isDefault: boolean;
};

const LocationId = z.string().uuid();

// Default changes for one merchant happen one at a time, so there is never more than one default.
async function lockMerchantLocations(tx: Prisma.TransactionClient, merchantId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Merchant" WHERE "id" = ${merchantId}::uuid FOR UPDATE`;
}

async function findActiveLocationOrThrow(tx: Prisma.TransactionClient, merchantId: string, locationId: string) {
  if (!LocationId.safeParse(locationId).success) throw new AppError('not_found', 404);
  const location = await tx.pickupLocation.findFirst({ where: { id: locationId, merchantId, isActive: true } });
  if (!location) throw new AppError('not_found', 404);
  return location;
}

async function requireServedArea(areaId: string): Promise<void> {
  const area = await getArea(areaId);
  if (!area) throw new AppError('area_not_found');
  if (!area.isServed) throw new AppError('area_not_served');
}

export async function listPickupLocations(user: SessionUser, merchantId: string): Promise<PickupLocationView[]> {
  requireMerchantAccess(user, merchantId, 'orders');
  const rows = await db.pickupLocation.findMany({
    where: { merchantId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_LOCATIONS_LISTED,
    include: { area: { select: { nameEn: true, nameAr: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    addressText: row.addressText,
    areaId: row.areaId,
    areaNameEn: row.area?.nameEn ?? null,
    areaNameAr: row.area?.nameAr ?? null,
    contactName: row.contactName,
    contactMobile: row.contactMobile,
    isDefault: row.isDefault,
  }));
}

// Creates a location (the merchant's first becomes the default) or edits one. Booked pickups keep
// their own address and contact snapshot, so edits here do not change them.
export async function savePickupLocation(
  user: SessionUser,
  merchantId: string,
  rawInput: PickupLocationInput,
): Promise<{ id: string }> {
  requireMerchantAccess(user, merchantId, 'orders');
  const parsed = LocationSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError('invalid_input');
  const { id, ...fields } = parsed.data;
  const contactMobile = normalizeEgyptianMobile(fields.contactMobile);
  await requireServedArea(fields.areaId);
  const data = { ...fields, contactMobile };

  return db.$transaction(async (tx) => {
    await lockMerchantLocations(tx, merchantId);
    if (id) {
      const existing = await findActiveLocationOrThrow(tx, merchantId, id);
      await tx.pickupLocation.update({ where: { id: existing.id }, data });
      await writeAudit(tx, {
        actorUserId: user.id,
        action: 'pickup_location.updated',
        entityType: 'PickupLocation',
        entityId: existing.id,
        before: { areaId: existing.areaId },
        after: { areaId: data.areaId },
      });
      return { id: existing.id };
    }

    const hasDefault = (await tx.pickupLocation.count({ where: { merchantId, isActive: true, isDefault: true } })) > 0;
    const created = await tx.pickupLocation.create({ data: { ...data, merchantId, isDefault: !hasDefault } });
    await writeAudit(tx, {
      actorUserId: user.id,
      action: 'pickup_location.created',
      entityType: 'PickupLocation',
      entityId: created.id,
      before: null,
      after: { merchantId, areaId: created.areaId, isDefault: created.isDefault },
    });
    return { id: created.id };
  });
}

export async function setDefaultPickupLocation(user: SessionUser, merchantId: string, locationId: string): Promise<void> {
  requireMerchantAccess(user, merchantId, 'orders');
  await db.$transaction(async (tx) => {
    await lockMerchantLocations(tx, merchantId);
    const location = await findActiveLocationOrThrow(tx, merchantId, locationId);
    if (location.isDefault) return;
    const previous = await tx.pickupLocation.findFirst({ where: { merchantId, isDefault: true }, select: { id: true } });
    await tx.pickupLocation.updateMany({ where: { merchantId, isDefault: true }, data: { isDefault: false } });
    await tx.pickupLocation.update({ where: { id: location.id }, data: { isDefault: true } });
    await writeAudit(tx, {
      actorUserId: user.id,
      action: 'pickup_location.default_set',
      entityType: 'PickupLocation',
      entityId: location.id,
      before: { defaultLocationId: previous?.id ?? null },
      after: { defaultLocationId: location.id },
    });
  });
}

// Archiving hides the location from new requests; scheduled pickups keep their snapshot.
export async function archivePickupLocation(user: SessionUser, merchantId: string, locationId: string): Promise<void> {
  requireMerchantAccess(user, merchantId, 'orders');
  await db.$transaction(async (tx) => {
    await lockMerchantLocations(tx, merchantId);
    if (!LocationId.safeParse(locationId).success) throw new AppError('not_found', 404);
    const location = await tx.pickupLocation.findFirst({ where: { id: locationId, merchantId } });
    if (!location) throw new AppError('not_found', 404);
    if (!location.isActive) return;
    if (location.isDefault) throw new AppError('cannot_archive_default', 409);
    await tx.pickupLocation.update({ where: { id: location.id }, data: { isActive: false } });
    await writeAudit(tx, {
      actorUserId: user.id,
      action: 'pickup_location.archived',
      entityType: 'PickupLocation',
      entityId: location.id,
      before: { isActive: true },
      after: { isActive: false },
    });
  });
}
