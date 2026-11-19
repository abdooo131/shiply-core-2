import { beforeEach, describe, expect, it } from 'vitest';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { insertTestOrder } from '@/orders/orders-test-fixtures';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import {
  countStaffQueues,
  getStaffTicket,
  isStaff,
  listPendingBankAccounts,
  listPendingPriceLists,
  listScheduledPickups,
  listStaffCashOuts,
  listStaffOrders,
  listStaffTickets,
  STAFF_PAGE_SIZE,
  staffSections,
} from './staff-queues';

async function insertTicket(merchantId: string, status: 'open' | 'answered' | 'closed', number: string) {
  return db.supportTicket.create({
    data: {
      number,
      merchantId,
      createdBy: '00000000-0000-0000-0000-000000000000',
      topic: 'other',
      subject: `Subject ${number}`,
      status,
      messages: { create: { authorUserId: '00000000-0000-0000-0000-000000000000', authorKind: 'merchant', body: 'Hello' } },
    },
  });
}

describe('staff queues', () => {
  beforeEach(resetTestDatabase);

  it('tells staff from merchants and lists only the sections each role may use', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const operations = await makeSessionUser({ staffRole: 'operations' });
    const finance = await makeSessionUser({ staffRole: 'finance' });
    const admin = await makeSessionUser({ staffRole: 'admin' });
    expect(isStaff(owner)).toBe(false);
    expect(isStaff(operations)).toBe(true);
    expect(staffSections(operations)).toEqual(['orders', 'pickups', 'support']);
    expect(staffSections(finance)).toEqual(['approvals', 'money', 'support']);
    expect(staffSections(admin)).toEqual(['orders', 'pickups', 'approvals', 'money', 'support']);
  });

  it('lists orders of every merchant for operations, filtered by status and number', async () => {
    const first = await makeMerchant('First Shop', 'المتجر الأول');
    const second = await makeMerchant('Second Shop', 'المتجر الثاني');
    const a = await insertTestOrder(first.id);
    const b = await insertTestOrder(second.id);
    await db.order.update({ where: { id: b.id }, data: { status: 'picked_up' } });
    const operations = await makeSessionUser({ staffRole: 'operations' });

    const all = await listStaffOrders(operations, { page: 1 });
    expect(all.total).toBe(2);
    const picked = await listStaffOrders(operations, { status: 'picked_up', page: 1 });
    expect(picked.rows.map((row) => row.number)).toEqual([b.number]);
    expect(picked.rows[0]).toMatchObject({ merchantNameEn: 'Second Shop', status: 'picked_up', nextStatuses: ['in_progress'] });
    const found = await listStaffOrders(operations, { search: a.number, page: 1 });
    expect(found.rows.map((row) => row.id)).toEqual([a.id]);
  });

  it('pages the order list', async () => {
    const merchant = await makeMerchant();
    for (let index = 0; index < STAFF_PAGE_SIZE + 1; index += 1) await insertTestOrder(merchant.id, { customerMobile: `+2010012345${String(index).padStart(2, '0')}` });
    const admin = await makeSessionUser({ staffRole: 'admin' });
    const second = await listStaffOrders(admin, { page: 2 });
    expect(second).toMatchObject({ page: 2, pageCount: 2, total: STAFF_PAGE_SIZE + 1 });
    expect(second.rows).toHaveLength(1);
  });

  it('refuses each list to roles that may not use it', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const finance = await makeSessionUser({ staffRole: 'finance' });
    const operations = await makeSessionUser({ staffRole: 'operations' });
    await expect(listStaffOrders(owner, { page: 1 })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listStaffOrders(finance, { page: 1 })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listScheduledPickups(finance)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listPendingBankAccounts(operations)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listPendingPriceLists(operations)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listStaffCashOuts(operations, { status: 'prepared' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listStaffTickets(owner, { status: 'open', page: 1 })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(countStaffQueues(owner)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lists scheduled pickups with the orders attached to them', async () => {
    const merchant = await makeMerchant();
    const location = await db.pickupLocation.create({
      data: { merchantId: merchant.id, label: 'Warehouse', addressText: '1 Nile St', contactName: 'Ali', contactMobile: '+201001234567' },
    });
    const order = await insertTestOrder(merchant.id);
    await db.order.update({ where: { id: order.id }, data: { status: 'pickup_requested' } });
    const pickup = await db.pickup.create({
      data: {
        number: 'P1234567', merchantId: merchant.id, locationId: location.id, addressText: '1 Nile St', contactName: 'Ali',
        contactMobile: '+201001234567', pickupDate: new Date('2026-11-20T00:00:00Z'), expectedCount: 1, createdBy: order.createdBy,
        orders: { create: { orderId: order.id } },
      },
    });
    await db.pickup.create({
      data: {
        number: 'P7654321', merchantId: merchant.id, locationId: location.id, addressText: '1 Nile St', contactName: 'Ali',
        contactMobile: '+201001234567', pickupDate: new Date('2026-11-19T00:00:00Z'), expectedCount: 0, status: 'canceled', createdBy: order.createdBy,
      },
    });
    const operations = await makeSessionUser({ staffRole: 'operations' });
    const pickups = await listScheduledPickups(operations);
    expect(pickups.map((row) => row.id)).toEqual([pickup.id]);
    expect(pickups[0]).toMatchObject({ merchantNameEn: 'Nile Threads', pickupDate: '2026-11-20', orders: [{ id: order.id, number: order.number }] });
  });

  it('lists pending bank accounts and price lists for finance, never the full IBAN', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    await db.bankAccount.create({
      data: { merchantId: merchant.id, bankName: 'Nile Bank', holderName: 'Shop LLC', ibanLast4: '0002', ibanEncrypted: 'v1:secret', requestedBy: owner.id },
    });
    await db.priceList.create({
      data: { merchantId: merchant.id, version: 2, requestedBy: owner.id, lines: { create: [{ zoneCode: 'cairo_giza', size: 'small', orderType: 'deliver', shippingPiasters: 6000 }] } },
    });
    const finance = await makeSessionUser({ staffRole: 'finance' });
    const banks = await listPendingBankAccounts(finance);
    expect(banks).toEqual([expect.objectContaining({ merchantNameEn: 'Nile Threads', bankName: 'Nile Bank', ibanMasked: expect.stringContaining('0002'), requestedBy: owner.id })]);
    expect(JSON.stringify(banks)).not.toContain('v1:secret');
    const lists = await listPendingPriceLists(finance);
    expect(lists).toEqual([expect.objectContaining({ merchantNameEn: 'Nile Threads', version: 2, lineCount: 1 })]);
  });

  it('lists cash-outs by status with the merchant name', async () => {
    const merchant = await makeMerchant();
    const finance = await makeSessionUser({ staffRole: 'finance' });
    const bank = await db.bankAccount.create({
      data: { merchantId: merchant.id, bankName: 'Nile Bank', holderName: 'Shop LLC', ibanLast4: '0002', ibanEncrypted: 'x', status: 'active', requestedBy: finance.id },
    });
    await db.cashOut.create({
      data: { number: 'C100001', merchantId: merchant.id, bankAccountId: bank.id, amountPiasters: 150000, scheduledDate: new Date('2026-11-19T00:00:00Z'), preparedBy: finance.id },
    });
    const rows = await listStaffCashOuts(finance, { status: 'prepared' });
    expect(rows).toEqual([expect.objectContaining({ number: 'C100001', merchantNameEn: 'Nile Threads', amountPiasters: 150000, bankName: 'Nile Bank', scheduledDate: '2026-11-19', preparedBy: finance.id })]);
    expect(await listStaffCashOuts(finance, { status: 'paid' })).toEqual([]);
  });

  it('lists tickets waiting for staff and opens a thread from any merchant', async () => {
    const merchant = await makeMerchant();
    const open = await insertTicket(merchant.id, 'open', 'T100001');
    await insertTicket(merchant.id, 'answered', 'T100002');
    await insertTicket(merchant.id, 'closed', 'T100003');
    const operations = await makeSessionUser({ staffRole: 'operations' });
    const waiting = await listStaffTickets(operations, { status: 'open', page: 1 });
    expect(waiting.rows.map((row) => row.number)).toEqual(['T100001']);
    expect(waiting.rows[0]).toMatchObject({ merchantNameEn: 'Nile Threads' });
    const thread = await getStaffTicket(operations, open.id);
    expect(thread).toMatchObject({ number: 'T100001', merchantNameEn: 'Nile Threads', messages: [expect.objectContaining({ body: 'Hello', authorKind: 'merchant' })] });
    await expect(getStaffTicket(operations, '00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({ code: 'not_found' });
    await expect(getStaffTicket(operations, 'not-a-uuid')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('counts what is waiting, only for sections the role may use', async () => {
    const merchant = await makeMerchant();
    await insertTestOrder(merchant.id);
    await insertTicket(merchant.id, 'open', 'T100001');
    const operations = await makeSessionUser({ staffRole: 'operations' });
    const counts = await countStaffQueues(operations);
    expect(counts).toMatchObject({ ordersOpen: 1, pickupsScheduled: 0, ticketsOpen: 1 });
    expect(counts.bankPending).toBeNull();
    expect(counts.cashOutsOpen).toBeNull();
  });
});
