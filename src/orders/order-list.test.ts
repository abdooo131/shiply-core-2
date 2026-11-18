import type { OrderStatus, OrderType } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@/accounts';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { cairoDayStartUtc } from '@/shared/cairo-time';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { ORDER_TABS, TAB_STATUSES } from './merchant-status';
import { generateOrderNumber } from './order-number';
import { EGYPT_GOVERNORATE_CODES, PAGE_SIZE, listOrders, parseOrderListQuery, toQueryString, type OrderListQuery } from './order-list';

const DAY_MS = 86_400_000;
const NOW = new Date('2026-11-18T10:00:00Z');

let nasrCityId = '';
let gizaAreaId = '';
let alexAreaId = '';
let merchantId = '';
let owner: SessionUser;

type TestOrder = {
  status?: OrderStatus;
  type?: OrderType;
  customerName?: string;
  customerMobile?: string;
  merchantReference?: string;
  codAmountPiasters?: number;
  attempts?: number;
  areaId?: string;
  createdAt?: Date;
  updatedAt?: Date;
  forMerchantId?: string;
  number?: string;
};

async function addOrder(options: TestOrder = {}) {
  const owningMerchantId = options.forMerchantId ?? merchantId;
  const mobile = options.customerMobile ?? '+201001234567';
  const areaId = options.areaId ?? nasrCityId;
  const customer = await db.customer.upsert({
    where: { merchantId_mobile: { merchantId: owningMerchantId, mobile } },
    create: { merchantId: owningMerchantId, mobile, name: options.customerName ?? 'Ahmed Samir', lastAddressText: '1 Street', lastAreaId: areaId },
    update: {},
  });
  const createdAt = options.createdAt ?? new Date(NOW.getTime() - DAY_MS);
  return db.order.create({
    data: {
      number: options.number ?? generateOrderNumber(),
      merchantId: owningMerchantId,
      type: options.type ?? 'deliver',
      status: options.status ?? 'new',
      customerId: customer.id,
      customerName: options.customerName ?? 'Ahmed Samir',
      customerMobile: mobile,
      addressText: '1 Street',
      areaId,
      size: 'small',
      codAmountPiasters: options.codAmountPiasters ?? 0,
      attempts: options.attempts ?? 0,
      merchantReference: options.merchantReference ?? null,
      shippingPiasters: 6800,
      vatPiasters: 952,
      totalFeePiasters: 7752,
      createdBy: '00000000-0000-0000-0000-000000000000',
      createdAt,
      updatedAt: options.updatedAt ?? createdAt,
    },
  });
}

const query = (params: Record<string, string> = {}): OrderListQuery => parseOrderListQuery(params);
const list = (params: Record<string, string> = {}) => listOrders(owner, merchantId, query(params), NOW);

beforeAll(async () => {
  nasrCityId = (await db.area.findFirstOrThrow({ where: { nameEn: 'Nasr City' } })).id;
  gizaAreaId = (await db.area.findFirstOrThrow({ where: { governorateCode: 'GZ' } })).id;
  alexAreaId = (await db.area.findFirstOrThrow({ where: { governorateCode: 'ALX' } })).id;
});

beforeEach(async () => {
  await resetTestDatabase();
  merchantId = (await makeMerchant()).id;
  owner = await makeSessionUser({ merchantId, access: 'full' });
});

