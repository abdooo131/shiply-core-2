import type { SessionUser } from '@/accounts';
import { writeAudit } from '@/platform/audit-log';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';

// Business values that change without a code change. Percentages are basis points (1400 = 14%).
export const SETTING_KEYS = [
  'vat_basis_points',
  'return_fee_basis_points',
  'cod_fee_basis_points',
  'cod_fee_threshold_piasters',
  'open_package_fee_piasters',
  'insurance_basis_points',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

const GLOBAL_SCOPE = 'global';
const STAFF_ROLES_ALLOWED_TO_CHANGE = new Set(['admin', 'finance']);

function scopeFor(merchantId?: string): string {
  return merchantId ? `merchant:${merchantId}` : GLOBAL_SCOPE;
}

function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key);
}

function readStoredValue(valueJson: unknown): number | null {
  const value = (valueJson as { value?: unknown } | null)?.value;
  return typeof value === 'number' ? value : null;
}

// The merchant's own value when one is set, otherwise the global value.
export async function getSettingValue(key: SettingKey, merchantId?: string): Promise<number> {
  const scopes = merchantId ? [scopeFor(merchantId), GLOBAL_SCOPE] : [GLOBAL_SCOPE];
  const rows = await db.setting.findMany({ where: { key, scope: { in: scopes } } });
  for (const scope of scopes) {
    const value = readStoredValue(rows.find((row) => row.scope === scope)?.valueJson);
    if (value !== null) return value;
  }
  throw new Error(`Setting "${key}" has no global value. Run \`pnpm db:seed\` or set it as Shiply finance.`);
}

export async function setSettingValue(staffUser: SessionUser, key: SettingKey, value: number, merchantId?: string): Promise<void> {
  if (!staffUser.staffRoles.some((role) => STAFF_ROLES_ALLOWED_TO_CHANGE.has(role))) throw new AppError('forbidden', 403);
  if (!isSettingKey(key) || !Number.isSafeInteger(value) || value < 0) throw new AppError('invalid_input');

  const scope = scopeFor(merchantId);
  await db.$transaction(async (tx) => {
    const existing = await tx.setting.findUnique({ where: { scope_key: { scope, key } } });
    await tx.setting.upsert({
      where: { scope_key: { scope, key } },
      create: { scope, key, valueJson: { value } },
      update: { valueJson: { value } },
    });
    await writeAudit(tx, {
      actorUserId: staffUser.id,
      action: 'setting.changed',
      entityType: 'Setting',
      entityId: `${scope}/${key}`,
      before: existing ? { value: readStoredValue(existing.valueJson) } : null,
      after: { value },
    });
  });
}
