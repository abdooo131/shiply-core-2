// Places Shiply knows. Edit this file and run `pnpm db:seed` to add or fix
// areas: the seed adds missing rows and never deletes.
// Pricing zones decide only the price; operations work by area.

export const PRICING_ZONES: ReadonlyArray<{ code: string; nameEn: string; nameAr: string }> = [
  { code: 'cairo_giza', nameEn: 'Cairo & Giza', nameAr: 'القاهرة والجيزة' },
  { code: 'alexandria', nameEn: 'Alexandria', nameAr: 'الإسكندرية' },
  { code: 'delta', nameEn: 'Delta', nameAr: 'الدلتا' },
  { code: 'canal', nameEn: 'Canal', nameAr: 'القناة' },
  { code: 'upper_egypt', nameEn: 'Upper Egypt', nameAr: 'الصعيد' },
  { code: 'red_sea_sinai', nameEn: 'Red Sea & Sinai', nameAr: 'البحر الأحمر وسيناء' },
];

// Owner decision 6 (18 Nov): which pricing zone each governorate belongs to.
export const GOVERNORATE_ZONE: Readonly<Record<string, string>> = {
  C: 'cairo_giza', GZ: 'cairo_giza',
  ALX: 'alexandria',
  KB: 'delta', SHR: 'delta', DK: 'delta', GH: 'delta', MNF: 'delta', BH: 'delta', KFS: 'delta', DT: 'delta',
  PTS: 'canal', IS: 'canal', SUZ: 'canal',
  FYM: 'upper_egypt', BNS: 'upper_egypt', MN: 'upper_egypt', AST: 'upper_egypt', SHG: 'upper_egypt',
  KN: 'upper_egypt', LX: 'upper_egypt', ASN: 'upper_egypt', WAD: 'upper_egypt',
  BA: 'red_sea_sinai', SIN: 'red_sea_sinai', JS: 'red_sea_sinai', MT: 'red_sea_sinai',
};

type AreaRow = readonly [nameEn: string, nameAr: string];

// Every district of Cairo and Giza (owner decision 1). To be checked by Shiply operations.
const CAIRO_AREAS: readonly AreaRow[] = [
  ['Nasr City', 'مدينة نصر'], ['Heliopolis', 'مصر الجديدة'], ['Sheraton', 'شيراتون'], ['Almaza', 'ألماظة'],
  ['El Nozha', 'النزهة'], ['New Cairo', 'القاهرة الجديدة'], ['Fifth Settlement', 'التجمع الخامس'],
  ['First Settlement', 'التجمع الأول'], ['Third Settlement', 'التجمع الثالث'], ['Rehab City', 'مدينة الرحاب'],
  ['Madinaty', 'مدينتي'], ['Shorouk City', 'مدينة الشروق'], ['Badr City', 'مدينة بدر'],
  ['New Administrative Capital', 'العاصمة الإدارية الجديدة'], ['Mostakbal City', 'مدينة المستقبل'],
  ['Katameya', 'القطامية'], ['Maadi', 'المعادي'], ['Zahraa El Maadi', 'زهراء المعادي'],
  ['Hadayek El Maadi', 'حدائق المعادي'], ['Mokattam', 'المقطم'], ['Basateen', 'البساتين'],
  ['Dar El Salam', 'دار السلام'], ['Tora', 'طرة'], ['Maasara', 'المعصرة'], ['Helwan', 'حلوان'],
  ['15th of May City', 'مدينة 15 مايو'], ['Tebbin', 'التبين'], ['Downtown', 'وسط البلد'],
  ['Zamalek', 'الزمالك'], ['Garden City', 'جاردن سيتي'], ['Abdeen', 'عابدين'], ['Azbakeya', 'الأزبكية'],
  ['Bulaq', 'بولاق'], ['Mosky', 'الموسكي'], ['Bab El Shaaria', 'باب الشعرية'], ['Gamaleya', 'الجمالية'],
  ['Al Darb Al Ahmar', 'الدرب الأحمر'], ['El Khalifa', 'الخليفة'], ['Sayeda Zeinab', 'السيدة زينب'],
  ['Old Cairo', 'مصر القديمة'], ['Manial', 'المنيل'], ['Manshiyat Naser', 'منشأة ناصر'],
  ['Abbassia', 'العباسية'], ['El Waily', 'الوايلي'], ['Hadayek El Kobba', 'حدائق القبة'],
  ['Zeitoun', 'الزيتون'], ['Ain Shams', 'عين شمس'], ['Matareya', 'المطرية'], ['El Marg', 'المرج'],
  ['El Salam City', 'مدينة السلام'], ['Ezbet El Nakhl', 'عزبة النخل'], ['Shubra', 'شبرا'],
  ['Rod El Farag', 'روض الفرج'], ['El Sahel', 'الساحل'], ['El Sharabiya', 'الشرابية'],
  ['El Zawya El Hamra', 'الزاوية الحمراء'], ['Amireya', 'الأميرية'],
];

