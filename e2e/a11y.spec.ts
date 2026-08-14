import { test } from '@playwright/test';
import { boot, driveAllStates, expectBaselineNotStale, NARROW } from './gate';

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

    // The third ratchet rule — a baselined finding that no longer appears must
    // be deleted, so the list can only shrink. `expectBaselineNotStale` was
    // exported from `gate.ts` and imported by nothing, so it had never run.
    //
    // Dark at desktop only, and it is the sole configuration that qualifies —
    // measured, not assumed. `nonTextSeen` is a single flat set with no theme
    // or width dimension, so the rule only holds where the drive reaches EVERY
    // baselined selector, and the other three each miss some:
    //   - the five `.bp` primaries (`#ceremony-run`, `#forge-honest`,
    //     `#forge-lie`, `#rp-prove`, `#rp-verify`, all recorded at 2.75:1) are
    //     accent-bordered and clear 3:1 against the light surfaces, so they are
    //     never findings in a light run;
    //   - `button#play-reset.bs` is measured at desktop in both themes but not
    //     at 380px in either, so phone-width runs miss it whatever the theme.
    // Dark ∧ desktop is the intersection of those two constraints.
    if (theme === 'dark') expectBaselineNotStale();
  });

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(900_000);
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @380px`);
  });
}
