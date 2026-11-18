import { PrismaClient, type OrderStatus } from '@prisma/client';
import { expect, test, type Page } from '@playwright/test';

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? '';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? '';
// A second merchant that exists only so the test can type its order number into the URL.
const OTHER_MERCHANT_ID = '00000000-0000-4000-8000-00000000e2e1';

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

// Creates a delivery through the real Create order screen and returns its number.
async function createDelivery(page: Page, customerName: string): Promise<string> {
  await page.goto('/en/orders/new');
  await page.getByLabel('Phone number').fill('01001234567');
  await page.getByLabel('Full name', { exact: true }).fill(customerName);
  await page.getByLabel('Street address', { exact: true }).fill('12 Abbas El Akkad St');
  await page.getByRole('combobox', { name: 'Area' }).fill('nasr');
  await page.getByRole('option', { name: /Nasr City/ }).first().click();
  await page.getByLabel('Cash to collect').fill('1500');
  await page.getByLabel('Your order number (optional)').fill('EC-E2E');
  await expect(page.getByTestId('total-fee')).not.toHaveText('—');
  await page.getByTestId('create-order').click();
  const heading = page.getByRole('heading', { name: /Order \d{10} created/ });
  await expect(heading).toBeVisible();
  const number = (await heading.textContent())?.match(/\d{10}/)?.[0];
  if (!number) throw new Error('No order number on the created screen');
  return number;
}

// Statuses the merchant cannot reach from the screens yet are set directly, like the hub would.
async function setStatus(number: string, status: OrderStatus, attempts = 0) {
  await db.order.update({ where: { number }, data: { status, attempts } });
}

const egp = (piasters: number) => `EGP ${(piasters / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

test('details and fee breakdown match the stored order, and the timeline shows it was created', async ({ page }) => {
  await signIn(page);
  const name = `Order page ${Date.now()}`;
  const number = await createDelivery(page, name);
  const stored = await db.order.findUniqueOrThrow({ where: { number } });

  await page.goto(`/en/orders/${number}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  await expect(page.getByTestId('order-number')).toHaveText(`#${number}`);
  await expect(page.getByTestId('order-status')).toHaveText('New');
  await expect(page.getByTestId('customer-mobile')).toHaveText(stored.customerMobile);
  await expect(page.getByText('Nasr City, Cairo')).toBeVisible();
  await expect(page.getByText('EC-E2E')).toBeVisible();
  await expect(page.getByTestId('payment-amount')).toHaveText(egp(stored.codAmountPiasters));

  const fees = page.getByTestId('fee-breakdown');
  await expect(fees).toContainText(egp(stored.shippingPiasters));
  await expect(fees).toContainText(egp(stored.vatPiasters));
  await expect(page.getByTestId('fee-total')).toHaveText(egp(stored.totalFeePiasters));

  await page.getByRole('link', { name: 'Tracking & notes' }).click();
  await expect(page).toHaveURL(new RegExp(`/en/orders/${number}\\?tab=tracking$`));
  await expect(page.getByTestId('timeline')).toContainText('Order created');
});

test('adds a note that shows on the timeline', async ({ page }) => {
  await signIn(page);
  const number = await createDelivery(page, `Note test ${Date.now()}`);
  await page.goto(`/en/orders/${number}?tab=tracking`);

  await page.getByTestId('save-note').click();
  await expect(page.getByText('Write the note first.')).toBeVisible();

  const note = `Customer asked for an evening call ${Date.now()}`;
  await page.getByTestId('note-input').fill(note);
  await page.getByTestId('save-note').click();
  await expect(page.getByRole('status').filter({ hasText: 'Note saved' })).toBeVisible();
  await expect(page.getByTestId('timeline')).toContainText(note);
});

