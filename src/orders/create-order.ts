import type { CashDirection, OrderType, PackageSize, Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireMerchantAccess, type SessionUser } from '@/accounts';
import { writeAudit } from '@/platform/audit-log';
import { runOnce } from '@/platform/idempotency';
import { quoteOrderFees } from '@/pricing';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';
import { normalizeEgyptianMobile } from '@/shared/egyptian-mobile';
import { generateOrderNumber } from './order-number';

const MAX_PICK_AND_CHOOSE_PRODUCTS = 3;
const MAX_ORDER_NUMBER_TRIES = 5;
// Cash collection and Sign & Return carry no parcel, so they are priced as small (plan decision 3).
const PARCEL_FREE_TYPES: ReadonlySet<OrderType> = new Set(['cash_collection', 'sign_and_return']);
// The customer may not open these: nothing to inspect, or a document to sign.
const NO_OPEN_PACKAGE_TYPES: ReadonlySet<OrderType> = new Set(['cash_collection', 'sign_and_return', 'return']);

const piasters = z.number().int().min(0).max(100_000_000);
const optionalText = (max: number) => z.string().trim().max(max).optional().transform((value) => value || null);

const CreateOrderSchema = z
  .object({
    type: z.enum(['deliver', 'pick_and_choose', 'exchange', 'return', 'sign_and_return', 'cash_collection']),
    customerName: z.string().trim().min(1).max(120),
    customerMobile: z.string().max(30),
    addressText: z.string().trim().min(3).max(300),
    addressExtra: optionalText(120),
    areaId: z.string().uuid(),
    size: z.enum(['small', 'medium', 'large', 'light_bulky', 'heavy_bulky']),
    description: optionalText(300),
    // For Return this is the refund to the customer; for Cash collection, the amount in the chosen direction.
    codAmountPiasters: piasters,
    cashDirection: z.enum(['collect', 'give']).optional(),
    allowOpenPackage: z.boolean(),
    depositRequired: z.boolean(),
    insuredValuePiasters: piasters,
    productIds: z.array(z.string().uuid()).optional(),
    linkedOrderNumber: z.string().regex(/^\d{10}$/).optional(),
    merchantReference: optionalText(60),
    courierNote: optionalText(200),
  })
  .superRefine((input, context) => {
    const problem = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
    if (input.type === 'pick_and_choose') {
      const count = input.productIds?.length ?? 0;
      if (count < 1 || count > MAX_PICK_AND_CHOOSE_PRODUCTS || new Set(input.productIds).size !== count) problem('products');
    }
    if (input.type === 'cash_collection' && (!input.cashDirection || input.codAmountPiasters <= 0)) problem('cash');
  });

export type CreateOrderInput = z.input<typeof CreateOrderSchema>;

type MoneyFields = { codAmountPiasters: number; refundPiasters: number; cashDirection: CashDirection | null };

function moneyFields(type: OrderType, amountPiasters: number, cashDirection?: CashDirection): MoneyFields {
  if (type === 'return') return { codAmountPiasters: 0, refundPiasters: amountPiasters, cashDirection: null };
  if (type === 'cash_collection' && cashDirection === 'give') return { codAmountPiasters: 0, refundPiasters: amountPiasters, cashDirection };
  return { codAmountPiasters: amountPiasters, refundPiasters: 0, cashDirection: cashDirection ?? null };
}

async function uniqueOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < MAX_ORDER_NUMBER_TRIES; attempt += 1) {
    const number = generateOrderNumber();
    if (!(await tx.order.findUnique({ where: { number }, select: { id: true } }))) return number;
  }
  throw new Error('Could not find a free order number after several tries; try again.');
}

export async function createOrder(
  user: SessionUser,
  merchantId: string,
  rawInput: CreateOrderInput,
  idempotencyKey: string,
): Promise<{ id: string; number: string }> {
  requireMerchantAccess(user, merchantId, 'orders');
  const parsed = CreateOrderSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError('invalid_input');
  const input = parsed.data;
  const customerMobile = normalizeEgyptianMobile(input.customerMobile);
  const size: PackageSize = PARCEL_FREE_TYPES.has(input.type) ? 'small' : input.size;
  const allowOpenPackage = input.type === 'pick_and_choose' || (!NO_OPEN_PACKAGE_TYPES.has(input.type) && input.allowOpenPackage);
  const money = moneyFields(input.type, input.codAmountPiasters, input.cashDirection);
  const insuredValuePiasters = input.type === 'cash_collection' ? 0 : input.insuredValuePiasters;

  const fees = await quoteOrderFees({
    merchantId,
    areaId: input.areaId,
    size,
    orderType: input.type,
    codAmountPiasters: money.codAmountPiasters,
    allowOpenPackage,
    insuredValuePiasters,
  });

  const products = input.productIds
    ? await db.product.findMany({ where: { id: { in: input.productIds }, merchantId, isActive: true } })
    : [];
  if (input.type === 'pick_and_choose' && products.length !== input.productIds?.length) throw new AppError('invalid_input');

  const linkedOrder = input.linkedOrderNumber
    ? await db.order.findFirst({ where: { number: input.linkedOrderNumber, merchantId }, select: { id: true } })
    : null;
  if (input.linkedOrderNumber && !linkedOrder) throw new AppError('not_found', 404);

  const returnLocation = await db.pickupLocation.findFirst({ where: { merchantId, isDefault: true }, select: { id: true } });

  return runOnce(idempotencyKey, `order.create:${merchantId}`, async (tx) => {
    const customer = await tx.customer.upsert({
      where: { merchantId_mobile: { merchantId, mobile: customerMobile } },
      create: { merchantId, mobile: customerMobile, name: input.customerName, lastAddressText: input.addressText, lastAreaId: input.areaId },
      update: { name: input.customerName, lastAddressText: input.addressText, lastAreaId: input.areaId },
    });
    const order = await tx.order.create({
      data: {
        number: await uniqueOrderNumber(tx),
        merchantId,
        type: input.type,
        customerId: customer.id,
        customerName: input.customerName,
        customerMobile,
        addressText: input.addressText,
        addressExtra: input.addressExtra,
        areaId: input.areaId,
        size,
        description: input.description,
        ...money,
        allowOpenPackage,
        depositRequired: input.type === 'deliver' || input.type === 'pick_and_choose' || input.type === 'exchange' ? input.depositRequired : false,
        insuredValuePiasters,
        shippingPiasters: fees.shippingPiasters,
        openPackagePiasters: fees.openPackagePiasters,
        codFeePiasters: fees.codFeePiasters,
        insurancePiasters: fees.insurancePiasters,
        vatPiasters: fees.vatPiasters,
        totalFeePiasters: fees.totalPiasters,
        merchantReference: input.merchantReference,
        courierNote: input.courierNote,
        returnLocationId: returnLocation?.id ?? null,
        createdBy: user.id,
        items: {
          create: products.map((product) => ({ productId: product.id, nameEn: product.nameEn, nameAr: product.nameAr, pricePiasters: product.pricePiasters })),
        },
      },
      select: { id: true, number: true },
    });
    if (linkedOrder) await tx.orderLink.create({ data: { fromOrderId: order.id, toOrderId: linkedOrder.id, kind: input.type } });
    await tx.orderEvent.create({ data: { orderId: order.id, kind: 'created', toStatus: 'new', actorUserId: user.id } });
    await writeAudit(tx, {
      actorUserId: user.id,
      action: 'order.created',
      entityType: 'Order',
      entityId: order.id,
      before: null,
      after: { number: order.number, type: input.type, totalFeePiasters: fees.totalPiasters },
    });
    return order;
  });
}
