// Loads reference data and the first accounts. Safe to run again: it only
// creates rows that are missing. Run with `pnpm db:seed`.
import prismaClientPackage from '@prisma/client';
import argon2Package from '@node-rs/argon2';

const { PrismaClient } = prismaClientPackage;
const { hash } = argon2Package;

// The 27 governorates of Egypt, keyed by their ISO 3166-2:EG code.
const GOVERNORATES: ReadonlyArray<readonly [code: string, nameEn: string, nameAr: string]> = [
  ['C', 'Cairo', 'القاهرة'],
  ['GZ', 'Giza', 'الجيزة'],
  ['ALX', 'Alexandria', 'الإسكندرية'],
  ['KB', 'Qalyubia', 'القليوبية'],
  ['SHR', 'Sharqia', 'الشرقية'],
  ['DK', 'Dakahlia', 'الدقهلية'],
  ['GH', 'Gharbia', 'الغربية'],
  ['MNF', 'Monufia', 'المنوفية'],
  ['BH', 'Beheira', 'البحيرة'],
  ['KFS', 'Kafr El Sheikh', 'كفر الشيخ'],
  ['DT', 'Damietta', 'دمياط'],
  ['PTS', 'Port Said', 'بورسعيد'],
  ['IS', 'Ismailia', 'الإسماعيلية'],
  ['SUZ', 'Suez', 'السويس'],
  ['FYM', 'Faiyum', 'الفيوم'],
  ['BNS', 'Beni Suef', 'بني سويف'],
  ['MN', 'Minya', 'المنيا'],
  ['AST', 'Asyut', 'أسيوط'],
  ['SHG', 'Sohag', 'سوهاج'],
  ['KN', 'Qena', 'قنا'],
  ['LX', 'Luxor', 'الأقصر'],
  ['ASN', 'Aswan', 'أسوان'],
  ['BA', 'Red Sea', 'البحر الأحمر'],
  ['WAD', 'New Valley', 'الوادي الجديد'],
  ['MT', 'Matrouh', 'مطروح'],
  ['SIN', 'North Sinai', 'شمال سيناء'],
  ['JS', 'South Sinai', 'جنوب سيناء'],
];

const FIRST_MERCHANT = { nameEn: 'Eve Chantelle', nameAr: 'إيف شانتيل', industry: 'Fashion' };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Seed needs ${name} in .env (see .env.example).`);
  return value;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed refused: NODE_ENV is production. The seed is for local and test databases only.');
  }
  const ownerEmail = requireEnv('SEED_OWNER_EMAIL').toLowerCase();
  const ownerPassword = requireEnv('SEED_OWNER_PASSWORD');
  const staffEmail = requireEnv('SEED_STAFF_EMAIL').toLowerCase();
  const staffPassword = requireEnv('SEED_STAFF_PASSWORD');

  const db = new PrismaClient();
  try {
    await db.$transaction(async (tx) => {
      for (const [code, nameEn, nameAr] of GOVERNORATES) {
        await tx.governorate.upsert({ where: { code }, create: { code, nameEn, nameAr }, update: {} });
      }

      const owner =
        (await tx.user.findUnique({ where: { email: ownerEmail } })) ??
        (await tx.user.create({
          data: { email: ownerEmail, name: 'Owner', passwordHash: await hash(ownerPassword), language: 'ar' },
        }));

      const merchant =
        (await tx.merchant.findFirst({ where: { nameEn: FIRST_MERCHANT.nameEn } })) ??
        (await tx.merchant.create({ data: FIRST_MERCHANT }));

      await tx.merchantMember.upsert({
        where: { merchantId_userId: { merchantId: merchant.id, userId: owner.id } },
        create: { merchantId: merchant.id, userId: owner.id, access: 'full', status: 'active' },
        update: {},
      });

      const staff =
        (await tx.user.findUnique({ where: { email: staffEmail } })) ??
        (await tx.user.create({
          data: { email: staffEmail, name: 'Shiply Admin', passwordHash: await hash(staffPassword), language: 'en' },
        }));

      await tx.staffRole.upsert({
        where: { userId_role: { userId: staff.id, role: 'admin' } },
        create: { userId: staff.id, role: 'admin' },
        update: {},
      });
    });
    console.warn('Seed done.');
  } finally {
    await db.$disconnect();
  }
}

await main();
