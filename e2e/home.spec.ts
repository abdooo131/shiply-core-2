import { PrismaClient } from '@prisma/client';
import { expect, test, type Page } from '@playwright/test';

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? '';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? '';
const PHONE_WIDTH = 375;
const CHART_DAYS = 14;

const db = new PrismaClient();

test.afterAll(async () => {
  await db.$disconnect();
});

test.beforeEach(() => {
  expect(OWNER_EMAIL, 'SEED_OWNER_EMAIL must be set in .env').not.toBe('');
});

async function signIn(page: Page, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/login`);
  await page.getByTestId('identifier').fill(OWNER_EMAIL);
  await page.getByTestId('password').fill(OWNER_PASSWORD);
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(new RegExp(`/${locale}$`));
}

async function ownerMerchant() {
  const member = await db.merchantMember.findFirstOrThrow({ where: { user: { email: OWNER_EMAIL } }, include: { merchant: true } });
  return member.merchant;
}

// Creates a delivery through the real Create order screen and returns its number.
async function createDelivery(page: Page, customerName: string): Promise<string> {
  await page.goto('/en/orders/new');
  await page.getByLabel('Phone number').fill('01001234567');
  await page.getByLabel('Full name', { exact: true }).fill(customerName);
  await page.getByLabel('Street address', { exact: true }).fill('12 Abbas El Akkad St');
  await page.getByRole('combobox', { name: 'Area' }).fill('nasr');
  await page.getByRole('option', { name: /Nasr City/ }).first().click();
  await page.getByLabel('Cash to collect').fill('900');
  await expect(page.getByTestId('total-fee')).not.toHaveText('—');
  await page.getByTestId('create-order').click();
  const heading = page.getByRole('heading', { name: /Order \d{10} created/ });
  await expect(heading).toBeVisible();
  const number = (await heading.textContent())?.match(/\d{10}/)?.[0];
  if (!number) throw new Error('No order number on the created screen');
  return number;
}

// The hub puts orders in "awaiting your action"; the screens cannot, so the test sets it directly.
async function makeAwaiting(number: string) {
  await db.order.update({ where: { number }, data: { status: 'awaiting_merchant_action', attempts: 1 } });
}

test('English Home greets the merchant by name, shows today and a 14-day chart', async ({ page }) => {
  const merchant = await ownerMerchant();
  await signIn(page);
  await expect(page.getByTestId('greeting')).toHaveText(new RegExp(`^Good (morning|afternoon|evening), ${merchant.nameEn}$`));
  await expect(page.getByTestId('today-headline')).toContainText(/^Today: \d+ delivered, \d+ picked up, \d+ new orders?/);
  await expect(page.getByTestId('deliveries-chart').getByTestId('chart-day')).toHaveCount(CHART_DAYS);
  await expect(page.getByTestId('deliveries-card')).toContainText('Last 14 days');
  await page.getByRole('link', { name: /Pick & Choose/ }).click();
  await expect(page).toHaveURL(/\/en\/products$/);
});

test('Arabic Home greets the merchant by Arabic name, right to left, with a 14-day chart', async ({ page }) => {
  const merchant = await ownerMerchant();
  await signIn(page, 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('greeting')).toHaveText(new RegExp(`^(صباح الخير|نهارك سعيد|مساء الخير)، ${merchant.nameAr}$`));
  await expect(page.getByTestId('today-headline')).toContainText(/^النهارده: \d+ اتوصّلوا، \d+ اتاستلموا، /);
  await expect(page.getByTestId('deliveries-chart').getByTestId('chart-day')).toHaveCount(CHART_DAYS);
});

test('answers an order that needs action from Home, with a required note', async ({ page }) => {
  await signIn(page);
  const number = await createDelivery(page, `Home needs action ${Date.now()}`);
  await makeAwaiting(number);
  await page.goto('/en');

  await expect(page.getByTestId('today-headline')).toContainText(/need(s)? your action/);
  const row = page.getByTestId('needs-action-row').filter({ hasText: number });
  await expect(row).toContainText('The courier needs your decision · attempt 1 of 3');
  await row.getByRole('button', { name: 'Deliver again' }).click();
  await row.getByTestId('send-answer').click();
  await expect(row.getByText('Write a short note so the courier knows what to do.')).toBeVisible();

  await row.getByLabel('Note for the courier').fill('Customer confirmed, deliver after 5 pm');
  await row.getByTestId('send-answer').click();
  await expect(page.getByText(`We'll try delivering order ${number} again`)).toBeVisible();
  await expect(page.getByTestId('needs-action-row').filter({ hasText: number })).toHaveCount(0);
  expect((await db.order.findUniqueOrThrow({ where: { number } })).status).toBe('in_progress');
});

test('answers "return to me" from the Arabic Home', async ({ page }) => {
  await signIn(page);
  const number = await createDelivery(page, `Home return ${Date.now()}`);
  await makeAwaiting(number);
  await page.goto('/ar');

  const row = page.getByTestId('needs-action-row').filter({ hasText: number });
  await row.getByRole('button', { name: 'رجّعه ليا' }).click();
  await row.getByLabel('ملاحظة للمندوب').fill('العميل لغى الطلب، رجّعوه');
  await row.getByTestId('send-answer').click();
  await expect(page.getByText(`الطلب ${number} راجع لك`)).toBeVisible();
  expect((await db.order.findUniqueOrThrow({ where: { number } })).status).toBe('returning');
});

for (const locale of ['en', 'ar'] as const) {
  test(`Home has no sideways scrolling on a ${PHONE_WIDTH}px phone (${locale})`, async ({ page }) => {
    await page.setViewportSize({ width: PHONE_WIDTH, height: 812 });
    await signIn(page, locale);
    await expect(page.getByTestId('deliveries-chart').getByTestId('chart-day')).toHaveCount(CHART_DAYS);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(PHONE_WIDTH);
  });
}
