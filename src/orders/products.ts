import { z } from 'zod';
import { requireMerchantAccess, type SessionUser } from '@/accounts';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';

export type ProductView = { id: string; nameEn: string; nameAr: string; pricePiasters: number; isActive: boolean };

// A catalogue is small (a merchant's own items); the cap keeps the list bounded.
const MAX_LISTED_PRODUCTS = 500;
const PRODUCT_FIELDS = { id: true, nameEn: true, nameAr: true, pricePiasters: true, isActive: true } as const;

const ProductInput = z.object({
  id: z.string().uuid().optional(),
  nameEn: z.string().trim().min(1).max(120),
  nameAr: z.string().trim().min(1).max(120),
  pricePiasters: z.number().int().min(0).max(100_000_000),
});

export async function listProducts(user: SessionUser, merchantId: string, options: { includeInactive?: boolean } = {}): Promise<ProductView[]> {
  requireMerchantAccess(user, merchantId, 'orders');
  return db.product.findMany({
    where: { merchantId, ...(options.includeInactive ? {} : { isActive: true }) },
    select: PRODUCT_FIELDS,
    orderBy: [{ isActive: 'desc' }, { nameEn: 'asc' }],
    take: MAX_LISTED_PRODUCTS,
  });
}

async function requireOwnProduct(merchantId: string, productId: string): Promise<void> {
  const product = await db.product.findFirst({ where: { id: productId, merchantId }, select: { id: true } });
  if (!product) throw new AppError('not_found', 404);
}

export async function saveProduct(user: SessionUser, merchantId: string, input: z.input<typeof ProductInput>): Promise<ProductView> {
  requireMerchantAccess(user, merchantId, 'orders');
  const parsed = ProductInput.safeParse(input);
  if (!parsed.success) throw new AppError('invalid_input');
  const { id, ...fields } = parsed.data;
  if (!id) return db.product.create({ data: { ...fields, merchantId }, select: PRODUCT_FIELDS });
  await requireOwnProduct(merchantId, id);
  return db.product.update({ where: { id }, data: fields, select: PRODUCT_FIELDS });
}

export async function setProductActive(user: SessionUser, merchantId: string, productId: string, isActive: boolean): Promise<void> {
  requireMerchantAccess(user, merchantId, 'orders');
  await requireOwnProduct(merchantId, productId);
  await db.product.update({ where: { id: productId }, data: { isActive } });
}
