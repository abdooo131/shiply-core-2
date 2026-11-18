import { expect, test, type Page } from '@playwright/test';

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? '';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? '';
const MS_PER_DAY = 86_400_000;

type Locale = 'en' | 'ar';

const TEXT = {
  en: { scheduled: 'Scheduled', canceled: 'Canceled', everyWeek: 'Every week', areaQuery: 'nasr', areaOption: /Nasr City/ },
  ar: { scheduled: 'مجدول', canceled: 'ملغي', everyWeek: 'كل أسبوع', areaQuery: 'مدينه نصر', areaOption: /مدينة نصر/ },
} as const;

async function signIn(page: Page, locale: Locale) {
  await page.goto(`/${locale}/login`);
  await page.getByTestId('identifier').fill(OWNER_EMAIL);
  await page.getByTestId('password').fill(OWNER_PASSWORD);
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(new RegExp(`/${locale}$`));
}

// Pickup days are Cairo calendar days, whatever the machine's time zone.
function cairoDayFromToday(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(Date.parse(`${today}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

async function addLocation(page: Page, locale: Locale, label: string, address: string) {
  await page.goto(`/${locale}/pickups?tab=locations`);
  await page.getByTestId('location-add').click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByTestId('location-label').fill(label);
  await dialog.getByTestId('location-address').fill(address);
  await dialog.getByTestId('location-area').fill(TEXT[locale].areaQuery);
  await dialog.getByRole('option', { name: TEXT[locale].areaOption }).first().click();
  await dialog.getByTestId('location-contact-name').fill('E2E Contact');
  await dialog.getByTestId('location-contact-mobile').fill('01012345678');
  await dialog.getByTestId('location-save').click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.getByTestId('location-row').filter({ hasText: label })).toBeVisible();
}

async function requestPickup(page: Page, locale: Locale, label: string, day: string, count: number, repeatWeekly: boolean) {
  await page.goto(`/${locale}/pickups`);
  await page.getByTestId('request-pickup-open').click();
  const dialog = page.locator('dialog[open]');
  const locationValue = await dialog.locator('[data-testid="pickup-location"] option', { hasText: label }).getAttribute('value');
  await dialog.getByTestId('pickup-location').selectOption(locationValue ?? '');
  await dialog.getByTestId('pickup-day').fill(day);
  await dialog.getByTestId('pickup-count').fill(String(count));
  if (repeatWeekly) await dialog.getByTestId('pickup-repeat').check();
  await dialog.getByTestId('pickup-submit').click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

async function cancelPickupRow(page: Page, address: string) {
  const row = page.getByTestId('pickup-row').filter({ hasText: address });
  await row.getByTestId('pickup-cancel').click();
  await page.locator('dialog[open]').getByTestId('pickup-cancel-confirm').click();
  await expect(row).toHaveCount(0);
}

test.beforeEach(() => {
  expect(OWNER_EMAIL, 'SEED_OWNER_EMAIL must be set in .env').not.toBe('');
});

for (const locale of ['en', 'ar'] as const) {
  test(`adds a location, requests, cancels and repeats pickups (${locale})`, async ({ page }) => {
    const stamp = `${locale}-${Date.now()}`;
    const label = `E2E pickup ${stamp}`;
    const address = `${stamp} Pickup Street, building 4`;
    await signIn(page, locale);

    await addLocation(page, locale, label, address);

    // A one-off pickup for tomorrow shows in Upcoming with the expected count.
    await requestPickup(page, locale, label, cairoDayFromToday(1), 7, false);
    const oneOff = page.getByTestId('pickup-row').filter({ hasText: address });
    await expect(oneOff).toBeVisible();
    await expect(oneOff).toContainText(TEXT[locale].scheduled);
    await expect(oneOff.getByTestId('pickup-expected')).toHaveText('7');
    await expect(oneOff).not.toContainText(TEXT[locale].everyWeek);

    // Canceling moves it to History.
    await cancelPickupRow(page, address);
    await page.getByTestId('pickups-tab-history').click();
    await expect(page).toHaveURL(/tab=history/);
    await expect(page.getByTestId('pickup-row').filter({ hasText: address }).first()).toContainText(TEXT[locale].canceled);

    // A weekly pickup shows "Every week" until repeating is stopped.
    await requestPickup(page, locale, label, cairoDayFromToday(2), 5, true);
    const weekly = page.getByTestId('pickup-row').filter({ hasText: address });
    await expect(weekly).toContainText(TEXT[locale].everyWeek);
    await expect(weekly.getByTestId('pickup-expected')).toHaveText('5');
    await weekly.getByTestId('pickup-stop').click();
    await expect(weekly).not.toContainText(TEXT[locale].everyWeek);
    await expect(weekly.getByTestId('pickup-stop')).toHaveCount(0);

    // Leave the shared dev database as it was: the orders attached to this pickup go back to New.
    await cancelPickupRow(page, address);
    // ...and the test location is archived, so it no longer shows in the list.
    await page.goto(`/${locale}/pickups?tab=locations`);
    await page.getByTestId('location-row').filter({ hasText: label }).getByTestId('location-archive').click();
    await page.locator('dialog[open]').getByTestId('location-archive-confirm').click();
    await expect(page.getByTestId('location-row').filter({ hasText: label })).toHaveCount(0);
  });
}
