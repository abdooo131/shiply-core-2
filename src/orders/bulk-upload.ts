import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { requireMerchantAccess, type SessionUser } from '@/accounts';
import { normalizeForSearch, searchAreas } from '@/location';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';
import { parseEgpToPiasters } from '@/shared/money';
import { createOrder, type CreateOrderInput } from './create-order';

export const BULK_UPLOAD_MAX_ROWS = 500;

const HEADER_ROW_NUMBER = 1;
const BYTE_ORDER_MARK = '﻿';
// Excel stores a typed 01001234567 as the number 1001234567; put the zero back.
const MOBILE_WITHOUT_LEADING_ZERO = /^1[0125]\d{8}$/;

const COLUMNS = {
  type: { en: 'type', ar: 'النوع' },
  customer_name: { en: 'customer_name', ar: 'اسم العميل' },
  mobile: { en: 'mobile', ar: 'الموبايل' },
  address: { en: 'address', ar: 'العنوان' },
  address_extra: { en: 'address_extra', ar: 'تفاصيل العنوان' },
  area: { en: 'area', ar: 'المنطقة' },
  size: { en: 'size', ar: 'المقاس' },
  cod_egp: { en: 'cod_egp', ar: 'مبلغ التحصيل' },
  open_package: { en: 'open_package', ar: 'فتح الشحنة' },
  cash_direction: { en: 'cash_direction', ar: 'اتجاه النقدية' },
  reference: { en: 'reference', ar: 'رقم طلبك' },
  courier_note: { en: 'courier_note', ar: 'ملاحظة للمندوب' },
  description: { en: 'description', ar: 'الوصف' },
} as const;

export type SheetField = keyof typeof COLUMNS;
const FIELDS = Object.keys(COLUMNS) as SheetField[];
const REQUIRED_HEADERS: SheetField[] = ['type', 'customer_name', 'mobile', 'address', 'area'];
const REQUIRED_VALUES: SheetField[] = ['type', 'customer_name', 'mobile', 'address', 'area'];

export type ParsedRow = { rowNumber: number; values: Record<SheetField, string> };

export type ImportResult = {
  uploadId: string;
  created: { rowNumber: number; orderNumber: string }[];
  failed: { rowNumber: number; errors: string[] }[];
};

type BulkOrderType = 'deliver' | 'exchange' | 'return' | 'cash_collection' | 'sign_and_return';
type PackageSize = 'small' | 'medium' | 'large' | 'light_bulky' | 'heavy_bulky';

// Compares header and choice text ignoring case, spaces, underscores, dashes and Arabic spelling variants.
function matchKey(text: string): string {
  return normalizeForSearch(text).replace(/[\s_-]+/g, '');
}

function lookup<T>(entries: [string, T][]): Map<string, T> {
  return new Map(entries.map(([text, value]) => [matchKey(text), value]));
}

const ORDER_TYPES = lookup<BulkOrderType>([
  ['deliver', 'deliver'], ['توصيل', 'deliver'],
  ['exchange', 'exchange'], ['استبدال', 'exchange'],
  ['return', 'return'], ['مرتجع', 'return'],
  ['cash_collection', 'cash_collection'], ['تحصيل نقدي', 'cash_collection'],
  ['sign_and_return', 'sign_and_return'], ['استلام وتوقيع', 'sign_and_return'],
]);
// Pick & Choose needs products picked per order, which a sheet cannot carry.
const NOT_ALLOWED_TYPES = new Set(['pick_and_choose', 'pick & choose', 'اختيار وتجربة'].map(matchKey));
const SIZES = lookup<PackageSize>([
  ['small', 'small'], ['صغير', 'small'],
  ['medium', 'medium'], ['متوسط', 'medium'],
  ['large', 'large'], ['كبير', 'large'],
  ['light_bulky', 'light_bulky'], ['ضخم خفيف', 'light_bulky'],
  ['heavy_bulky', 'heavy_bulky'], ['ضخم ثقيل', 'heavy_bulky'],
]);
const YES_NO = lookup<boolean>([['yes', true], ['نعم', true], ['no', false], ['لا', false]]);
const CASH_DIRECTIONS = lookup<'collect' | 'give'>([['collect', 'collect'], ['تحصيل', 'collect'], ['give', 'give'], ['تسليم', 'give']]);
const HEADERS = lookup<SheetField>(FIELDS.flatMap((field) => [[COLUMNS[field].en, field], [COLUMNS[field].ar, field]] as [string, SheetField][]));

