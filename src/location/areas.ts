import { db } from '@/shared/db';
import { normalizeForSearch } from './arabic-search-normalization';

export type AreaView = {
  id: string;
  nameEn: string;
  nameAr: string;
  governorateCode: string;
  governorateNameEn: string;
  governorateNameAr: string;
  zoneCode: string;
  isServed: boolean;
};

const DEFAULT_SEARCH_LIMIT = 20;
// Matches are ranked in code, so fetch a bounded set of candidates first.
const MAX_CANDIDATES = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AREA_SELECT = {
  id: true,
  nameEn: true,
  nameAr: true,
  governorateCode: true,
  zoneCode: true,
  isServed: true,
  governorate: { select: { nameEn: true, nameAr: true } },
} as const;

type AreaRow = {
  id: string;
  nameEn: string;
  nameAr: string;
  governorateCode: string;
  zoneCode: string;
  isServed: boolean;
  governorate: { nameEn: string; nameAr: string };
};

function toView(row: AreaRow): AreaView {
  return {
    id: row.id,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    governorateCode: row.governorateCode,
    governorateNameEn: row.governorate.nameEn,
    governorateNameAr: row.governorate.nameAr,
    zoneCode: row.zoneCode,
    isServed: row.isServed,
  };
}

export async function getArea(areaId: string): Promise<AreaView | null> {
  if (!UUID_PATTERN.test(areaId)) return null;
  const row = await db.area.findUnique({ where: { id: areaId }, select: AREA_SELECT });
  return row ? toView(row) : null;
}

export async function searchAreas(query: string, options: { limit?: number } = {}): Promise<AreaView[]> {
  const normalized = normalizeForSearch(query);
  if (!normalized) return [];
  const rows = await db.area.findMany({
    where: { searchKey: { contains: normalized } },
    select: AREA_SELECT,
    take: MAX_CANDIDATES,
  });
  return rows
    .map((row) => ({ row, rank: matchRank(row, normalized) }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(b.row.isServed) - Number(a.row.isServed) ||
        a.row.nameEn.length - b.row.nameEn.length ||
        a.row.nameEn.localeCompare(b.row.nameEn),
    )
    .slice(0, options.limit ?? DEFAULT_SEARCH_LIMIT)
    .map(({ row }) => toView(row));
}

// 0: the area's own name is exactly the query; 1: its name starts with it; 2: anything else.
function matchRank(row: AreaRow, normalizedQuery: string): number {
  const names = [normalizeForSearch(row.nameAr), normalizeForSearch(row.nameEn)];
  if (names.includes(normalizedQuery)) return 0;
  if (names.some((name) => name.startsWith(normalizedQuery))) return 1;
  return 2;
}
