import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@/accounts';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { seedPricingDefaults } from '@/pricing/pricing-test-fixtures';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { BULK_UPLOAD_MAX_ROWS, buildTemplateWorkbook, importOrderSheet, parseOrderSheet } from './bulk-upload';

const ENGLISH_HEADERS = ['type', 'customer_name', 'mobile', 'address', 'address_extra', 'area', 'size', 'cod_egp', 'open_package', 'cash_direction', 'reference', 'courier_note', 'description'];
const ARABIC_HEADERS = ['النوع', 'اسم العميل', 'الموبايل', 'العنوان', 'تفاصيل العنوان', 'المنطقة', 'المقاس', 'مبلغ التحصيل', 'فتح الشحنة', 'اتجاه النقدية', 'رقم طلبك', 'ملاحظة للمندوب', 'الوصف'];

let merchantId = '';
let owner: SessionUser;

beforeEach(async () => {
  await resetTestDatabase();
  await seedPricingDefaults();
  merchantId = (await makeMerchant()).id;
  owner = await makeSessionUser({ merchantId, access: 'full' });
});

async function xlsx(headers: string[], rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Orders');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function csv(headers: string[], rows: string[][], withBom = false): Buffer {
  const quote = (cell: string) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  const lines = [headers, ...rows].map((row) => row.map(quote).join(','));
  return Buffer.from(`${withBom ? '﻿' : ''}${lines.join('\r\n')}\r\n`, 'utf8');
}

// type, name, mobile, address, extra, area, size, cod, open, direction, reference, note, description
const goodEnglishRow = (mobile = '01001234567') => ['deliver', 'Mona Ali', mobile, '12 Abbas El Akkad St', 'Building 4', 'Nasr City', 'small', '0', 'no', '', 'A-1', '', 'Dress'];

describe('parseOrderSheet', () => {
  it('reads English headers from .xlsx and keeps a numeric mobile its leading zero', async () => {
    const buffer = await xlsx(ENGLISH_HEADERS, [goodEnglishRow(), [], ['exchange', 'Omar', 1001234568, '5 Tahrir St', '', 'Maadi', 'medium', 250, 'yes', '', '', '', '']]);
    const rows = await parseOrderSheet(buffer, 'orders.XLSX');
    expect(rows.map((row) => row.rowNumber)).toEqual([2, 4]);
    expect(rows[0]?.values).toMatchObject({ type: 'deliver', customer_name: 'Mona Ali', area: 'Nasr City', address_extra: 'Building 4' });
    expect(rows[1]?.values).toMatchObject({ mobile: '01001234568', cod_egp: '250', open_package: 'yes' });
  });

  it('reads Arabic headers from .csv with a byte order mark and keeps text as typed', async () => {
    const buffer = csv(ARABIC_HEADERS, [['توصيل', 'منى علي', '٠١٠٠١٢٣٤٥٦٧', '١٢ شارع عباس العقاد', '', 'مدينة نصر', 'صغير', '١٬٥٠٠', 'لا', '', '', '', '']], true);
    const rows = await parseOrderSheet(buffer, 'orders.csv');
    expect(rows).toEqual([
      expect.objectContaining({ rowNumber: 2, values: expect.objectContaining({ type: 'توصيل', mobile: '٠١٠٠١٢٣٤٥٦٧', address: '١٢ شارع عباس العقاد', area: 'مدينة نصر' }) }),
    ]);
  });

  it('accepts headers regardless of case and spacing', async () => {
    const headers = ENGLISH_HEADERS.map((header) => ` ${header.replace(/_/g, ' ').toUpperCase()} `);
    const rows = await parseOrderSheet(csv(headers, [goodEnglishRow()]), 'orders.csv');
    expect(rows[0]?.values.customer_name).toBe('Mona Ali');
  });

  it(`refuses more than ${BULK_UPLOAD_MAX_ROWS} rows`, async () => {
    const rows = Array.from({ length: BULK_UPLOAD_MAX_ROWS + 1 }, () => goodEnglishRow());
    await expect(parseOrderSheet(csv(ENGLISH_HEADERS, rows), 'orders.csv')).rejects.toMatchObject({ code: 'too_many_rows' });
    const exactlyMax = rows.slice(1);
    await expect(parseOrderSheet(csv(ENGLISH_HEADERS, exactlyMax), 'orders.csv')).resolves.toHaveLength(BULK_UPLOAD_MAX_ROWS);
  });

  it('refuses other file types, broken files and a missing required column', async () => {
    await expect(parseOrderSheet(Buffer.from('%PDF-1.4'), 'orders.pdf')).rejects.toMatchObject({ code: 'invalid_file' });
    await expect(parseOrderSheet(Buffer.from('not a zip'), 'orders.xlsx')).rejects.toMatchObject({ code: 'invalid_file' });
    const withoutArea = ENGLISH_HEADERS.filter((header) => header !== 'area');
    await expect(parseOrderSheet(csv(withoutArea, [goodEnglishRow().slice(0, 12)]), 'orders.csv')).rejects.toMatchObject({ code: 'invalid_file' });
  });

  it('round-trips the Arabic template: the example row comes back', async () => {
    const rows = await parseOrderSheet(await buildTemplateWorkbook('ar'), 'template.xlsx');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rowNumber: 2, values: { type: 'توصيل', mobile: '01001234567', area: 'مدينة نصر', size: 'صغير' } });
  });

  it('builds the English template with English headers', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await buildTemplateWorkbook('en')) as unknown as ArrayBuffer);
    const header = workbook.worksheets[0]?.getRow(1).values as unknown[];
    expect(header.slice(1)).toEqual(ENGLISH_HEADERS);
  });
});

