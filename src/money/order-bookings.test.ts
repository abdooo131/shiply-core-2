import type { OrderStatus } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@/accounts';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { changeOrderStatus, createOrder, type CreateOrderInput } from '@/orders';
import { seedPricingDefaults } from '@/pricing/pricing-test-fixtures';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { accountBalance, LEDGER_ACCOUNTS, walletAccount } from './ledger';

const TO_DELIVERED: OrderStatus[] = ['picked_up', 'in_progress', 'out_for_delivery', 'delivered'];
const TO_RETURNED: OrderStatus[] = ['picked_up', 'in_progress', 'returning', 'returned'];

let nasrCityId = '';
let merchantId = '';
let owner: SessionUser;
let staff: SessionUser;
let keyCounter = 0;

beforeAll(async () => {
  nasrCityId = (await db.area.findFirstOrThrow({ where: { nameEn: 'Nasr City' } })).id;
});

beforeEach(async () => {
  await resetTestDatabase();
  await seedPricingDefaults();
  merchantId = (await makeMerchant()).id;
  owner = await makeSessionUser({ merchantId, access: 'full' });
  staff = await makeSessionUser({ staffRole: 'operations' });
});

async function order(input: Partial<CreateOrderInput> & Pick<CreateOrderInput, 'type'>) {
  return createOrder(
    owner,
    merchantId,
    {
      customerName: 'Mona',
      customerMobile: '01001234567',
      addressText: '12 Abbas El Akkad St',
      areaId: nasrCityId,
      size: 'small',
      codAmountPiasters: 0,
      allowOpenPackage: false,
      depositRequired: false,
      insuredValuePiasters: 0,
      ...input,
    },
    `k-${(keyCounter += 1)}`,
  );
}

async function move(orderId: string, path: OrderStatus[]) {
  for (const status of path) await changeOrderStatus(staff, orderId, status);
}

const wallet = () => accountBalance(walletAccount(merchantId));

describe('order bookings', () => {
  it('delivered with cash: the wallet is owed the cash minus Shiply fees, revenue and VAT are booked', async () => {
    const { id } = await order({ type: 'deliver', codAmountPiasters: 150000, allowOpenPackage: true });
    await move(id, TO_DELIVERED);
    // Fees: shipping 6800 + open package 700 = 7500 net, VAT 1050, total 8550.
    expect(await wallet()).toBe(-(150000 - 8550));
    expect(await accountBalance(LEDGER_ACCOUNTS.cashInTransit)).toBe(150000);
    expect(await accountBalance(LEDGER_ACCOUNTS.revenueShipping)).toBe(-6800);
    expect(await accountBalance(LEDGER_ACCOUNTS.revenueFees)).toBe(-700);
    expect(await accountBalance(LEDGER_ACCOUNTS.vatPayable)).toBe(-1050);
  });

  it('includes the COD fee on cash above EGP 3,000', async () => {
    const { id } = await order({ type: 'deliver', codAmountPiasters: 500000 });
    await move(id, TO_DELIVERED);
    // 6800 shipping + 2000 COD fee = 8800 net, VAT 1232, total 10032.
    expect(await wallet()).toBe(-(500000 - 10032));
    expect(await accountBalance(LEDGER_ACCOUNTS.revenueFees)).toBe(-2000);
  });

  it('a prepaid delivery only charges fees, leaving the merchant owing Shiply', async () => {
    const { id } = await order({ type: 'deliver' });
    await move(id, TO_DELIVERED);
    expect(await wallet()).toBe(7752);
    expect(await accountBalance(LEDGER_ACCOUNTS.cashInTransit)).toBe(0);
  });

  it('cash given to a customer and refunds are taken from the wallet', async () => {
    const give = await order({ type: 'cash_collection', cashDirection: 'give', codAmountPiasters: 50000 });
    await move(give.id, TO_DELIVERED);
    // Cash collection in Cairo: 5500 + VAT 770 = 6270.
    expect(await wallet()).toBe(50000 + 6270);
    expect(await accountBalance(LEDGER_ACCOUNTS.cashInTransit)).toBe(-50000);
  });

  it('returned to the merchant: shipping plus a 50% return fee, with VAT on both, and no cash', async () => {
    const { id } = await order({ type: 'deliver', codAmountPiasters: 150000 });
    await move(id, TO_RETURNED);
    // Shipping 6800 + return fee 3400 = 10200, VAT 1428, total 11628.
    expect(await wallet()).toBe(11628);
    expect(await accountBalance(LEDGER_ACCOUNTS.revenueReturnFees)).toBe(-3400);
    expect(await accountBalance(LEDGER_ACCOUNTS.cashInTransit)).toBe(0);
  });

  it('rounds half up and still balances for odd amounts', async () => {
    await db.priceListLine.updateMany({ where: { zoneCode: 'cairo_giza', size: 'small', orderType: 'deliver' }, data: { shippingPiasters: 6801 } });
    const { id } = await order({ type: 'deliver' });
    await move(id, TO_RETURNED);
    // 6801 + 3401 (half up) = 10202, VAT 1428.28 → 1428, total 11630.
    expect(await wallet()).toBe(11630);
    const sums = await db.ledgerLine.groupBy({ by: ['entryId'], _sum: { amountPiasters: true } });
    expect(sums.every((row) => row._sum.amountPiasters === 0)).toBe(true);
  });

  it('books a delivery once even if the status change is retried', async () => {
    const { id } = await order({ type: 'deliver', codAmountPiasters: 150000 });
    await move(id, ['picked_up', 'in_progress', 'out_for_delivery']);
    const results = await Promise.allSettled([changeOrderStatus(staff, id, 'delivered'), changeOrderStatus(staff, id, 'delivered')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.ledgerEntry.count({ where: { orderId: id } })).toBe(1);
    expect(await wallet()).toBe(-(150000 - 7752));
  });

  it('books nothing for a canceled order', async () => {
    const { id } = await order({ type: 'deliver', codAmountPiasters: 150000 });
    await changeOrderStatus(owner, id, 'canceled');
    expect(await db.ledgerEntry.count()).toBe(0);
  });
});
