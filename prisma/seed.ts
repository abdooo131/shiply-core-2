// Loads reference data and the first accounts. Safe to run again: it only
// creates rows that are missing. Run with `pnpm db:seed`.
import prismaClientPackage from '@prisma/client';
import argon2Package from '@node-rs/argon2';

import { areaSearchKey } from '../src/location/arabic-search-normalization.ts';
import { buildSamplePriceLines } from '../src/pricing/sample-price-lines.ts';
import { AREAS, GOVERNORATE_ZONE, PRICING_ZONES } from './seed-data/places.ts';

const { PrismaClient } = prismaClientPackage;

// Owner decisions of 18 Nov 2026 (GOAL.md §6.5, spec §10). Existing values are never overwritten.
const GLOBAL_SETTING_VALUES: Readonly<Record<string, number>> = {
  vat_basis_points: 1400,
  return_fee_basis_points: 5000,
  cod_fee_basis_points: 100,
  cod_fee_threshold_piasters: 300000,
  open_package_fee_piasters: 700,
  insurance_basis_points: 0,
};

// The seed writes a few hundred reference rows and hashes two passwords in one transaction.
const SEED_TRANSACTION_TIMEOUT_MS = 60_000;
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

type SeedTransaction = Parameters<Parameters<InstanceType<typeof PrismaClient>['$transaction']>[0]>[0];

// Pricing zones and areas; adds missing rows only, so edits in places.ts are safe to re-run.
async function seedPlaces(tx: SeedTransaction): Promise<void> {
  for (const [sortOrder, zone] of PRICING_ZONES.entries()) {
    await tx.pricingZone.upsert({ where: { code: zone.code }, create: { ...zone, sortOrder }, update: {} });
  }
  const governorateNames = new Map(GOVERNORATES.map(([code, nameEn, nameAr]) => [code, { nameEn, nameAr }]));
  for (const area of AREAS) {
    const governorate = governorateNames.get(area.governorateCode);
    const zoneCode = GOVERNORATE_ZONE[area.governorateCode];
    if (!governorate || !zoneCode) throw new Error(`Area ${area.nameEn} has an unknown governorate ${area.governorateCode}.`);
    await tx.area.upsert({
      where: { governorateCode_nameEn: { governorateCode: area.governorateCode, nameEn: area.nameEn } },
      create: { ...area, zoneCode, searchKey: areaSearchKey(area.nameEn, area.nameAr, governorate) },
      update: {},
    });
  }
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
      await seedPlaces(tx);
      for (const [key, value] of Object.entries(GLOBAL_SETTING_VALUES)) {
        await tx.setting.upsert({ where: { scope_key: { scope: 'global', key } }, create: { scope: 'global', key, valueJson: { value } }, update: {} });
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

      // Bootstrap only: the first default price list is switched on directly. Every later
      // list goes through proposePriceList and a second person's approval.
      const hasDefaultPrices = await tx.activePriceList.findUnique({ where: { scope: 'default' } });
      if (!hasDefaultPrices) {
        const list = await tx.priceList.create({
          data: {
            merchantId: null,
            version: 1,
            status: 'active',
            requestedBy: staff.id,
            activatedAt: new Date(),
            lines: { create: buildSamplePriceLines() },
          },
        });
        await tx.activePriceList.create({ data: { scope: 'default', priceListId: list.id } });
      }
    }, { timeout: SEED_TRANSACTION_TIMEOUT_MS });
    console.warn('Seed done.');
  } finally {
    await db.$disconnect();
  }
}

await main();
