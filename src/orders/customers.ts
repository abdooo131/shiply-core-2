import { requireMerchantAccess, type SessionUser } from '@/accounts';
import { db } from '@/shared/db';
import { normalizeEgyptianMobile } from '@/shared/egyptian-mobile';

export type KnownCustomer = { name: string; addressText: string; areaId: string | null; orderCount: number };

// For the "returning customer" offer on Create order.
export async function findCustomerByMobile(user: SessionUser, merchantId: string, mobileInput: string): Promise<KnownCustomer | null> {
  requireMerchantAccess(user, merchantId, 'orders');
  let mobile: string;
  try {
    mobile = normalizeEgyptianMobile(mobileInput);
  } catch {
    return null;
  }
  const customer = await db.customer.findUnique({
    where: { merchantId_mobile: { merchantId, mobile } },
    select: { name: true, lastAddressText: true, lastAreaId: true, _count: { select: { orders: true } } },
  });
  if (!customer) return null;
  return { name: customer.name, addressText: customer.lastAddressText, areaId: customer.lastAreaId, orderCount: customer._count.orders };
}
