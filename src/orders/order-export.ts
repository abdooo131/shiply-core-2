import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireMerchantAccess, type SessionUser } from '@/accounts';
import { AppError } from '@/shared/app-error';
import { formatCairo } from '@/shared/cairo-time';
import { db } from '@/shared/db';

const MAX_EXPORT_ROWS = 5000;
const PIASTERS_PER_POUND = 100;
// Excel opens a CSV as UTF-8 (and keeps Arabic readable) only when it starts with a BOM.
const UTF8_BOM = '\uFEFF';
const CSV_LINE_END = '\r\n';
const CELL_NEEDS_QUOTES = /[",\r\n]/;
// A cell starting with these is run as a formula by spreadsheets (CSV injection).
const FORMULA_START = /^[=@\t\r]/;
const SIGNED_START = /^[+-]/;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

const HEADER = [
  'Number',
  'Created',
  'Type',
  'Status',
  'Customer name',
  'Mobile',
  'Area',
  'Governorate',
  'Cash to collect (EGP)',
  'Shiply fee (EGP)',
  'Reference',
];

const ExportFilter = z.object({ orderIds: z.array(z.string()).max(MAX_EXPORT_ROWS).optional() });
const OrderId = z.string().uuid();

export type OrderExportFilter = { orderIds?: string[] };

function formatPounds(amountPiasters: number): string {
  return (amountPiasters / PIASTERS_PER_POUND).toFixed(2);
}

function isFormulaLike(value: string): boolean {
  return FORMULA_START.test(value) || (SIGNED_START.test(value) && !PLAIN_NUMBER.test(value));
}

function toCsvCell(raw: string): string {
  const value = isFormulaLike(raw) ? `'${raw}` : raw;
  return CELL_NEEDS_QUOTES.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsvLine(cells: string[]): string {
  return cells.map(toCsvCell).join(',');
}

function buildWhere(merchantId: string, filter: OrderExportFilter): Prisma.OrderWhereInput {
  if (!filter.orderIds) return { merchantId };
  const validIds = filter.orderIds.filter((id) => OrderId.safeParse(id).success);
  return { merchantId, id: { in: validIds } };
}

export async function exportOrdersCsv(user: SessionUser, merchantId: string, filter: OrderExportFilter): Promise<Buffer> {
  requireMerchantAccess(user, merchantId, 'orders');
  const parsed = ExportFilter.safeParse(filter);
  if (!parsed.success) throw new AppError('invalid_input');

  const where = buildWhere(merchantId, parsed.data);
  // One row past the limit tells us the export is too big without counting separately.
  const orders = await db.order.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: MAX_EXPORT_ROWS + 1,
    select: {
      number: true,
      createdAt: true,
      type: true,
      status: true,
      customerName: true,
      customerMobile: true,
      codAmountPiasters: true,
      totalFeePiasters: true,
      merchantReference: true,
      area: { select: { nameEn: true, governorate: { select: { nameEn: true } } } },
    },
  });
  if (orders.length > MAX_EXPORT_ROWS) throw new AppError('too_many_rows');

  const lines = [
    toCsvLine(HEADER),
    ...orders.map((order) =>
      toCsvLine([
        order.number,
        formatCairo(order.createdAt, 'en', 'dateTime'),
        order.type,
        order.status,
        order.customerName,
        order.customerMobile,
        order.area.nameEn,
        order.area.governorate.nameEn,
        formatPounds(order.codAmountPiasters),
        formatPounds(order.totalFeePiasters),
        order.merchantReference ?? '',
      ]),
    ),
  ];
  return Buffer.from(UTF8_BOM + lines.join(CSV_LINE_END) + CSV_LINE_END, 'utf8');
}