const TEMPLATE_EXAMPLE: Record<'en' | 'ar', Record<SheetField, string>> = {
  en: {
    type: 'deliver', customer_name: 'Mona Ali', mobile: '01001234567', address: '12 Abbas El Akkad St', address_extra: 'Building 4, flat 7',
    area: 'Nasr City', size: 'small', cod_egp: '150', open_package: 'no', cash_direction: '', reference: 'A-1001', courier_note: 'Call before arriving', description: 'Dress',
  },
  ar: {
    type: 'توصيل', customer_name: 'منى علي', mobile: '01001234567', address: '١٢ شارع عباس العقاد', address_extra: 'عمارة ٤، شقة ٧',
    area: 'مدينة نصر', size: 'صغير', cod_egp: '150', open_package: 'لا', cash_direction: '', reference: 'A-1001', courier_note: 'اتصل قبل الوصول', description: 'فستان',
  },
};

export async function buildTemplateWorkbook(locale: 'en' | 'ar'): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(locale === 'ar' ? 'الطلبات' : 'Orders', { views: [{ rightToLeft: locale === 'ar' }] });
  sheet.addRow(FIELDS.map((field) => COLUMNS[field][locale]));
  sheet.addRow(FIELDS.map((field) => TEMPLATE_EXAMPLE[locale][field]));
  sheet.getRow(HEADER_ROW_NUMBER).font = { bold: true };
  // Text format keeps the mobile's leading zero when the merchant types over the example.
  sheet.getColumn(FIELDS.indexOf('mobile') + 1).numFmt = '@';
  sheet.columns.forEach((column) => (column.width = 18));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function fileExtension(fileName: string): string {
  return fileName.toLowerCase().split('.').pop() ?? '';
}

async function loadWorksheet(buffer: Buffer, fileName: string): Promise<ExcelJS.Worksheet> {
  const extension = fileExtension(fileName);
  if (extension !== 'xlsx' && extension !== 'csv') throw new AppError('invalid_file');
  const workbook = new ExcelJS.Workbook();
  try {
    if (extension === 'xlsx') {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new AppError('invalid_file');
      return sheet;
    }
    let text = buffer.toString('utf8');
    if (text.startsWith(BYTE_ORDER_MARK)) text = text.slice(BYTE_ORDER_MARK.length);
    // Keep every value as typed: the default reader turns 01001234567 into a number and drops the zero.
    return await workbook.csv.read(Readable.from([text]), { map: (value: string) => value });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('invalid_file');
  }
}

function cellText(cell: ExcelJS.Cell): string {
  return cell.text.replace(/\s+/g, ' ').trim();
}

function readHeader(sheet: ExcelJS.Worksheet): Map<number, SheetField> {
  const columns = new Map<number, SheetField>();
  sheet.getRow(HEADER_ROW_NUMBER).eachCell((cell, columnNumber) => {
    const field = HEADERS.get(matchKey(cellText(cell)));
    if (field) columns.set(columnNumber, field);
  });
  const found = new Set(columns.values());
  if (REQUIRED_HEADERS.some((field) => !found.has(field))) throw new AppError('invalid_file');
  return columns;
}

function readRow(row: ExcelJS.Row, columns: Map<number, SheetField>): Record<SheetField, string> {
  const values = Object.fromEntries(FIELDS.map((field) => [field, ''])) as Record<SheetField, string>;
  for (const [columnNumber, field] of columns) {
    const cell = row.getCell(columnNumber);
    let text = cellText(cell);
    if (field === 'mobile' && typeof cell.value === 'number' && MOBILE_WITHOUT_LEADING_ZERO.test(text)) text = `0${text}`;
    values[field] = text;
  }
  return values;
}

export async function parseOrderSheet(buffer: Buffer, fileName: string): Promise<ParsedRow[]> {
  const sheet = await loadWorksheet(buffer, fileName);
  const columns = readHeader(sheet);
  const rows: ParsedRow[] = [];
  for (let rowNumber = HEADER_ROW_NUMBER + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const values = readRow(sheet.getRow(rowNumber), columns);
    if (FIELDS.every((field) => values[field] === '')) continue;
    if (rows.length === BULK_UPLOAD_MAX_ROWS) throw new AppError('too_many_rows');
    rows.push({ rowNumber, values });
  }
  return rows;
}

type AreaResolver = (areaText: string) => Promise<string | null>;

