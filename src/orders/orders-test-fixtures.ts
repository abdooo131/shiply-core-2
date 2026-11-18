import { db } from '@/shared/db';
import { generateOrderNumber } from './order-number';

// A minimal stored order, for tests that need one without going through createOrder.
export async function insertTestOrder(merchantId: string, overrides: { customerMobile?: string; customerName?: string; status?: 'new' } = {}) {
  const area = await db.area.findFirstOrThrow({ where: { nameEn: 'Nasr City' } });
  const customerMobile = overrides.customerMobile ?? '+201001234567';
  const customer = await db.customer.upsert({
    where: { merchantId_mobile: { merchantId, mobile: customerMobile } },
    create: { merchantId, mobile: customerMobile, name: overrides.customerName ?? 'Mona Ali', lastAddressText: '12 Abbas El Akkad St', lastAreaId: area.id },
    update: {},
  });
  return db.order.create({
    data: {
      number: generateOrderNumber(),
      merchantId,
      type: 'deliver',
      status: overrides.status ?? 'new',
      customerId: customer.id,
      customerName: customer.name,
      customerMobile,
      addressText: '12 Abbas El Akkad St',
      areaId: area.id,
      size: 'small',
      shippingPiasters: 6800,
      vatPiasters: 952,
      totalFeePiasters: 7752,
      createdBy: '00000000-0000-0000-0000-000000000000',
    },
  });
}
