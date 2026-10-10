import { expect, test } from '@playwright/test';

for (const width of [1280, 380, 320]) {
  test(`proof mechanics disclose small-witness inference at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('.');
    await expect(page.locator('#rp-x')).toHaveAttribute('min', '0');
    await expect(page.locator('#rp-x')).toHaveAttribute('max', '20');
    await expect(page.locator('#realproof .hint')).toContainText('public output identifies x');
    await expect(page.locator('#play-verdict')).toContainText('public statement already identifies x');
    await page.locator('#rp-prove').click();
    const out = page.locator('#rp-out');
    await expect(out).toContainText('Proof generated in', { timeout: 90_000 });
    await expect(out).toContainText('out = 35');
    await expect(out).toContainText('public output identifies x');
    await expect(out).not.toContainText('x stays secret');
    await page.locator('#rp-verify').click();
    await expect(out).toContainText('groth16.verify → true', { timeout: 60_000 });
    await expect(out).toContainText('public output still identifies x');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
