import { describe, expect, it } from 'vitest';
import { normalizeForSearch } from './arabic-search-normalization';

describe('normalizeForSearch', () => {
  it('treats taa marbuta and haa the same', () => {
    expect(normalizeForSearch('مدينه نصر')).toBe(normalizeForSearch('مدينة نصر'));
  });

  it('treats every form of alef the same', () => {
    const forms = ['أكتوبر', 'إكتوبر', 'آكتوبر', 'اكتوبر'].map(normalizeForSearch);
    expect(new Set(forms).size).toBe(1);
  });

  it('treats alef maqsura and yaa the same', () => {
    expect(normalizeForSearch('المعادى')).toBe(normalizeForSearch('المعادي'));
  });

  it('removes tashkeel and tatweel', () => {
    expect(normalizeForSearch('مَدِينَـــة')).toBe(normalizeForSearch('مدينة'));
  });

  it('turns Arabic digits into Latin and lower-cases English', () => {
    expect(normalizeForSearch('  مدينة ٦ أكتوبر ')).toBe(normalizeForSearch('مدينة 6 اكتوبر'));
    expect(normalizeForSearch('  Nasr CITY ')).toBe('nasr city');
  });
});