test('cancels a new order after confirming', async ({ page }) => {
  await signIn(page);
  const number = await createDelivery(page, `Cancel test ${Date.now()}`);
  await page.goto(`/en/orders/${number}`);

  await page.getByTestId('cancel-order').click();
  await expect(page.getByRole('dialog', { name: 'Cancel this order?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep order' }).click();
  await expect(page.getByTestId('order-status')).toHaveText('New');

  await page.getByTestId('cancel-order').click();
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByRole('status').filter({ hasText: `Order ${number} canceled` })).toBeVisible();
  await expect(page.getByTestId('order-status')).toHaveText('Canceled');
  await expect(page.getByTestId('cancel-order')).toHaveCount(0);

  await page.goto(`/en/orders/${number}?tab=tracking`);
  await expect(page.getByTestId('timeline')).toContainText('Canceled · Canceled by you');
});

test('"Create exchange" opens Create order with the type and original number filled', async ({ page }) => {
  await signIn(page);
  const number = await createDelivery(page, `Exchange test ${Date.now()}`);
  await page.goto(`/en/orders/${number}`);
  await expect(page.getByTestId('create-exchange')).toHaveCount(0);

  await setStatus(number, 'delivered', 1);
  await page.reload();
  await expect(page.getByTestId('order-status')).toHaveText('Delivered');
  await expect(page.getByTestId('cancel-order')).toHaveCount(0);
  await page.getByTestId('create-exchange').click();

  await expect(page).toHaveURL(new RegExp(`/en/orders/new\\?type=exchange&from=${number}$`));
  await expect(page.getByTestId('type-exchange')).toBeChecked();
  await expect(page.getByLabel('Original order number (optional)')).toHaveValue(number);
});

test('answers "Awaiting your action" with a required note', async ({ page }) => {
  await signIn(page);
  const number = await createDelivery(page, `Awaiting test ${Date.now()}`);
  await setStatus(number, 'awaiting_merchant_action', 1);
  await page.goto(`/en/orders/${number}`);

  const box = page.getByTestId('awaiting-box');
  await expect(box).toContainText('The courier is waiting for your decision');
  await box.getByRole('button', { name: 'Return to me' }).click();
  await page.getByTestId('send-answer').click();
  await expect(box.getByText('Write a short note so the courier knows what to do.')).toBeVisible();

  await box.getByLabel('Note for the courier').fill('Customer cancelled, bring it back');
  await page.getByTestId('send-answer').click();
  await expect(page.getByTestId('order-status')).toHaveText('Returning to you');
  await expect(page.getByTestId('awaiting-box')).toHaveCount(0);
});

test("another merchant's order number shows not found", async ({ page }) => {
  const area = await db.area.findFirstOrThrow({ where: { nameEn: 'Nasr City' } });
  await db.merchant.upsert({ where: { id: OTHER_MERCHANT_ID }, create: { id: OTHER_MERCHANT_ID, nameEn: 'E2E other merchant', nameAr: 'تاجر تجربة' }, update: {} });
  const customer = await db.customer.upsert({
    where: { merchantId_mobile: { merchantId: OTHER_MERCHANT_ID, mobile: '+201001234567' } },
    create: { merchantId: OTHER_MERCHANT_ID, mobile: '+201001234567', name: 'Other customer', lastAddressText: '1 Test St', lastAreaId: area.id },
    update: {},
  });
  const number = `9${String(Date.now()).slice(-9)}`;
  await db.order.create({
    data: {
      number, merchantId: OTHER_MERCHANT_ID, type: 'deliver', status: 'new', customerId: customer.id, customerName: customer.name,
      customerMobile: customer.mobile, addressText: '1 Test St', areaId: area.id, size: 'small',
      shippingPiasters: 6800, vatPiasters: 952, totalFeePiasters: 7752, createdBy: '00000000-0000-0000-0000-000000000000',
    },
  });

  await signIn(page);
  const response = await page.goto(`/en/orders/${number}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByText('Other customer')).toHaveCount(0);
});

test('order page has no sideways scrolling on a phone, in Arabic', async ({ page }) => {
  await signIn(page);
  const number = await createDelivery(page, `Phone test ${Date.now()}`);
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of [`/ar/orders/${number}`, `/ar/orders/${number}?tab=tracking`]) {
    await page.goto(path);
    await expect(page.getByTestId('order-status')).toHaveText('جديد');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
});
