import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
for (const width of [1280, 380]) test(`ceremony evidence stays distinct at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await page.goto('.');
  const panel = page.locator('#ceremony-audit'), result = panel.locator('#audit-result');
  for (const [value, chain, inclusion] of [['honest', 'pass', 'pass'], ['replacement', 'fail', 'fail'], ['missing', 'unavailable', 'unavailable'], ['corrupt', 'fail', 'fail'], ['omitted', 'pass', 'fail']]) {
    await panel.getByLabel('Transcript case').selectOption(value);
    await expect(result).toContainText('Final SRS consistency: pass');
    await expect(result).toContainText(`Update chain through final SRS: ${chain}`);
    await expect(result).toContainText(`Your exact contribution included: ${inclusion}`);
  }
  expect((await new AxeBuilder({ page }).include('#ceremony-audit').analyze()).violations).toEqual([]);
  expect(await panel.evaluate(el => el.scrollWidth > el.clientWidth + 1)).toBe(false);
});
