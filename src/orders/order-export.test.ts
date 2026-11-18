import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@/accounts';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { formatCairo } from '@/shared/cairo-time';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { exportOrdersCsv } from './order-export';
import { generateOrderNumber } from './order-number';
import { insertTestOrder } from './orders-test-fixtures';

const UTF8_BOM = [0xef, 0xbb, 0xbf];

let merchantId = '';
let owner: SessionUser;

beforeEach(async () => {
  await resetTestDatabase();
  merchantId = (await makeMerchant()).id;
  owner = await makeSessionUser({ merchantId, access: 'full' });
});

// A small RFC 4180 reader so the test checks what a spreadsheet would see.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let isQuoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (isQuoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        isQuoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      isQuoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readCsv(buffer: Buffer): string[][] {
  expect([...buffer.subarray(0, 3)]).toEqual(UTF8_BOM);
  return parseCsv(buffer.subarray(3).toString('utf8'));
}

describe('exportOrdersCsv', () => {
  it('writes a UTF-8 CSV with a BOM where Arabic, commas, quotes and new lines survive', async () => {
    const order = await insertTestOrder(merchantId, { customerName: 'منى "الأولى", علي\nالسيدة' });
    await db.order.update({
      where: { id: order.id },
      data: { codAmountPiasters: 150050, merchantReference: 'REF,1', status: 'out_for_delivery' },
    });

    const rows = readCsv(await exportOrdersCsv(owner, merchantId, {}));

    expect(rows[0]).toEqual([
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
    ]);
    expect(rows[1]).toEqual([
      order.number,
      formatCairo(order.createdAt, 'en', 'dateTime'),
      'deliver',
      'out_for_delivery',
      'منى "الأولى", علي\nالسيدة',
      '+201001234567',
      'Nasr City',
      'Cairo',
      '1500.50',
      '77.52',
      'REF,1',
    ]);
    expect(rows).toHaveLength(2);
  });

  it('exports only the chosen orders of this merchant, never another merchant’s', async () => {
    const first = await insertTestOrder(merchantId);
    await insertTestOrder(merchantId);
    const otherMerchantId = (await makeMerchant('Other', 'آخر')).id;
    const theirs = await insertTestOrder(otherMerchantId);

    const chosen = readCsv(await exportOrdersCsv(owner, merchantId, { orderIds: [first.id, theirs.id, 'not-a-uuid'] }));
    expect(chosen.slice(1).map((row) => row[0])).toEqual([first.number]);

    const everything = readCsv(await exportOrdersCsv(owner, merchantId, {}));
    expect(everything).toHaveLength(3);
    expect(everything.map((row) => row[0])).not.toContain(theirs.number);
  });

  it('neutralises cells that a spreadsheet would run as a formula', async () => {
    const order = await insertTestOrder(merchantId, { customerName: '=HYPERLINK("http://x")' });
    const rows = readCsv(await exportOrdersCsv(owner, merchantId, { orderIds: [order.id] }));
    expect(rows[1]?.[4]).toBe('\'=HYPERLINK("http://x")');
  });

  it('refuses more than 5,000 rows', async () => {
    const template = await insertTestOrder(merchantId);
    const copy = {
      merchantId,
      type: template.type,
      customerId: template.customerId,
      customerName: template.customerName,
      customerMobile: template.customerMobile,
      addressText: template.addressText,
      areaId: template.areaId,
      size: template.size,
      shippingPiasters: template.shippingPiasters,
      vatPiasters: template.vatPiasters,
      totalFeePiasters: template.totalFeePiasters,
      createdBy: template.createdBy,
    };
    await db.order.createMany({ data: Array.from({ length: 5000 }, () => ({ ...copy, number: generateOrderNumber() })) });

    await expect(exportOrdersCsv(owner, merchantId, {})).rejects.toMatchObject({ code: 'too_many_rows' });
  });

  it('refuses a member without order access', async () => {
    const finance = await makeSessionUser({ merchantId, access: 'finance' });
    await expect(exportOrdersCsv(finance, merchantId, {})).rejects.toMatchObject({ code: 'forbidden' });
  });
});