const GIZA_AREAS: readonly AreaRow[] = [
  ['Dokki', 'الدقي'], ['Mohandessin', 'المهندسين'], ['Agouza', 'العجوزة'], ['Kit Kat', 'الكيت كات'],
  ['Imbaba', 'إمبابة'], ['Warraq', 'الوراق'], ['Bashtil', 'بشتيل'], ['Ard El Lewa', 'أرض اللواء'],
  ['Bulaq El Dakrour', 'بولاق الدكرور'], ['Nahya', 'ناهيا'], ['Giza', 'الجيزة'], ['Saft El Laban', 'صفط اللبن'],
  ['Omraneya', 'العمرانية'], ['Talbiya', 'الطالبية'], ['Haram', 'الهرم'], ['Faisal', 'فيصل'],
  ['Mariouteya', 'المريوطية'], ['Remaya', 'الرماية'], ['Hadayek El Ahram', 'حدائق الأهرام'],
  ['El Monib', 'المنيب'], ['Sakiet Mekki', 'ساقية مكي'], ['Abu Nomros', 'أبو النمرس'],
  ['Hawamdeya', 'الحوامدية'], ['Badrashin', 'البدرشين'], ['Dahshur', 'دهشور'], ['El Ayat', 'العياط'],
  ['El Saff', 'الصف'], ['Atfih', 'أطفيح'], ['6th of October City', 'مدينة 6 أكتوبر'],
  ['Hadayek October', 'حدائق أكتوبر'], ['Sheikh Zayed City', 'مدينة الشيخ زايد'],
  ['Smart Village', 'القرية الذكية'], ['Kerdasa', 'كرداسة'], ['Abu Rawash', 'أبو رواش'],
  ['Oseem', 'أوسيم'], ['Mansoureya', 'المنصورية'],
];

// The main city of each other governorate, so orders there can still be priced.
const MAIN_CITIES: Readonly<Record<string, AreaRow>> = {
  ALX: ['Alexandria', 'الإسكندرية'], KB: ['Banha', 'بنها'], SHR: ['Zagazig', 'الزقازيق'],
  DK: ['Mansoura', 'المنصورة'], GH: ['Tanta', 'طنطا'], MNF: ['Shebin El Kom', 'شبين الكوم'],
  BH: ['Damanhour', 'دمنهور'], KFS: ['Kafr El Sheikh', 'كفر الشيخ'], DT: ['Damietta', 'دمياط'],
  PTS: ['Port Said', 'بورسعيد'], IS: ['Ismailia', 'الإسماعيلية'], SUZ: ['Suez', 'السويس'],
  FYM: ['Faiyum', 'الفيوم'], BNS: ['Beni Suef', 'بني سويف'], MN: ['Minya', 'المنيا'],
  AST: ['Asyut', 'أسيوط'], SHG: ['Sohag', 'سوهاج'], KN: ['Qena', 'قنا'], LX: ['Luxor', 'الأقصر'],
  ASN: ['Aswan', 'أسوان'], BA: ['Hurghada', 'الغردقة'], WAD: ['Kharga', 'الخارجة'],
  MT: ['Marsa Matrouh', 'مرسى مطروح'], SIN: ['Arish', 'العريش'], JS: ['Sharm El Sheikh', 'شرم الشيخ'],
};

export const AREAS: ReadonlyArray<{ governorateCode: string; nameEn: string; nameAr: string }> = [
  ...CAIRO_AREAS.map(([nameEn, nameAr]) => ({ governorateCode: 'C', nameEn, nameAr })),
  ...GIZA_AREAS.map(([nameEn, nameAr]) => ({ governorateCode: 'GZ', nameEn, nameAr })),
  ...Object.entries(MAIN_CITIES).map(([governorateCode, [nameEn, nameAr]]) => ({ governorateCode, nameEn, nameAr })),
];
