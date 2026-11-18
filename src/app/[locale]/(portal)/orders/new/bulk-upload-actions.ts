'use server';

import { requireUser } from '@/accounts';
import { routing, type Locale } from '@/i18n/routing';
import { importOrderSheet } from '@/orders/bulk-upload';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';

// Matches serverActions.bodySizeLimit in next.config.ts, which leaves room for the form around the file.
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const KNOWN_ERRORS = new Set(['invalid_file', 'too_many_rows', 'forbidden']);

export type BulkUploadState =
  | { status: 'idle' }
  | { status: 'error'; errorKey: string }
  | {
      status: 'ok';
      created: { rowNumber: number; orderNumber: string }[];
      failed: { rowNumber: number; errors: string[] }[];
      orderIds: string[];
    };

function toLocale(locale: string): Locale {
  return routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
}

export async function uploadOrdersAction(locale: string, _previous: BulkUploadState, formData: FormData): Promise<BulkUploadState> {
  try {
    const user = await requireUser(toLocale(locale));
    const merchantId = user.memberships[0]?.merchantId;
    if (!merchantId) throw new AppError('forbidden', 403);

    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { status: 'error', errorKey: 'no_file' };
    if (file.size > MAX_FILE_BYTES) return { status: 'error', errorKey: 'file_too_large' };

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importOrderSheet(user, merchantId, buffer, file.name);
    const numbers = result.created.map((row) => row.orderNumber);
    const orders = numbers.length
      ? await db.order.findMany({ where: { merchantId, number: { in: numbers } }, select: { id: true } })
      : [];
    return { status: 'ok', created: result.created, failed: result.failed, orderIds: orders.map((order) => order.id) };
  } catch (error) {
    if (error instanceof AppError && KNOWN_ERRORS.has(error.code)) return { status: 'error', errorKey: error.code };
    console.error('Bulk upload failed:', error instanceof Error ? error.name : 'unknown error');
    return { status: 'error', errorKey: 'unexpected' };
  }
}