describe('parseOrderListQuery', () => {
  it('fills safe defaults when nothing is given', () => {
    expect(parseOrderListQuery({})).toEqual({
      tab: 'all',
      q: '',
      date: 'any',
      gov: [],
      type: [],
      pay: 'any',
      tries: 'any',
      sort: 'updated',
      page: 1,
    });
  });

  it('falls back to defaults for garbage and never throws', () => {
    const parsed = parseOrderListQuery({ page: '-5', tab: 'xyz', gov: 'ZZ', sort: '1', date: 'yesterday', pay: 'maybe', tries: '9', type: 'drone' });
    expect(parsed).toEqual(parseOrderListQuery({}));
    expect(parseOrderListQuery({ page: 'abc' }).page).toBe(1);
    expect(parseOrderListQuery({ page: '2.5' }).page).toBe(1);
    expect(parseOrderListQuery({ page: ['3', '4'] }).page).toBe(3);
  });

  it('keeps known list members, drops unknown ones and trims search to 80 characters', () => {
    const parsed = parseOrderListQuery({ gov: 'GZ,ZZ,C,C', type: 'exchange,drone,deliver', q: `  ${'x'.repeat(100)}  ` });
    expect(parsed.gov).toEqual(['C', 'GZ']);
    expect(parsed.type).toEqual(['deliver', 'exchange']);
    expect(parsed.q).toHaveLength(80);
  });

  it('knows all 27 governorates from the reference data', async () => {
    const codes = (await db.governorate.findMany({ select: { code: true } })).map((row) => row.code);
    expect([...EGYPT_GOVERNORATE_CODES].sort()).toEqual(codes.sort());
  });
});

describe('toQueryString', () => {
  it('writes only non-default values and round-trips through parse', () => {
    expect(toQueryString(parseOrderListQuery({}))).toBe('');
    const params = { tab: 'delivered', q: 'منى', date: '7d', gov: 'GZ,C', type: 'exchange', pay: 'cod', tries: 'some', sort: 'cash', page: '2' };
    const parsed = parseOrderListQuery(params);
    const text = toQueryString(parsed);
    expect(parseOrderListQuery(Object.fromEntries(new URLSearchParams(text)))).toEqual(parsed);
    expect(text.startsWith('tab=delivered&q=')).toBe(true);
    expect(toQueryString(parseOrderListQuery({ sort: 'updated', page: '1', tab: 'all' }))).toBe('');
  });
});

