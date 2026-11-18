import { expect, test, type Page } from '@playwright/test';

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? '';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? '';

async function signIn(page: Page) {
  await page.goto('/en/login');
  await page.getByTestId('identifier').fill(OWNER_EMAIL);
  await page.getByTestId('password').fill(OWNER_PASSWORD);
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(/\/en$/);
}

async function createOrder(page: Page, customerName: string): Promise<string> {
  await page.goto('/en/orders/new');
  await page.getByLabel('Phone number').fill('01001234567');
  await page.getByLabel('Full name', { exact: true }).fill(customerName);
  await page.getByLabel('Street address', { exact: true }).fill('12 Abbas El Akkad St, building 4');
  await page.getByRole('combobox', { name: 'Area' }).fill('nasr');
  await page.getByRole('option', { name: /Nasr City/ }).first().click();
  await expect(page.getByTestId('total-fee')).not.toHaveText('—');
  await page.getByTestId('create-order').click();
  const heading = page.getByRole('heading', { name: /Order \d{10} created/ });
  await expect(heading).toBeVisible();
  return (await heading.textContent())?.match(/\d{10}/)?.[0] ?? '';
}

function cairoTomorrow(): string {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(tomorrow);
}

test('selected new orders join the next scheduled pickup from the Orders list', async ({ page }) => {
  await signIn(page);

  // Make sure a pickup is scheduled at the default location tomorrow (an existing one is reused).
  await page.goto('/en/pickups');
  await page.getByTestId('request-pickup-open').click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByTestId('pickup-day').fill(cairoTomorrow());
  await dialog.getByTestId('pickup-count').fill('5');
  await dialog.getByTestId('pickup-submit').click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  const name = `Bulk Pickup ${Date.now()}`;
  const number = await createOrder(page, name);
  await page.goto(`/en/orders?q=${number}`);
  await page.getByRole('row', { name: new RegExp(number) }).getByRole('checkbox').check();
  await page.getByTestId('bulk-request-pickup').click();
  await expect(page.getByRole('status').filter({ hasText: /Added 1 order to pickup \d{8}/ })).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(number) })).toContainText('Pickup requested');
});