describe('importOrderSheet', () => {
  it('creates orders from an English .xlsx, priced exactly like createOrder', async () => {
    const buffer = await xlsx(ENGLISH_HEADERS, [goodEnglishRow()]);
    const result = await importOrderSheet(owner, merchantId, buffer, 'orders.xlsx');
    expect(result.failed).toEqual([]);
    expect(result.created).toEqual([{ rowNumber: 2, orderNumber: expect.stringMatching(/^[1-9]\d{9}$/) }]);
    const order = await db.order.findUniqueOrThrow({ where: { number: result.created[0]?.orderNumber } });
    expect(order).toMatchObject({
      merchantId,
      type: 'deliver',
      size: 'small',
      customerMobile: '+201001234567',
      addressExtra: 'Building 4',
      merchantReference: 'A-1',
      description: 'Dress',
      allowOpenPackage: false,
      shippingPiasters: 6800,
      vatPiasters: 952,
      totalFeePiasters: 7752,
    });
  });

  it('creates orders from an Arabic .csv with Arabic digits in the COD amount', async () => {
    const buffer = csv(ARABIC_HEADERS, [
      ['توصيل', 'منى علي', '٠١٠٠١٢٣٤٥٦٧', '١٢ شارع عباس العقاد', '', 'مدينة نصر', 'متوسط', '١,٥٠٠', 'نعم', '', '', 'اتصل قبل الوصول', ''],
      ['تحصيل نقدي', 'كريم', '01112345678', '٥ شارع التحرير', '', 'المعادي', '', '٢٠٠', '', 'تسليم', '', '', ''],
    ]);
    const result = await importOrderSheet(owner, merchantId, buffer, 'طلبات.csv');
    expect(result.failed).toEqual([]);
    const orders = await db.order.findMany({ where: { number: { in: result.created.map((row) => row.orderNumber) } }, orderBy: { codAmountPiasters: 'desc' } });
    expect(orders[0]).toMatchObject({ type: 'deliver', size: 'medium', codAmountPiasters: 150000, allowOpenPackage: true, customerName: 'منى علي', courierNote: 'اتصل قبل الوصول' });
    expect(orders[1]).toMatchObject({ type: 'cash_collection', cashDirection: 'give', refundPiasters: 20000, codAmountPiasters: 0 });
  });

  it('creates the good rows of a mixed file and reports each bad row with its reasons', async () => {
    const buffer = await xlsx(ENGLISH_HEADERS, [
      goodEnglishRow(),
      ['pick_and_choose', 'Sara', '01001234569', '1 Nile St', '', 'Nasr City', '', '', '', '', '', '', ''],
      ['deliver', '', '01001234570', '1 Nile St', '', 'Atlantis', '', '', '', '', '', '', ''],
      ['deliver', 'Hany', '12345', '1 Nile St', '', 'Nasr City', '', 'abc', '', '', '', '', ''],
      ['cash_collection', 'Laila', '01001234571', '1 Nile St', '', 'Maadi', '', '100', '', '', '', '', ''],
      goodEnglishRow('01001234572'),
    ]);
    const result = await importOrderSheet(owner, merchantId, buffer, 'mixed.xlsx');
    expect(result.created.map((row) => row.rowNumber)).toEqual([2, 7]);
    expect(result.failed).toEqual([
      { rowNumber: 3, errors: ['type_not_allowed'] },
      { rowNumber: 4, errors: ['missing_customer_name', 'area_unknown'] },
      { rowNumber: 5, errors: ['invalid_amount'] },
      { rowNumber: 6, errors: ['missing_cash_direction'] },
    ]);
    // Bad values that only createOrder can judge (the mobile) come back as its error code.
    const fixedAmount = await xlsx(ENGLISH_HEADERS, [['deliver', 'Hany', '12345', '1 Nile St', '', 'Nasr City', '', '', '', '', '', '', '']]);
    expect((await importOrderSheet(owner, merchantId, fixedAmount, 'mobile.xlsx')).failed).toEqual([{ rowNumber: 2, errors: ['invalid_mobile'] }]);
    expect(await db.order.count()).toBe(2);
  });

  it('records the upload without customer names or phones', async () => {
    const buffer = await xlsx(ENGLISH_HEADERS, [goodEnglishRow(), ['deliver', 'Secret Name', '01009999999', '1 Nile St', '', 'Nowhere', '', '', '', '', '', '', '']]);
    const result = await importOrderSheet(owner, merchantId, buffer, 'orders.xlsx');
    const upload = await db.bulkUpload.findUniqueOrThrow({ where: { id: result.uploadId } });
    expect(upload).toMatchObject({ merchantId, fileName: 'orders.xlsx', rowCount: 2, createdCount: 1, failedCount: 1, uploadedBy: owner.id });
    expect(upload.fileHash).toMatch(/^[0-9a-f]{64}$/);
    const stored = JSON.stringify(upload.resultJson);
    expect(stored).not.toContain('Secret Name');
    expect(stored).not.toContain('01009999999');
    expect(stored).not.toContain('Mona Ali');
  });

  it('creates nothing new when the same file is uploaded twice and returns the same order numbers', async () => {
    const buffer = await xlsx(ENGLISH_HEADERS, [goodEnglishRow(), goodEnglishRow('01001234572'), ['deliver', 'Bad', '010', '1 Nile St', '', 'Nowhere', '', '', '', '', '', '', '']]);
    const first = await importOrderSheet(owner, merchantId, buffer, 'orders.xlsx');
    const countAfterFirst = await db.order.count();
    const second = await importOrderSheet(owner, merchantId, buffer, 'orders.xlsx');
    expect(countAfterFirst).toBe(2);
    expect(await db.order.count()).toBe(2);
    expect(second.created).toEqual(first.created);
    expect(second.failed).toEqual(first.failed);
    expect(second.uploadId).not.toBe(first.uploadId);
  });

  it('imports the example row of the template', async () => {
    const result = await importOrderSheet(owner, merchantId, await buildTemplateWorkbook('ar'), 'template.xlsx');
    expect(result.failed).toEqual([]);
    expect(result.created).toHaveLength(1);
  });

  it('refuses a member with finance-only access before reading the file', async () => {
    const financeMember = await makeSessionUser({ merchantId, access: 'finance' });
    const buffer = await xlsx(ENGLISH_HEADERS, [goodEnglishRow()]);
    await expect(importOrderSheet(financeMember, merchantId, buffer, 'orders.xlsx')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(importOrderSheet(financeMember, merchantId, Buffer.from('x'), 'orders.pdf')).rejects.toMatchObject({ code: 'forbidden' });
    expect(await db.order.count()).toBe(0);
    expect(await db.bulkUpload.count()).toBe(0);
  });

  it('refuses a .pdf file', async () => {
    await expect(importOrderSheet(owner, merchantId, Buffer.from('%PDF'), 'orders.pdf')).rejects.toMatchObject({ code: 'invalid_file' });
  });
});