describe('listOrders', () => {
  it('each tab returns its statuses', async () => {
    const statuses: OrderStatus[] = ['new', 'pickup_requested', 'picked_up', 'in_progress', 'out_for_delivery', 'attempt_failed', 'awaiting_merchant_action', 'rescheduled', 'delivered', 'returning', 'returned', 'canceled'];
    for (const status of statuses) await addOrder({ status });

    for (const tab of ORDER_TABS) {
      const result = await list({ tab });
      expect(result.orders.map((order) => order.status).sort(), tab).toEqual([...TAB_STATUSES[tab]].sort());
    }
    expect((await list({ tab: 'needs_action' })).orders.map((order) => order.status)).toEqual(['awaiting_merchant_action']);
  });

  it('not printed leaves out orders that have a label print', async () => {
    const printed = await addOrder();
    const notPrinted = await addOrder();
    await db.labelPrint.create({ data: { orderId: printed.id, format: 'a6', printedBy: owner.id } });

    const result = await list({ tab: 'not_printed' });
    expect(result.orders.map((order) => order.id)).toEqual([notPrinted.id]);
    const all = await list();
    expect(all.orders.find((order) => order.id === printed.id)?.isPrinted).toBe(true);
    expect(all.orders.find((order) => order.id === notPrinted.id)?.isPrinted).toBe(false);
  });

  it('returns the row fields the table needs', async () => {
    const order = await addOrder({ status: 'awaiting_merchant_action', codAmountPiasters: 150000, attempts: 2 });
    const [row] = (await list()).orders;
    expect(row).toMatchObject({
      id: order.id,
      number: order.number,
      type: 'deliver',
      status: 'awaiting_merchant_action',
      merchantStatus: 'awaiting_merchant_action',
      tone: 'bad',
      customerName: 'Ahmed Samir',
      customerMobile: '+201001234567',
      areaNameEn: 'Nasr City',
      governorateCode: 'C',
      codAmountPiasters: 150000,
      totalFeePiasters: 7752,
      attempts: 2,
      isPrinted: false,
    });
    expect(row?.areaNameAr).toBeTruthy();
  });

  it('filters by created date in Cairo days', async () => {
    const todayStart = cairoDayStartUtc(NOW);
    const today = await addOrder({ createdAt: new Date(todayStart.getTime() + 60_000) });
    const yesterday = await addOrder({ createdAt: new Date(todayStart.getTime() - 60_000) });
    const tenDaysAgo = await addOrder({ createdAt: new Date(NOW.getTime() - 10 * DAY_MS) });
    await addOrder({ createdAt: new Date(NOW.getTime() - 40 * DAY_MS) });

    const ids = async (date: string) => (await list({ date })).orders.map((order) => order.id).sort();
    expect(await ids('today')).toEqual([today.id]);
    expect(await ids('7d')).toEqual([today.id, yesterday.id].sort());
    expect(await ids('30d')).toEqual([today.id, yesterday.id, tenDaysAgo.id].sort());
    expect((await list({ date: 'any' })).total).toBe(4);
  });

  it('filters by governorate, type, payment and attempts', async () => {
    const giza = await addOrder({ areaId: gizaAreaId, codAmountPiasters: 50000 });
    const alex = await addOrder({ areaId: alexAreaId, type: 'exchange', attempts: 1 });
    const cairo = await addOrder({ attempts: 3, type: 'return' });
    const twoTries = await addOrder({ attempts: 2, codAmountPiasters: 100 });

    const ids = async (params: Record<string, string>) => (await list(params)).orders.map((order) => order.id).sort();
    expect(await ids({ gov: 'GZ' })).toEqual([giza.id]);
    expect(await ids({ gov: 'GZ,ALX' })).toEqual([giza.id, alex.id].sort());
    expect(await ids({ type: 'exchange,return' })).toEqual([alex.id, cairo.id].sort());
    expect(await ids({ pay: 'cod' })).toEqual([giza.id, twoTries.id].sort());
    expect(await ids({ pay: 'prepaid' })).toEqual([alex.id, cairo.id].sort());
    expect(await ids({ tries: '0' })).toEqual([giza.id]);
    expect(await ids({ tries: 'some' })).toEqual([alex.id, twoTries.id].sort());
    expect(await ids({ tries: '3' })).toEqual([cairo.id]);
  });

  it('searches by order number, Arabic name, reference and mobile in any format', async () => {
    const mona = await addOrder({ customerName: 'منى علي', customerMobile: '+201001234567', number: '4123456789' });
    const other = await addOrder({ customerName: 'Karim Adel', customerMobile: '+201112223334', merchantReference: 'NT-40012', number: '5987654321' });

    const ids = async (q: string) => (await list({ q })).orders.map((order) => order.id);
    expect(await ids('منى')).toEqual([mona.id]);
    expect(await ids('karim')).toEqual([other.id]);
    expect(await ids('4123456789')).toEqual([mona.id]);
    expect(await ids('59876')).toEqual([other.id]);
    expect(await ids('nt-400')).toEqual([other.id]);
    expect(await ids('01001234567')).toEqual([mona.id]);
    expect(await ids('+20 100 123 4567')).toEqual([mona.id]);
    expect(await ids('00201001234567')).toEqual([mona.id]);
    expect(await ids('nobody')).toEqual([]);
  });

  it('sorts by last updated, newest, oldest and highest cash', async () => {
    const a = await addOrder({ createdAt: new Date(NOW.getTime() - 3 * DAY_MS), updatedAt: new Date(NOW.getTime() - 1000), codAmountPiasters: 100 });
    const b = await addOrder({ createdAt: new Date(NOW.getTime() - 2 * DAY_MS), updatedAt: new Date(NOW.getTime() - 3000), codAmountPiasters: 900 });
    const c = await addOrder({ createdAt: new Date(NOW.getTime() - 1 * DAY_MS), updatedAt: new Date(NOW.getTime() - 2000), codAmountPiasters: 500 });

    const ids = async (sort: string) => (await list({ sort })).orders.map((order) => order.id);
    expect(await ids('updated')).toEqual([a.id, c.id, b.id]);
    expect(await ids('new')).toEqual([c.id, b.id, a.id]);
    expect(await ids('old')).toEqual([a.id, b.id, c.id]);
    expect(await ids('cash')).toEqual([b.id, c.id, a.id]);
  });

  it('pages 25 at a time and clamps a page past the end to the last page', async () => {
    for (let index = 0; index < 30; index += 1) await addOrder({ updatedAt: new Date(NOW.getTime() - index * 1000) });

    const first = await list();
    expect(PAGE_SIZE).toBe(25);
    expect(first).toMatchObject({ total: 30, page: 1, pageCount: 2 });
    expect(first.orders).toHaveLength(25);

    const second = await list({ page: '2' });
    expect(second.orders).toHaveLength(5);
    expect(second.page).toBe(2);

    const beyond = await list({ page: '99' });
    expect(beyond.page).toBe(2);
    expect(beyond.orders.map((order) => order.id)).toEqual(second.orders.map((order) => order.id));
  });

  it('an empty list is page 1 of 1', async () => {
    const result = await list({ page: '7' });
    expect(result).toMatchObject({ orders: [], total: 0, page: 1, pageCount: 1 });
  });

  it('garbage parameters still return the default list', async () => {
    await addOrder();
    const result = await list({ page: '-5', tab: 'xyz', gov: 'ZZ', sort: '1' });
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
  });

  it('tab counts respect filters and search and match the list lengths', async () => {
    await addOrder({ status: 'new', areaId: gizaAreaId, customerName: 'منى علي' });
    await addOrder({ status: 'delivered', areaId: gizaAreaId, customerName: 'منى علي' });
    await addOrder({ status: 'delivered', areaId: gizaAreaId, customerName: 'Karim' });
    await addOrder({ status: 'delivered', customerName: 'منى علي' });
    const printed = await addOrder({ status: 'returning', areaId: gizaAreaId, customerName: 'منى حسن' });
    await db.labelPrint.create({ data: { orderId: printed.id, format: 'a4', printedBy: owner.id } });

    const filters = { gov: 'GZ', q: 'منى' };
    const { tabCounts } = await list(filters);
    expect(tabCounts).toMatchObject({ all: 3, new: 1, delivered: 1, coming_back: 1, not_printed: 2, canceled: 0, needs_action: 0 });
    for (const tab of ORDER_TABS) {
      const result = await list({ ...filters, tab });
      expect(result.orders.length, tab).toBe(tabCounts[tab]);
      expect(result.total, tab).toBe(tabCounts[tab]);
    }
  });

  it("never shows another merchant's orders", async () => {
    const otherMerchant = await makeMerchant('Other Shop', 'محل آخر');
    await addOrder({ forMerchantId: otherMerchant.id, customerName: 'منى علي' });
    const mine = await addOrder({ customerName: 'منى علي' });

    const result = await list({ q: 'منى' });
    expect(result.orders.map((order) => order.id)).toEqual([mine.id]);
    expect(result.tabCounts.all).toBe(1);
  });

  it('refuses a finance-only member and a member of another merchant', async () => {
    const financeOnly = await makeSessionUser({ merchantId, access: 'finance' });
    await expect(listOrders(financeOnly, merchantId, query(), NOW)).rejects.toMatchObject({ code: 'forbidden' });
    const otherMerchant = await makeMerchant('Other Shop', 'محل آخر');
    const outsider = await makeSessionUser({ merchantId: otherMerchant.id, access: 'full' });
    await expect(listOrders(outsider, merchantId, query(), NOW)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets an orders-and-pickups member list orders', async () => {
    await addOrder();
    const ordersMember = await makeSessionUser({ merchantId, access: 'orders_pickups' });
    expect((await listOrders(ordersMember, merchantId, query(), NOW)).total).toBe(1);
  });
});
