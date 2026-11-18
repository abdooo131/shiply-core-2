import type { OrderType, PackageSize } from '@prisma/client';
import type { SessionUser } from '@/accounts';
import { writeAudit } from '@/platform/audit-log';
import { runOnce } from '@/platform/idempotency';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';
import { ORDER_TYPES, PACKAGE_SIZES, type PriceLine } from './sample-price-lines';

export type { PriceLine } from './sample-price-lines';

const DEFAULT_SCOPE = 'default';
const PRICE_STAFF_ROLES = new Set(['admin', 'finance']);

function scopeFor(merchantId: string | null): string {
  return merchantId ?? DEFAULT_SCOPE;
}

function requirePriceStaff(user: SessionUser): void {
  if (!user.staffRoles.some((role) => PRICE_STAFF_ROLES.has(role))) throw new AppError('forbidden', 403);
}

// A list must price every zone × size × order type exactly once, with a positive amount.
async function validateLines(lines: PriceLine[]): Promise<void> {
  const zones = await db.pricingZone.findMany({ select: { code: true } });
  const zoneCodes = new Set(zones.map((zone) => zone.code));
  const expectedCount = zoneCodes.size * PACKAGE_SIZES.length * ORDER_TYPES.length;
  const seen = new Set<string>();
  for (const line of lines) {
    const isValid =
      zoneCodes.has(line.zoneCode) &&
      PACKAGE_SIZES.includes(line.size) &&
      ORDER_TYPES.includes(line.orderType) &&
      Number.isSafeInteger(line.shippingPiasters) &&
      line.shippingPiasters > 0;
    if (!isValid) throw new AppError('invalid_input');
    seen.add(`${line.zoneCode}/${line.size}/${line.orderType}`);
  }
  if (lines.length !== expectedCount || seen.size !== expectedCount) throw new AppError('invalid_input');
}

export async function proposePriceList(
  staffUser: SessionUser,
  input: { merchantId: string | null; lines: PriceLine[] },
  idempotencyKey: string,
): Promise<{ id: string; status: 'pending' }> {
  requirePriceStaff(staffUser);
  await validateLines(input.lines);
  const { merchantId } = input;

  return runOnce(idempotencyKey, `price_list.propose:${scopeFor(merchantId)}`, async (tx) => {
    // Only the newest proposal is under review; an older one waiting can never be approved later.
    await tx.priceList.updateMany({ where: { merchantId, status: 'pending' }, data: { status: 'replaced' } });
    const latest = await tx.priceList.findFirst({ where: { merchantId }, orderBy: { version: 'desc' }, select: { version: true } });
    const list = await tx.priceList.create({
      data: { merchantId, version: (latest?.version ?? 0) + 1, requestedBy: staffUser.id, lines: { create: input.lines } },
    });
    await writeAudit(tx, {
      actorUserId: staffUser.id,
      action: 'price_list.proposed',
      entityType: 'PriceList',
      entityId: list.id,
      before: null,
      after: { scope: scopeFor(merchantId), version: list.version },
    });
    return { id: list.id, status: 'pending' as const };
  });
}

export async function approvePriceList(staffUser: SessionUser, priceListId: string): Promise<void> {
  requirePriceStaff(staffUser);
  const list = await db.priceList.findUnique({ where: { id: priceListId } });
  if (!list) throw new AppError('not_found', 404);
  if (list.status !== 'pending') throw new AppError('not_pending', 409);
  if (list.requestedBy === staffUser.id) throw new AppError('second_person_required', 403);
  const scope = scopeFor(list.merchantId);

  await db.$transaction(async (tx) => {
    // Lock this scope's pointer so approvals for one merchant happen one at a time.
    const [current] = await tx.$queryRaw<{ priceListId: string }[]>`
      SELECT "priceListId" FROM "ActivePriceList" WHERE "scope" = ${scope} FOR UPDATE`;

    // Atomic status check: a second approver racing this one matches no row.
    const activated = await tx.priceList.updateMany({
      where: { id: priceListId, status: 'pending' },
      data: { status: 'active', approvedBy: staffUser.id, activatedAt: new Date() },
    });
    if (activated.count === 0) throw new AppError('not_pending', 409);

    if (current) await tx.priceList.update({ where: { id: current.priceListId }, data: { status: 'retired' } });
    await tx.activePriceList.upsert({ where: { scope }, create: { scope, priceListId }, update: { priceListId } });
    await writeAudit(tx, {
      actorUserId: staffUser.id,
      action: 'price_list.approved',
      entityType: 'PriceList',
      entityId: priceListId,
      before: current ? { activePriceListId: current.priceListId } : null,
      after: { activePriceListId: priceListId, requestedBy: list.requestedBy },
    });
  });
}

// The merchant's own list if one is active, otherwise the default list.
async function activePriceListId(merchantId: string): Promise<string> {
  const pointers = await db.activePriceList.findMany({ where: { scope: { in: [merchantId, DEFAULT_SCOPE] } } });
  const pointer = pointers.find((row) => row.scope === merchantId) ?? pointers.find((row) => row.scope === DEFAULT_SCOPE);
  if (!pointer) throw new AppError('price_missing', 500);
  return pointer.priceListId;
}

export async function getShippingPiasters(merchantId: string, zoneCode: string, size: PackageSize, orderType: OrderType): Promise<number> {
  const priceListId = await activePriceListId(merchantId);
  const line = await db.priceListLine.findUnique({
    where: { priceListId_zoneCode_size_orderType: { priceListId, zoneCode, size, orderType } },
    select: { shippingPiasters: true },
  });
  if (!line) throw new AppError('price_missing', 500);
  return line.shippingPiasters;
}

export async function getActivePriceLines(merchantId: string): Promise<PriceLine[]> {
  const priceListId = await activePriceListId(merchantId);
  return db.priceListLine.findMany({
    where: { priceListId },
    select: { zoneCode: true, size: true, orderType: true, shippingPiasters: true },
  });
}
