import { Prisma, type OrderStatus, type OrderType } from '@prisma/client';
import { z } from 'zod';
import { requireMerchantAccess, type SessionUser } from '@/accounts';
import { toLatinDigits } from '@/shared/arabic-digits';
import { cairoDayStartUtc } from '@/shared/cairo-time';
import { db } from '@/shared/db';
import { normalizeEgyptianMobile } from '@/shared/egyptian-mobile';
import { ORDER_TABS, TAB_STATUSES, merchantStatusOf, type OrderTab, type StatusTone } from './merchant-status';

export const PAGE_SIZE = 25;
const MAX_SEARCH_LENGTH = 80;
const MS_PER_DAY = 86_400_000;
const SOME_ATTEMPTS_MAX = 2;
const MANY_ATTEMPTS = 3;
const DIGITS_ONLY = /^\d+$/;

// ISO 3166-2:EG codes, the same list the seed loads into Governorate (a test keeps them in step).
// Kept here so URL parsing stays synchronous and never needs the database.
export const EGYPT_GOVERNORATE_CODES = [
  'C', 'GZ', 'ALX', 'KB', 'SHR', 'DK', 'GH', 'MNF', 'BH', 'KFS', 'DT', 'PTS', 'IS', 'SUZ',
  'FYM', 'BNS', 'MN', 'AST', 'SHG', 'KN', 'LX', 'ASN', 'BA', 'WAD', 'MT', 'SIN', 'JS',
] as const;

const ORDER_TYPES = ['deliver', 'pick_and_choose', 'exchange', 'return', 'sign_and_return', 'cash_collection'] as const satisfies readonly OrderType[];
const DATE_RANGES = ['any', 'today', '7d', '30d'] as const;
const PAYMENTS = ['any', 'cod', 'prepaid'] as const;
const TRIES = ['any', '0', 'some', '3'] as const;
const SORTS = ['updated', 'new', 'old', 'cash'] as const;

// How many days back (including today) each date range reaches.
const DATE_RANGE_DAYS: Record<Exclude<(typeof DATE_RANGES)[number], 'any'>, number> = { today: 1, '7d': 7, '30d': 30 };

