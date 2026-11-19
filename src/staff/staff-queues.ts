import { OrderStatus, type CashOutStatus, type Prisma, type SupportAuthorKind, type SupportTicketStatus, type SupportTopic } from '@prisma/client';
import { z } from 'zod';
import type { SessionUser } from '@/accounts';
import { maskIbanLast4 } from '@/merchants/iban';
import { nextStatusesFor } from '@/orders/order-status';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';

// Cross-merchant reads for Shiply's own team. Every write goes through the existing domain
// functions, which check the same roles again.

export const STAFF_PAGE_SIZE = 25;
// Scheduled pickups, approvals and cash-outs are short queues; the caps keep a bad day bounded.
const MAX_SCHEDULED_PICKUPS = 100;
const MAX_PENDING_APPROVALS = 100;
const MAX_LISTED_CASH_OUTS = 200;
const MAX_THREAD_MESSAGES = 500;
const MAX_SEARCH_LENGTH = 40;

export type StaffSection = 'orders' | 'pickups' | 'approvals' | 'money' | 'support';

const SECTION_ROLES: Record<StaffSection, ReadonlySet<string>> = {
  orders: new Set(['admin', 'operations']),
  pickups: new Set(['admin', 'operations']),
  approvals: new Set(['admin', 'finance']),
  money: new Set(['admin', 'finance']),
  support: new Set(['admin', 'operations', 'finance']),
};
const SECTION_ORDER: readonly StaffSection[] = ['orders', 'pickups', 'approvals', 'money', 'support'];
const FINAL_STATUSES: OrderStatus[] = ['delivered', 'returned', 'canceled'];

export function isStaff(user: SessionUser): boolean {
  return user.staffRoles.length > 0;
}

export function canUseSection(user: SessionUser, section: StaffSection): boolean {
  return user.staffRoles.some((role) => SECTION_ROLES[section].has(role));
}

export function staffSections(user: SessionUser): StaffSection[] {
  return SECTION_ORDER.filter((section) => canUseSection(user, section));
}

export function requireSection(user: SessionUser, section: StaffSection): void {
  if (!canUseSection(user, section)) throw new AppError('forbidden', 403);
}

function cairoDateOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function merchantNames(merchantIds: string[]): Promise<Map<string, { nameEn: string; nameAr: string }>> {
  const merchants = await db.merchant.findMany({
    where: { id: { in: [...new Set(merchantIds)] } },
    select: { id: true, nameEn: true, nameAr: true },
  });
  return new Map(merchants.map((merchant) => [merchant.id, { nameEn: merchant.nameEn, nameAr: merchant.nameAr }]));
}

function pageOf(total: number, requested: number) {
  const pageCount = Math.max(1, Math.ceil(total / STAFF_PAGE_SIZE));
  return { page: Math.min(Math.max(1, requested), pageCount), pageCount };
}

// ---------- Orders ----------

export type StaffOrderRow = {
  id: string;
  number: string;
  merchantNameEn: string;
  merchantNameAr: string;
  customerName: string;
  areaNameEn: string;
  areaNameAr: string;
  status: OrderStatus;
  attempts: number;
  codAmountPiasters: number;
  updatedAt: Date;
  nextStatuses: OrderStatus[];
};

const OrderQuery = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
  search: z.string().trim().max(MAX_SEARCH_LENGTH).optional(),
  page: z.number().int().min(1),
});

export async function listStaffOrders(
  user: SessionUser,
  rawQuery: { status?: OrderStatus; search?: string; page: number },
): Promise<{ rows: StaffOrderRow[]; page: number; pageCount: number; total: number }> {
  requireSection(user, 'orders');
  const query = OrderQuery.parse(rawQuery);
  const where: Prisma.OrderWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.search ? { number: { contains: query.search, mode: 'insensitive' } } : {}),
  };
  const total = await db.order.count({ where });
  const { page, pageCount } = pageOf(total, query.page);
  const orders = await db.order.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    skip: (page - 1) * STAFF_PAGE_SIZE,
    take: STAFF_PAGE_SIZE,
    select: {
      id: true, number: true, customerName: true, status: true, attempts: true, codAmountPiasters: true, updatedAt: true,
      merchant: { select: { nameEn: true, nameAr: true } },
      area: { select: { nameEn: true, nameAr: true } },
    },
  });
  return {
    rows: orders.map((order) => ({
      id: order.id,
      number: order.number,
      merchantNameEn: order.merchant.nameEn,
      merchantNameAr: order.merchant.nameAr,
      customerName: order.customerName,
      areaNameEn: order.area.nameEn,
      areaNameAr: order.area.nameAr,
      status: order.status,
      attempts: order.attempts,
      codAmountPiasters: order.codAmountPiasters,
      updatedAt: order.updatedAt,
      nextStatuses: nextStatusesFor(order.status, order.attempts),
    })),
    page,
    pageCount,
    total,
  };
}

