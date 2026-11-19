import { expect, test, type Page } from '@playwright/test';

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? '';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? '';
const STAFF_EMAIL = process.env.SEED_STAFF_EMAIL ?? '';
const STAFF_PASSWORD = process.env.SEED_STAFF_PASSWORD ?? '';
const NOT_FOUND = 404;

test.beforeEach(() => {
  expect(OWNER_EMAIL, 'SEED_OWNER_EMAIL must be set in .env').not.toBe('');
  expect(STAFF_EMAIL, 'SEED_STAFF_EMAIL must be set in .env').not.toBe('');
});

async function signIn(page: Page, email: string, password: string, landing: RegExp, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/login`);
  await page.getByTestId('identifier').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(landing);
}

async function signOut(page: Page) {
  await page.getByTestId('sign-out').click();
  await expect(page).toHaveURL(/\/login$/);
}

async function createDelivery(page: Page, customerName: string): Promise<string> {
  await page.goto('/en/orders/new');
  await page.getByLabel('Phone number').fill('01001234567');
  await page.getByLabel('Full name', { exact: true }).fill(customerName);
  await page.getByLabel('Street address', { exact: true }).fill('12 Abbas El Akkad St');
  await page.getByRole('combobox', { name: 'Area' }).fill('nasr');
  await page.getByRole('option', { name: /Nasr City/ }).first().click();
  await page.getByLabel('Cash to collect').fill('1500');
  await expect(page.getByTestId('total-fee')).not.toHaveText('—');
  await page.getByTestId('create-order').click();
  const heading = page.getByRole('heading', { name: /Order \d{10} created/ });
  await expect(heading).toBeVisible();
  const number = (await heading.textContent())?.match(/\d{10}/)?.[0];
  if (!number) throw new Error('No order number on the created screen');
  return number;
}

async function moveTo(page: Page, number: string, status: string) {
  const row = page.getByTestId('staff-order-row').filter({ hasText: number });
  await row.getByTestId(`move-${number}-${status}`).click();
  await expect(row.getByRole('status')).toBeVisible();
}

test('a merchant cannot open the staff area', async ({ page }) => {
  await signIn(page, OWNER_EMAIL, OWNER_PASSWORD, /\/en$/);
  const response = await page.goto('/en/staff');
  expect(response?.status()).toBe(NOT_FOUND);
});

test('staff deliver a merchant order, with a failed attempt first, and the merchant sees it delivered', async ({ page }) => {
  await signIn(page, OWNER_EMAIL, OWNER_PASSWORD, /\/en$/);
  const number = await createDelivery(page, 'Staff Flow Customer');
  await signOut(page);

  await signIn(page, STAFF_EMAIL, STAFF_PASSWORD, /\/en\/staff$/);
  await expect(page.getByRole('heading', { name: 'Today at a glance' })).toBeVisible();
  await expect(page.getByTestId('staff-count-ordersOpen')).toBeVisible();

  await page.getByTestId('staff-nav-orders').click();
  await page.getByTestId('staff-order-search').fill(number);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByTestId('staff-order-row')).toHaveCount(1);
  // The search reloads the page; wait until its buttons are live before clicking them.
  await page.waitForLoadState('networkidle');

  await moveTo(page, number, 'picked_up');
  await moveTo(page, number, 'in_progress');
  await moveTo(page, number, 'out_for_delivery');

  const row = page.getByTestId('staff-order-row').filter({ hasText: number });
  await row.getByTestId(`move-${number}-attempt_failed`).click();
  await page.getByTestId('fail-reason').selectOption('customer_not_answering');
  await page.getByTestId('fail-confirm').click();
  await expect(row).toContainText('Delivery attempt failed');
  await expect(row).toContainText('Attempts: 1');

  await moveTo(page, number, 'out_for_delivery');
  await moveTo(page, number, 'delivered');
  await expect(row).toContainText('Final');
  await signOut(page);

  await signIn(page, OWNER_EMAIL, OWNER_PASSWORD, /\/en$/);
  // The delivery booked money: today's collected cash on Home is now above zero.
  const collected = await page.getByTestId('home-money').locator('.v bdi').textContent();
  expect(Number((collected ?? '0').replace(/[^\d.]/g, ''))).toBeGreaterThan(0);

  await page.goto(`/en/orders/${number}?tab=tracking`);
  const timeline = page.getByTestId('timeline');
  await expect(timeline).toContainText('Delivery attempt failed · Customer not answering the phone');
  await expect(timeline).toContainText('Delivered');
});

test('staff answer a merchant ticket and the merchant sees the reply', async ({ page }) => {
  const subject = `Staff reply check ${Date.now()}`;
  await signIn(page, OWNER_EMAIL, OWNER_PASSWORD, /\/en$/);
  await page.goto('/en/support');
  await page.getByTestId('new-ticket-open').click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByTestId('ticket-topic').selectOption('pickup');
  await dialog.getByTestId('ticket-subject').fill(subject);
  await dialog.getByTestId('ticket-body').fill('Where is my pickup?');
  await dialog.getByTestId('ticket-submit').click();
  await expect(page).toHaveURL(/\/en\/support\/T\d{6}$/);
  const ticketUrl = page.url();
  await signOut(page);

  await signIn(page, STAFF_EMAIL, STAFF_PASSWORD, /\/en\/staff$/);
  await page.goto('/en/staff/support');
  await page.getByTestId('staff-ticket').filter({ hasText: subject }).getByRole('link').click();
  await page.getByTestId('staff-reply').fill('The courier arrives before 3 PM.');
  await page.getByTestId('staff-send-reply').click();
  await expect(page.getByTestId('staff-thread-message')).toHaveCount(2);
  await signOut(page);

  await signIn(page, OWNER_EMAIL, OWNER_PASSWORD, /\/en$/);
  await page.goto(ticketUrl);
  await expect(page.getByTestId('ticket-thread')).toContainText('The courier arrives before 3 PM.');
});

test('the staff area reads right to left in Arabic and fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, STAFF_EMAIL, STAFF_PASSWORD, /\/ar\/staff$/, 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  for (const path of ['/ar/staff', '/ar/staff/orders', '/ar/staff/pickups', '/ar/staff/approvals', '/ar/staff/money', '/ar/staff/support']) {
    await page.goto(path);
    await expect(page.getByTestId('staff-badge')).toHaveText('منطقة الفريق');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
  }
});
