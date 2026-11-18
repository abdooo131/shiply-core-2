import { describe, expect, it } from 'vitest';
import { db } from '@/shared/db';
import { getArea, searchAreas } from './areas';

// Areas are reference data loaded by the seed; tests only read them.
describe('areas', () => {
  it('finds Nasr City however its Arabic name is spelled, or in English', async () => {
    for (const query of ['مدينه نصر', 'مدينة نصر', 'nasr', 'Nasr City']) {
      const [first] = await searchAreas(query);
      expect(first?.nameEn, query).toBe('Nasr City');
    }
  });

  it('finds 6th of October with Arabic digits and any alef', async () => {
    const results = await searchAreas('٦ اكتوبر');
    expect(results.map((area) => area.nameEn)).toContain('6th of October City');
  });

  it('returns nothing for a blank query and at most the limit', async () => {
    expect(await searchAreas('   ')).toEqual([]);
    expect((await searchAreas('a')).length).toBeLessThanOrEqual(20);
    expect((await searchAreas('a', { limit: 5 })).length).toBe(5);
  });

  it('gives an area with its governorate and pricing zone', async () => {
    const [maadi] = await searchAreas('المعادى');
    const area = await getArea(maadi?.id ?? '');
    expect(area).toMatchObject({ nameEn: 'Maadi', governorateCode: 'C', governorateNameEn: 'Cairo', zoneCode: 'cairo_giza', isServed: true });
  });

  it('returns null for an unknown area', async () => {
    expect(await getArea('00000000-0000-0000-0000-000000000000')).toBeNull();
    expect(await getArea('not-a-uuid')).toBeNull();
  });

  it('keeps Cairo and Giza in one pricing zone while each district stays its own area', async () => {
    const zones = await db.area.groupBy({ by: ['zoneCode'], where: { governorateCode: { in: ['C', 'GZ'] } } });
    expect(zones.map((zone) => zone.zoneCode)).toEqual(['cairo_giza']);
    expect(await db.area.count({ where: { governorateCode: { in: ['C', 'GZ'] } } })).toBeGreaterThanOrEqual(70);
  });
});