// ---------- Pickups ----------

export type StaffPickupRow = {
  id: string;
  number: string;
  merchantNameEn: string;
  merchantNameAr: string;
  addressText: string;
  contactName: string;
  contactMobile: string;
  pickupDate: string;
  expectedCount: number;
  orders: { id: string; number: string; customerName: string }[];
};

export async function listScheduledPickups(user: SessionUser): Promise<StaffPickupRow[]> {
  requireSection(user, 'pickups');
  const pickups = await db.pickup.findMany({
    where: { status: 'scheduled' },
    orderBy: [{ pickupDate: 'asc' }, { number: 'asc' }],
    take: MAX_SCHEDULED_PICKUPS,
    select: {
      id: true, number: true, addressText: true, contactName: true, contactMobile: true, pickupDate: true, expectedCount: true,
      merchant: { select: { nameEn: true, nameAr: true } },
      orders: { select: { order: { select: { id: true, number: true, customerName: true } } }, orderBy: { orderId: 'asc' } },
    },
  });
  return pickups.map((pickup) => ({
    id: pickup.id,
    number: pickup.number,
    merchantNameEn: pickup.merchant.nameEn,
    merchantNameAr: pickup.merchant.nameAr,
    addressText: pickup.addressText,
    contactName: pickup.contactName,
    contactMobile: pickup.contactMobile,
    pickupDate: cairoDateOf(pickup.pickupDate),
    expectedCount: pickup.expectedCount,
    orders: pickup.orders.map((link) => link.order),
  }));
}

// ---------- Approvals ----------

export type PendingBankRow = {
  id: string;
  merchantNameEn: string;
  merchantNameAr: string;
  bankName: string;
  holderName: string;
  ibanMasked: string;
  requestedBy: string;
  createdAt: Date;
};

export async function listPendingBankAccounts(user: SessionUser): Promise<PendingBankRow[]> {
  requireSection(user, 'approvals');
  const accounts = await db.bankAccount.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: MAX_PENDING_APPROVALS,
    select: {
      id: true, bankName: true, holderName: true, ibanLast4: true, requestedBy: true, createdAt: true,
      merchant: { select: { nameEn: true, nameAr: true } },
    },
  });
  return accounts.map((account) => ({
    id: account.id,
    merchantNameEn: account.merchant.nameEn,
    merchantNameAr: account.merchant.nameAr,
    bankName: account.bankName,
    holderName: account.holderName,
    ibanMasked: maskIbanLast4(account.ibanLast4),
    requestedBy: account.requestedBy,
    createdAt: account.createdAt,
  }));
}

export type PendingPriceListRow = {
  id: string;
  merchantNameEn: string | null;
  merchantNameAr: string | null;
  version: number;
  lineCount: number;
  requestedBy: string;
  createdAt: Date;
};

export async function listPendingPriceLists(user: SessionUser): Promise<PendingPriceListRow[]> {
  requireSection(user, 'approvals');
  const lists = await db.priceList.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: MAX_PENDING_APPROVALS,
    select: {
      id: true, version: true, requestedBy: true, createdAt: true,
      merchant: { select: { nameEn: true, nameAr: true } },
      _count: { select: { lines: true } },
    },
  });
  return lists.map((list) => ({
    id: list.id,
    merchantNameEn: list.merchant?.nameEn ?? null,
    merchantNameAr: list.merchant?.nameAr ?? null,
    version: list.version,
    lineCount: list._count.lines,
    requestedBy: list.requestedBy,
    createdAt: list.createdAt,
  }));
}

// ---------- Money ----------

export type StaffCashOutRow = {
  id: string;
  number: string;
  merchantNameEn: string;
  merchantNameAr: string;
  amountPiasters: number;
  bankName: string;
  ibanMasked: string;
  scheduledDate: string;
  status: CashOutStatus;
  preparedBy: string;
  bankReference: string | null;
  paidAt: Date | null;
};

export async function listStaffCashOuts(user: SessionUser, { status }: { status: CashOutStatus }): Promise<StaffCashOutRow[]> {
  requireSection(user, 'money');
  const cashOuts = await db.cashOut.findMany({
    where: { status },
    orderBy: [{ scheduledDate: 'desc' }, { number: 'asc' }],
    take: MAX_LISTED_CASH_OUTS,
  });
  const [names, banks] = await Promise.all([
    merchantNames(cashOuts.map((cashOut) => cashOut.merchantId)),
    db.bankAccount.findMany({
      where: { id: { in: [...new Set(cashOuts.map((cashOut) => cashOut.bankAccountId))] } },
      select: { id: true, bankName: true, ibanLast4: true },
    }),
  ]);
  const bankById = new Map(banks.map((bank) => [bank.id, bank]));
  return cashOuts.map((cashOut) => {
    const bank = bankById.get(cashOut.bankAccountId);
    const name = names.get(cashOut.merchantId);
    return {
      id: cashOut.id,
      number: cashOut.number,
      merchantNameEn: name?.nameEn ?? '—',
      merchantNameAr: name?.nameAr ?? '—',
      amountPiasters: cashOut.amountPiasters,
      bankName: bank?.bankName ?? '—',
      ibanMasked: bank ? maskIbanLast4(bank.ibanLast4) : '—',
      scheduledDate: cairoDateOf(cashOut.scheduledDate),
      status: cashOut.status,
      preparedBy: cashOut.preparedBy,
      bankReference: cashOut.bankReference,
      paidAt: cashOut.paidAt,
    };
  });
}

