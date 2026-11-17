import { test, expect } from '@playwright/test';

test('BN254 note separates estimated security from proof size and correctness', async ({ page }) => {
  await page.goto('./#bn254-security');
  const note = page.locator('#bn254-security');
  await expect(note).toBeVisible();
  for (const text of ['approximately 100 bits', 'earlier cryptanalysis', 'not a new break', 'estimated attack cost', '128 bytes compressed', '256 bytes uncompressed', 'not a final standard']) {
    await expect(note).toContainText(text);
  }
  await expect(note.locator('a')).toHaveAttribute('href', 'https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-pairing-friendly-curves-16#section-1.3');
});
