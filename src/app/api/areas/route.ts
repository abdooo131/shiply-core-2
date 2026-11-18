import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, readSessionToken } from '@/accounts';
import { searchAreas } from '@/location';

const MAX_QUERY_LENGTH = 60;
const SUGGESTION_LIMIT = 10;

// Area suggestions for address fields. Signed-in users only; returns names, never personal data.
export async function GET(request: NextRequest) {
  const sessionToken = await readSessionToken();
  const user = sessionToken ? await getSessionUser(sessionToken) : null;
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const query = (request.nextUrl.searchParams.get('q') ?? '').slice(0, MAX_QUERY_LENGTH);
  const areas = await searchAreas(query, { limit: SUGGESTION_LIMIT });
  return NextResponse.json({
    areas: areas
      .filter((area) => area.isServed)
      .map((area) => ({
        id: area.id,
        nameEn: area.nameEn,
        nameAr: area.nameAr,
        governorateNameEn: area.governorateNameEn,
        governorateNameAr: area.governorateNameAr,
      })),
  });
}