// ---------- Support ----------

export type StaffTicketRow = {
  id: string;
  number: string;
  merchantNameEn: string;
  merchantNameAr: string;
  topic: SupportTopic;
  subject: string;
  orderNumber: string | null;
  status: SupportTicketStatus;
  updatedAt: Date;
};

export type StaffTicketThread = StaffTicketRow & {
  messages: { id: string; authorKind: SupportAuthorKind; body: string; createdAt: Date }[];
};

const TicketQuery = z.object({ status: z.enum(['open', 'answered', 'closed']), page: z.number().int().min(1) });
const TICKET_FIELDS = { id: true, number: true, merchantId: true, topic: true, subject: true, orderNumber: true, status: true, updatedAt: true } as const;

// Tickets waiting for us come oldest first, so nobody waits longest by accident.
export async function listStaffTickets(
  user: SessionUser,
  rawQuery: { status: 'open' | 'answered' | 'closed'; page: number },
): Promise<{ rows: StaffTicketRow[]; page: number; pageCount: number; total: number }> {
  requireSection(user, 'support');
  const query = TicketQuery.parse(rawQuery);
  const where = { status: query.status };
  const total = await db.supportTicket.count({ where });
  const { page, pageCount } = pageOf(total, query.page);
  const tickets = await db.supportTicket.findMany({
    where,
    orderBy: [{ updatedAt: query.status === 'open' ? 'asc' : 'desc' }, { id: 'asc' }],
    skip: (page - 1) * STAFF_PAGE_SIZE,
    take: STAFF_PAGE_SIZE,
    select: TICKET_FIELDS,
  });
  const names = await merchantNames(tickets.map((ticket) => ticket.merchantId));
  return {
    rows: tickets.map(({ merchantId, ...ticket }) => ({
      ...ticket,
      merchantNameEn: names.get(merchantId)?.nameEn ?? '—',
      merchantNameAr: names.get(merchantId)?.nameAr ?? '—',
    })),
    page,
    pageCount,
    total,
  };
}

export async function getStaffTicket(user: SessionUser, ticketId: string): Promise<StaffTicketThread> {
  requireSection(user, 'support');
  if (!z.string().uuid().safeParse(ticketId).success) throw new AppError('not_found', 404);
  const ticket = await db.supportTicket.findUnique({
    where: { id: ticketId },
    select: {
      ...TICKET_FIELDS,
      messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: MAX_THREAD_MESSAGES, select: { id: true, authorKind: true, body: true, createdAt: true } },
    },
  });
  if (!ticket) throw new AppError('not_found', 404);
  const { merchantId, ...rest } = ticket;
  const names = await merchantNames([merchantId]);
  return { ...rest, merchantNameEn: names.get(merchantId)?.nameEn ?? '—', merchantNameAr: names.get(merchantId)?.nameAr ?? '—' };
}

// ---------- Overview ----------

export type StaffQueueCounts = {
  ordersOpen: number | null;
  pickupsScheduled: number | null;
  bankPending: number | null;
  priceListsPending: number | null;
  cashOutsOpen: number | null;
  ticketsOpen: number | null;
};

// A count the role may not see is null, so the overview shows only the caller's own queues.
export async function countStaffQueues(user: SessionUser): Promise<StaffQueueCounts> {
  if (!isStaff(user)) throw new AppError('forbidden', 403);
  const when = (section: StaffSection, count: () => Promise<number>) => (canUseSection(user, section) ? count() : Promise.resolve(null));
  const [ordersOpen, pickupsScheduled, bankPending, priceListsPending, cashOutsOpen, ticketsOpen] = await Promise.all([
    when('orders', () => db.order.count({ where: { status: { notIn: FINAL_STATUSES } } })),
    when('pickups', () => db.pickup.count({ where: { status: 'scheduled' } })),
    when('approvals', () => db.bankAccount.count({ where: { status: 'pending' } })),
    when('approvals', () => db.priceList.count({ where: { status: 'pending' } })),
    when('money', () => db.cashOut.count({ where: { status: { in: ['prepared', 'approved'] } } })),
    when('support', () => db.supportTicket.count({ where: { status: 'open' } })),
  ]);
  return { ordersOpen, pickupsScheduled, bankPending, priceListsPending, cashOutsOpen, ticketsOpen };
}
