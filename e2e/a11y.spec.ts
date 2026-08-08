import { test } from '@playwright/test';
import { boot, driveAllStates, NARROW } from './gate';

/**
 * WCAG A/AA regression gate for SNARK Arena.
 *
 * Seventeen states per theme at desktop and phone width: the R1CS playground
 * satisfying, unsatisfying and forged; the REAL snarkjs Groth16 proof
 * generated, verified and tampered (an exhibit the previous gate never drove at
 * all); the ceremony chain; the live ceremony with an honest deleter, with
 * nobody deleting and re-randomised; the KZG opening honest and forged; the
 * quiz answered wrong and then completed; and the scrolled state where
 * `#to-top` and the scroll-spy chip exist.
 *
 * See `gate.ts` for why nothing is injected into the page, why each scan
 * asserts its content first, and why `violations` is not the whole oracle.
 */

for (const theme of ['dark', 'light'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    test.setTimeout(900_000);
    await boot(page, theme);
    await driveAllStates(page, theme);
  });

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(900_000);
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @380px`);
  });
}
