// Makes the common ways of writing the same Arabic place name compare equal.
// Kept free of imports: the seed script (plain Node) loads this file directly.

const TASHKEEL = /[ً-ٰٟ]/g;
const TATWEEL = /ـ/g;
const ALEF_FORMS = /[آأإٱ]/g; // آ أ إ ٱ
const TAA_MARBUTA = /ة/g; // ة
const ALEF_MAQSURA = /ى/g; // ى
const ARABIC_INDIC_DIGITS = /[٠-٩]/g;
const EASTERN_ARABIC_INDIC_DIGITS = /[۰-۹]/g;

export function normalizeForSearch(text: string): string {
  return text
    .replace(TASHKEEL, '')
    .replace(TATWEEL, '')
    .replace(ALEF_FORMS, 'ا')
    .replace(TAA_MARBUTA, 'ه')
    .replace(ALEF_MAQSURA, 'ي')
    .replace(ARABIC_INDIC_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(EASTERN_ARABIC_INDIC_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// The text an area is found by: both names plus its governorate's names.
export function areaSearchKey(nameEn: string, nameAr: string, governorate: { nameEn: string; nameAr: string }): string {
  return normalizeForSearch(`${nameAr} ${nameEn} ${governorate.nameAr} ${governorate.nameEn}`);
}
