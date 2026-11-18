import type { OrderStatus } from '@prisma/client';
import type { SessionUser } from '@/accounts';
import { changeOrderStatus, createOrder } from '@/orders';
import { db } from '@/shared/db';

const TO_DELIVERED: OrderStatus[] = ['picked_up', 'in_progress', 'out_for_delivery', 'delivered'];
let keyCounter = 0;

// Creates an order and moves it to delivered through the real status path (so money is booked).
export async function deliverTestOrder(owner: SessionUser, staff: SessionUser, merchantId: string, codAmountPiasters: number) {
  const area = await db.area.findFirstOrThrow({ where: { nameEn: 'Nasr City' } });
  const { id } = await createOrder(
    owner,
    merchantId,
    {
      type: 'deliver',
      customerName: 'Mona',
      customerMobile: '01001234567',
      addressText: '12 Abbas El Akkad St',
      areaId: area.id,
      size: 'small',
      codAmountPiasters,
      allowOpenPackage: false,
      depositRequired: false,
      insuredValuePiasters: 0,
    },
    `money-fixture-${(keyCounter += 1)}-${Date.now()}`,
  );
  for (const status of TO_DELIVERED) await changeOrderStatus(staff, id, status);
  return id;
}

export async function addActiveBankAccount(merchantId: string, requestedBy: string) {
  return db.bankAccount.create({
    data: { merchantId, bankName: 'Nile Bank', holderName: 'Shop LLC', ibanLast4: '0002', ibanEncrypted: 'v1:x:y:z', status: 'active', requestedBy },
  });
}