// One lookup per distinct area name in the file, not one per row.
function makeAreaResolver(): AreaResolver {
  const cache = new Map<string, Promise<string | null>>();
  return (areaText) => {
    const normalized = normalizeForSearch(areaText);
    let resolved = cache.get(normalized);
    if (!resolved) {
      resolved = searchAreas(areaText, { limit: 1 }).then(([best]) => {
        const isExactName = best && [best.nameAr, best.nameEn].some((name) => normalizeForSearch(name) === normalized);
        return isExactName ? best.id : null;
      });
      cache.set(normalized, resolved);
    }
    return resolved;
  };
}

function parseChoice<T>(text: string, choices: Map<string, T>, fallback: T, errorCode: string, errors: string[]): T {
  if (text === '') return fallback;
  const choice = choices.get(matchKey(text));
  if (choice === undefined) errors.push(errorCode);
  return choice ?? fallback;
}

function parseType(text: string, errors: string[]): BulkOrderType | null {
  if (text === '') return null;
  const key = matchKey(text);
  if (NOT_ALLOWED_TYPES.has(key)) errors.push('type_not_allowed');
  else if (!ORDER_TYPES.has(key)) errors.push('invalid_type');
  return ORDER_TYPES.get(key) ?? null;
}

function parseCodPiasters(text: string, errors: string[]): number {
  if (text === '') return 0;
  try {
    return parseEgpToPiasters(text);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    errors.push(error.code);
    return 0;
  }
}

async function toOrderInput(values: Record<SheetField, string>, resolveArea: AreaResolver): Promise<{ input: CreateOrderInput | null; errors: string[] }> {
  const errors: string[] = REQUIRED_VALUES.filter((field) => values[field] === '').map((field) => `missing_${field}`);
  const type = parseType(values.type, errors);
  const areaId = values.area === '' ? null : await resolveArea(values.area);
  if (values.area !== '' && !areaId) errors.push('area_unknown');
  const size = parseChoice(values.size, SIZES, 'small', 'invalid_size', errors);
  const codAmountPiasters = parseCodPiasters(values.cod_egp, errors);
  const allowOpenPackage = parseChoice(values.open_package, YES_NO, false, 'invalid_open_package', errors);
  const cashDirection = parseChoice<'collect' | 'give' | undefined>(values.cash_direction, CASH_DIRECTIONS, undefined, 'invalid_cash_direction', errors);
  if (type === 'cash_collection' && values.cash_direction === '') errors.push('missing_cash_direction');
  if (errors.length > 0 || !type || !areaId) return { input: null, errors };

  return {
    input: {
      type,
      customerName: values.customer_name,
      customerMobile: values.mobile,
      addressText: values.address,
      addressExtra: values.address_extra || undefined,
      areaId,
      size,
      description: values.description || undefined,
      codAmountPiasters,
      cashDirection: type === 'cash_collection' ? cashDirection : undefined,
      allowOpenPackage,
      depositRequired: false,
      insuredValuePiasters: 0,
      merchantReference: values.reference || undefined,
      courierNote: values.courier_note || undefined,
    },
    errors,
  };
}

export async function importOrderSheet(user: SessionUser, merchantId: string, buffer: Buffer, fileName: string): Promise<ImportResult> {
  requireMerchantAccess(user, merchantId, 'orders');
  const rows = await parseOrderSheet(buffer, fileName);
  const fileHash = createHash('sha256').update(buffer).digest('hex');
  const resolveArea = makeAreaResolver();
  const created: ImportResult['created'] = [];
  const failed: ImportResult['failed'] = [];

  // Rows run one after another so each row's order number and customer upsert stay simple; 500 rows at most.
  for (const row of rows) {
    const { input, errors } = await toOrderInput(row.values, resolveArea);
    if (!input) {
      failed.push({ rowNumber: row.rowNumber, errors });
      continue;
    }
    try {
      // The key ties the order to this file and row, so uploading the same file again returns the same orders.
      const order = await createOrder(user, merchantId, input, `bulk:${fileHash}:${row.rowNumber}`);
      created.push({ rowNumber: row.rowNumber, orderNumber: order.number });
    } catch (error) {
      // Only a problem with the row is reported per row; anything else (database down) stops the upload, which is safe to retry.
      if (!(error instanceof AppError)) throw error;
      failed.push({ rowNumber: row.rowNumber, errors: [error.code] });
    }
  }

  const upload = await db.bulkUpload.create({
    data: {
      merchantId,
      fileName,
      fileHash,
      rowCount: rows.length,
      createdCount: created.length,
      failedCount: failed.length,
      // Row numbers, order numbers and error codes only: never customer names or phones.
      resultJson: { created, failed },
      uploadedBy: user.id,
    },
    select: { id: true },
  });
  return { uploadId: upload.id, created, failed };
}
