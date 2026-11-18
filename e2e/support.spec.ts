import { expect, test, type Page } from '@playwright/test';

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? '';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? '';
const PHONE_VIEWPORT = { width: 375, height: 812 };

type Locale = 'en' | 'ar';

const TEXT = {
  en: { body: 'The courier marked a failed attempt but the customer says nobody called.', reply: 'Any news on this?', closed: 'This ticket is closed' },
  ar: { body: 'المندوب كتب إن العميل مردش، بس العميل بيقول محدش كلّمه.', reply: 'فيه أي جديد؟', closed: 'التذكرة دي مقفولة' },
} as const;

async function signIn(page: Page, locale: Locale) {
  await page.goto(`/${locale}/login`);
  await page.getByTestId('identifier').fill(OWNER_EMAIL);
  await page.getByTestId('password').fill(OWNER_PASSWORD);
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(new RegExp(`/${locale}$`));
}

// Creates a delivery through the real Create order screen and returns its number.
async function createDelivery(page: Page): Promise<string> {
  await page.goto('/en/orders/new');
  await page.getByLabel('Phone number').fill('01001234567');
  await page.getByLabel('Full name', { exact: true }).fill('Support E2E');
  await page.getByLabel('Street address', { exact: true }).fill('12 Abbas El Akkad St');
  await page.getByRole('combobox', { name: 'Area' }).fill('nasr');
  await page.getByRole('option', { name: /Nasr City/ }).first().click();
  await expect(page.getByTestId('total-fee')).not.toHaveText('—');
  await page.getByTestId('create-order').click();
  const heading = page.getByRole('heading', { name: /Order \d{10} created/ });
  await expect(heading).toBeVisible();
  const number = (await heading.textContent())?.match(/\d{10}/)?.[0];
  if (!number) throw new Error('No order number on the created screen');
  return number;
}

async function hasNoSidewaysScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

test.beforeEach(() => {
  expect(OWNER_EMAIL, 'SEED_OWNER_EMAIL must be set in .env').not.toBe('');
});

for (const locale of ['en', 'ar'] as const) {
  test(`opens a ticket about an order, replies, closes it (${locale})`, async ({ page }) => {
    await signIn(page, locale);
    const orderNumber = await createDelivery(page);
    const subject = `E2E ${locale} ticket ${Date.now()}`;

    await page.goto(`/${locale}/support`);
    await page.getByTestId('new-ticket-open').click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByTestId('ticket-topic').selectOption('order');
    await dialog.getByTestId('ticket-order').fill(orderNumber);
    await dialog.getByTestId('ticket-subject').fill(subject);
    await dialog.getByTestId('ticket-body').fill(TEXT[locale].body);
    await dialog.getByTestId('ticket-submit').click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);

    // Lands on the new ticket's conversation.
    await expect(page).toHaveURL(new RegExp(`/${locale}/support/T\\d{6}$`));
    const thread = page.getByTestId('ticket-thread');
    await expect(thread).toContainText(subject);
    await expect(thread).toContainText(orderNumber);
    await expect(thread.getByTestId('message-merchant')).toHaveText([new RegExp(TEXT[locale].body)]);

    // Listed under Open; opening it from the list shows the same thread.
    await page.goto(`/${locale}/support`);
    const listed = page.getByTestId('support-ticket').filter({ hasText: subject });
    await expect(listed).toBeVisible();
    await listed.click();
    await expect(page.getByTestId('ticket-thread')).toContainText(subject);

    await page.getByTestId('ticket-reply').fill(TEXT[locale].reply);
    await page.getByTestId('ticket-reply-send').click();
    await expect(page.getByTestId('message-merchant')).toHaveCount(2);
    await expect(page.getByTestId('message-merchant').last()).toContainText(TEXT[locale].reply);
    await expect(page.getByTestId('ticket-reply')).toHaveValue('');

    await page.getByTestId('ticket-close').click();
    await page.locator('dialog[open]').getByTestId('ticket-close-confirm').click();
    await expect(page.getByTestId('ticket-closed-note')).toContainText(TEXT[locale].closed);
    await expect(page.getByTestId('ticket-reply')).toHaveCount(0);

    await page.goto(`/${locale}/support`);
    await expect(page.getByTestId('support-ticket').filter({ hasText: subject })).toHaveCount(0);
    await page.getByTestId('support-tab-closed').click();
    await expect(page.getByTestId('support-ticket').filter({ hasText: subject })).toBeVisible();
  });

  test(`the corner chat button and the help card open a new ticket; no sideways scroll at 375 (${locale})`, async ({ page }) => {
    await signIn(page, locale);
    await page.goto(`/${locale}/orders`);
    // In Arabic the button sits bottom-left, under the Next.js dev-tools badge (dev server only),
    // so the click is sent to the button itself.
    await page.getByTestId('support-chat-button').dispatchEvent('click');
    await expect(page.getByTestId('new-ticket-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);

    await page.locator('.help-card a').click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/support$`));
    await expect(page.getByTestId('new-ticket-dialog')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto(`/${locale}/support`);
    await expect(page.getByTestId('support-chat-button')).toBeVisible();
    expect(await hasNoSidewaysScroll(page)).toBe(true);
    const first = page.getByTestId('support-ticket').first();
    if ((await first.count()) > 0) {
      await first.click();
      await expect(page.getByTestId('ticket-thread')).toBeVisible();
      expect(await hasNoSidewaysScroll(page)).toBe(true);
    }
  });
}

test('refuses an order number that is not one of the merchant’s orders', async ({ page }) => {
  await signIn(page, 'en');
  await page.goto('/en/support');
  await page.getByTestId('new-ticket-open').click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByTestId('ticket-order').fill('1000000000');
  await dialog.getByTestId('ticket-subject').fill('Wrong order number');
  await dialog.getByTestId('ticket-body').fill('Testing a wrong order number.');
  await dialog.getByTestId('ticket-submit').click();
  await expect(dialog.getByTestId('new-ticket-error')).toContainText("couldn't find this order number");
});
