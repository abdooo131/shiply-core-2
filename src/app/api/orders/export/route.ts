import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, readSessionToken } from '@/accounts';
import { exportOrdersCsv } from '@/orders/order-export';
import { AppError } from '@/shared/app-error';

const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';
const STATUS_FOR_ERROR: Record<string, number> = { forbidden: 403, invalid_input: 400, too_many_rows: 413 };

// The merchant's orders as CSV: the orders in `ids` (comma separated) or, without `ids`, all of them.
// Signed-in users only; exportOrdersCsv keeps it to their own merchant and checks 'orders' access.
export async function GET(request: NextRequest) {
  const sessionToken = await readSessionToken();
  const user = sessionToken ? await getSessionUser(sessionToken) : null;
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const merchantId = user.memberships[0]?.merchantId;
  if (!merchantId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const idsParam = request.nextUrl.searchParams.get('ids');
  const orderIds = idsParam === null ? undefined : idsParam.split(',').map((id) => id.trim()).filter(Boolean);

  try {
    const csv = await exportOrdersCsv(user, merchantId, { orderIds });
    return new NextResponse(new Uint8Array(csv), {
      headers: {
        'Content-Type': CSV_CONTENT_TYPE,
        'Content-Disposition': 'attachment; filename="shiply-orders.csv"',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof AppError && error.code in STATUS_FOR_ERROR) {
      return NextResponse.json({ error: error.code }, { status: STATUS_FOR_ERROR[error.code] });
    }
    console.error('Order export failed:', error instanceof Error ? error.name : 'unknown error');
    return NextResponse.json({ error: 'unexpected' }, { status: 500 });
  }
}