const ORDER_BY: Record<(typeof SORTS)[number], Prisma.OrderOrderByWithRelationInput[]> = {
  updated: [{ updatedAt: 'desc' }, { id: 'desc' }],
  new: [{ createdAt: 'desc' }, { id: 'desc' }],
  old: [{ createdAt: 'asc' }, { id: 'asc' }],
  cash: [{ codAmountPiasters: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
};

// Keeps only known members, without duplicates, in the canonical order of `allowed`.
function knownMembers<T extends string>(allowed: readonly T[]) {
  return z
    .string()
    .transform((text) => {
      const given = new Set(text.split(',').map((part) => part.trim()));
      return allowed.filter((member) => given.has(member));
    })
    .catch([]);
}

const OrderListQuerySchema = z.object({
  tab: z.enum(ORDER_TABS).catch('all'),
  q: z
    .string()
    .transform((text) => text.trim().slice(0, MAX_SEARCH_LENGTH).trim())
    .catch(''),
  date: z.enum(DATE_RANGES).catch('any'),
  gov: knownMembers(EGYPT_GOVERNORATE_CODES),
  type: knownMembers(ORDER_TYPES),
  pay: z.enum(PAYMENTS).catch('any'),
  tries: z.enum(TRIES).catch('any'),
  sort: z.enum(SORTS).catch('updated'),
  page: z
    .string()
    .regex(DIGITS_ONLY)
    .transform(Number)
    .pipe(z.number().int().min(1).max(Number.MAX_SAFE_INTEGER))
    .catch(1),
});

export type OrderListQuery = z.output<typeof OrderListQuerySchema>;

const DEFAULT_QUERY: OrderListQuery = OrderListQuerySchema.parse({});
const QUERY_KEYS = ['tab', 'q', 'date', 'gov', 'type', 'pay', 'tries', 'sort', 'page'] as const satisfies readonly (keyof OrderListQuery)[];

export function parseOrderListQuery(params: Record<string, string | string[] | undefined>): OrderListQuery {
  const firstValues = Object.fromEntries(
    QUERY_KEYS.map((key) => {
      const value = params[key];
      return [key, Array.isArray(value) ? value[0] : value];
    }),
  );
  const parsed = OrderListQuerySchema.safeParse(firstValues);
  return parsed.success ? parsed.data : DEFAULT_QUERY;
}

// The inverse of parseOrderListQuery: only non-default values, always in the same key order.
export function toQueryString(query: OrderListQuery): string {
  const params = new URLSearchParams();
  for (const key of QUERY_KEYS) {
    const value = query[key];
    const text = Array.isArray(value) ? value.join(',') : String(value);
    const defaultValue = DEFAULT_QUERY[key];
    const defaultText = Array.isArray(defaultValue) ? defaultValue.join(',') : String(defaultValue);
    if (text !== defaultText) params.set(key, text);
  }
  return params.toString();
}

export type OrderListRow = {
  id: string;
  number: string;
  type: OrderType;
  status: OrderStatus;
  merchantStatus: OrderStatus;
  tone: StatusTone;
  customerName: string;
  customerMobile: string;
  areaNameEn: string;
  areaNameAr: string;
  governorateCode: string;
  codAmountPiasters: number;
  totalFeePiasters: number;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
  isPrinted: boolean;
};

export type OrderListResult = {
  orders: OrderListRow[];
  total: number;
  page: number;
  pageCount: number;
  tabCounts: Record<OrderTab, number>;
};

function mobileOrNull(text: string): string | null {
  try {
    return normalizeEgyptianMobile(text);
  } catch {
    return null;
  }
}

function searchFilter(q: string): Prisma.OrderWhereInput | undefined {
  if (!q) return undefined;
  const latin = toLatinDigits(q);
  const anyOf: Prisma.OrderWhereInput[] = [
    { customerName: { contains: q, mode: 'insensitive' } },
    { merchantReference: { contains: q, mode: 'insensitive' } },
  ];
  if (DIGITS_ONLY.test(latin)) anyOf.push({ number: { startsWith: latin } });
  const mobile = mobileOrNull(q);
  if (mobile) anyOf.push({ customerMobile: mobile });
  return { OR: anyOf };
}

function createdSinceFilter(date: OrderListQuery['date'], now: Date): Prisma.OrderWhereInput | undefined {
  if (date === 'any') return undefined;
  const daysBack = DATE_RANGE_DAYS[date] - 1;
  return { createdAt: { gte: cairoDayStartUtc(new Date(now.getTime() - daysBack * MS_PER_DAY)) } };
}

function attemptsFilter(tries: OrderListQuery['tries']): Prisma.OrderWhereInput | undefined {
  if (tries === '0') return { attempts: 0 };
  if (tries === 'some') return { attempts: { gte: 1, lte: SOME_ATTEMPTS_MAX } };
  if (tries === '3') return { attempts: { gte: MANY_ATTEMPTS } };
  return undefined;
}

function paymentFilter(pay: OrderListQuery['pay']): Prisma.OrderWhereInput | undefined {
  if (pay === 'cod') return { codAmountPiasters: { gt: 0 } };
  if (pay === 'prepaid') return { codAmountPiasters: 0 };
  return undefined;
}

// Everything except the tab: the tab counts are computed over this.
function filtersWhere(merchantId: string, query: OrderListQuery, now: Date): Prisma.OrderWhereInput {
  const parts: (Prisma.OrderWhereInput | undefined)[] = [
    { merchantId },
    query.gov.length > 0 ? { area: { governorateCode: { in: query.gov } } } : undefined,
    query.type.length > 0 ? { type: { in: query.type } } : undefined,
    createdSinceFilter(query.date, now),
    paymentFilter(query.pay),
    attemptsFilter(query.tries),
    searchFilter(query.q),
  ];
  return { AND: parts.filter((part): part is Prisma.OrderWhereInput => part !== undefined) };
}

const NOT_PRINTED: Prisma.OrderWhereInput = { labelPrints: { none: {} } };

function tabWhere(tab: OrderTab): Prisma.OrderWhereInput {
  if (tab === 'all') return {};
  if (tab === 'not_printed') return NOT_PRINTED;
  return { status: { in: [...TAB_STATUSES[tab]] } };
}

async function countTabs(where: Prisma.OrderWhereInput): Promise<Record<OrderTab, number>> {
  const [byStatus, notPrinted] = await Promise.all([
    db.order.groupBy({ by: ['status'], where, _count: { _all: true } }),
    db.order.count({ where: { AND: [where, NOT_PRINTED] } }),
  ]);
  const perStatus = new Map(byStatus.map((group) => [group.status, group._count._all]));
  const sumOf = (statuses: readonly OrderStatus[]) => statuses.reduce((sum, status) => sum + (perStatus.get(status) ?? 0), 0);
  const counts = Object.fromEntries(ORDER_TABS.map((tab) => [tab, sumOf(TAB_STATUSES[tab])])) as Record<OrderTab, number>;
  counts.not_printed = notPrinted;
  return counts;
}

export async function listOrders(
  user: SessionUser,
  merchantId: string,
  query: OrderListQuery,
  now: Date = new Date(),
): Promise<OrderListResult> {
  requireMerchantAccess(user, merchantId, 'orders');
  const where = filtersWhere(merchantId, query, now);
  const tabCounts = await countTabs(where);
  const total = tabCounts[query.tab];
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(query.page, pageCount);

  const rows = await db.order.findMany({
    where: { AND: [where, tabWhere(query.tab)] },
    orderBy: ORDER_BY[query.sort],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true,
      number: true,
      type: true,
      status: true,
      customerName: true,
      customerMobile: true,
      codAmountPiasters: true,
      totalFeePiasters: true,
      attempts: true,
      createdAt: true,
      updatedAt: true,
      area: { select: { nameEn: true, nameAr: true, governorateCode: true } },
      _count: { select: { labelPrints: true } },
    },
  });

  const orders = rows.map(({ area, _count, ...order }): OrderListRow => {
    const shown = merchantStatusOf(order.status);
    return {
      ...order,
      merchantStatus: shown.key,
      tone: shown.tone,
      areaNameEn: area.nameEn,
      areaNameAr: area.nameAr,
      governorateCode: area.governorateCode,
      isPrinted: _count.labelPrints > 0,
    };
  });
  return { orders, total, page, pageCount, tabCounts };
}
