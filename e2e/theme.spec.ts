import { expect, test } from '@playwright/test';

for (const [systemScheme, chosen] of [['dark', 'light'], ['light', 'dark']] as const) {
  test(`a ${chosen} theme chosen on a ${systemScheme} system survives switching language`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: systemScheme });
    await page.goto('/en/login');
    await page.getByRole('button', { name: chosen === 'light' ? 'Light mode' : 'Dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', chosen);
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await page.getByTestId('language-switch').click();
    await expect(page).toHaveURL(/\/ar\/login$/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', chosen);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(background);

    await page.getByTestId('language-switch').click();
    await expect(page).toHaveURL(/\/en\/login$/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', chosen);
  });
}
