import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, readSessionToken } from '@/accounts';
import { buildTemplateWorkbook } from '@/orders/bulk-upload';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// The empty bulk-upload spreadsheet with headers in English or Arabic. Signed-in users only.
export async function GET(request: NextRequest) {
  const sessionToken = await readSessionToken();
  const user = sessionToken ? await getSessionUser(sessionToken) : null;
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const locale = request.nextUrl.searchParams.get('locale') === 'ar' ? 'ar' : 'en';
  const workbook = await buildTemplateWorkbook(locale);
  return new NextResponse(new Uint8Array(workbook), {
    headers: {
      'Content-Type': XLSX_CONTENT_TYPE,
      'Content-Disposition': `attachment; filename="shiply-bulk-orders-${locale}.xlsx"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
