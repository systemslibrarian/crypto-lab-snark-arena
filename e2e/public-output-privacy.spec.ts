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

    await page.locator('#rp-x').fill('4');
    await expect(page.locator('#rp-x-val')).toHaveText('4');
    await expect(out).toContainText('Input changed. Generate a new proof');
    await expect(out).not.toContainText('groth16.verify → true');
    await expect(page.locator('#rp-verify')).toBeDisabled();
    await expect(page.locator('#rp-tamper')).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('changing the witness while proving cannot publish the stale result', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'snarkjs', {
      configurable: true,
      value: {
        groth16: {
          fullProve: async ({ x }: { x: number }) => {
            await new Promise((resolve) => setTimeout(resolve, 300));
            return {
              proof: {
                pi_a: ['1', '2', '1'],
                pi_b: [['1', '2'], ['3', '4'], ['1', '0']],
                pi_c: ['5', '6', '1'],
              },
              publicSignals: [String(x ** 3 + x + 5)],
            };
          },
          verify: async () => true,
        },
      },
    });
  });
  await page.goto('.');

  const out = page.locator('#rp-out');
  await page.locator('#rp-prove').click();
  await expect(out).toContainText('generating a real Groth16 proof');
  await page.locator('#rp-x').fill('5');
  await expect(out).toContainText('Input changed. Generate a new proof');
  await page.waitForTimeout(500);

  await expect(out).toContainText('Input changed. Generate a new proof');
  await expect(out).not.toContainText('Proof generated');
  await expect(page.locator('#rp-verify')).toBeDisabled();
  await expect(page.locator('#rp-tamper')).toBeDisabled();
});
