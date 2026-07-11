import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Strict WCAG regression gate for SNARK Arena.
 *
 * The app is a single-page scroll of exhibits rendered by src/main.ts. Many
 * result regions (the R1CS playground verdict, ceremony calc, KZG forgery calc,
 * simulated verifications, the legacy ceremony animation, quiz explanations) are
 * injected only after a control is driven. So we DRIVE every live demo, then
 * scan the whole page in both themes with WCAG 2.0/2.1 A + AA rules and assert
 * zero violations.
 *
 * There are no <details> here (collapsibles are class-toggled), but we still
 * generically expand any <details>/[hidden] for robustness.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Neutralize animation/transition/opacity so mid-flight states (chain-node
// "contributing", spinner, button :disabled fades) can't hide text from the
// contrast checker.
async function killMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*,*::before,*::after{
      animation-duration:0s!important;animation-delay:0s!important;
      transition-duration:0s!important;transition-delay:0s!important;
      opacity:1!important;scroll-behavior:auto!important;
    }`,
  });
}

async function revealAll(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('details')) (d as HTMLDetailsElement).open = true;
    for (const el of document.querySelectorAll<HTMLElement>('[hidden]')) el.removeAttribute('hidden');
  });
}

// Drive every live demo so its injected output region exists during the scan.
async function driveDemos(page: Page): Promise<void> {
  // Exhibit 01 — R1CS playground: nudge the slider so wires + verdict render,
  // then trigger the cheat path so the forged-wire (error-styled) markup exists.
  const slider = page.locator('#play-x');
  await slider.focus();
  await slider.press('ArrowRight');
  await slider.press('ArrowLeft');
  await expect(page.locator('#play-verdict')).not.toBeEmpty();
  await page.locator('#play-cheat').click();
  await expect(page.locator('#play-constraints')).not.toBeEmpty();

  // Exhibit 02 — simulated Groth16 verify + legacy ceremony animation.
  await page.locator('#groth16-verify').click();
  await expect(page.locator('#groth16-result')).toContainText('Verified');
  await page.locator('#groth16-chain-run').click();
  await expect(page.locator('#groth16-chain .chain-node').first()).toBeVisible();

  // Exhibit 03 — simulated PLONK verify.
  await page.locator('#plonk-verify').click();
  await expect(page.locator('#plonk-result')).toContainText('Verified');

  // Exhibit 05 — real ceremony arithmetic + KZG forgery (both honest and lie).
  await page.locator('#ceremony-run').click();
  await expect(page.locator('#ceremony-calc')).not.toBeEmpty();
  await page.locator('#forge-honest').click();
  await expect(page.locator('#forge-calc')).not.toBeEmpty();
  await page.locator('#forge-lie').click();
  await expect(page.locator('#forge-calc')).not.toBeEmpty();

  // Self-check quiz — answer Q1 (wrong option first exercises the error style,
  // Q2 correct exercises the ok style) so both explanation variants render.
  await page.locator('.quiz-opt[data-q="0"][data-o="0"]').click();
  await page.locator('.quiz-opt[data-q="1"][data-o="1"]').click();
  await expect(page.locator('#quiz-ex-0')).toBeVisible();
  await expect(page.locator('#quiz-ex-1')).toBeVisible();
}

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
  }));
  expect(summary).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.goto('.');
  await expect(page.locator('#cl-theme-toggle')).toBeVisible();
  await expect(page.locator('#play-x')).toBeVisible();
  await killMotion(page);
});

test('no WCAG A/AA violations in dark theme (all demos driven)', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await driveDemos(page);
  await killMotion(page);
  await revealAll(page);
  await scan(page);
});

test('no WCAG A/AA violations in light theme (all demos driven)', async ({ page }) => {
  await page.locator('#cl-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await driveDemos(page);
  await killMotion(page);
  await revealAll(page);
  await scan(page);
});
