import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditNonText, formatNonTextFailures, type NonTextFailure } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Three rules govern everything here:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The gate this file
 *     replaces called `revealAll`, which forced every `<details>` open and
 *     stripped `[hidden]` off everything. On this page `[hidden]` is what keeps
 *     the five quiz explanations closed and `#play-reset` out of the way until
 *     you are actually cheating, so every scan ran against a page showing five
 *     answered questions at once and a "Stop cheating" button beside an honest
 *     circuit — a state no visitor can produce. It also injected
 *     `animation-duration: 0s` / `transition-duration: 0s`, so the suite was
 *     structurally incapable of observing a transition or theme-swap defect.
 *
 *     It also scanned the accumulated end state ONCE per theme, at desktop
 *     width, and asserted on axe `violations` alone.
 *
 *  2. EVERY SCAN ASSERTS ITS CONTENT IS PRESENT FIRST, and there are scans well
 *     past first paint. axe over an empty container passes having checked
 *     nothing, and the playground, ceremony, KZG and real-proof panels all
 *     start empty.
 *
 *  3. `violations` IS NOT THE WHOLE ORACLE. See `scan`.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Transitions drain in waves, not in one batch, so a poll for "nothing running
 * right now" can exit through a gap between waves. Require quiescence to hold
 * for several consecutive frames instead.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __quietFrames?: number };
      const running = document.getAnimations().filter((a) => a.playState === 'running');
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      return w.__quietFrames >= 6;
    },
    undefined,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set. This lab's
 * reduced-motion block cancels only `transition` (which jumps straight to the
 * end value) and the `.rp-spinner` rotation, and no element rule here sets
 * `opacity: 0` waiting to be animated open — so the check is expected to be
 * silent, and is kept because a future keyframe could change that.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really on the page.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page. `nav.ts` reads the preference when the
 * back-to-top button is used, so it has to be in place before the walk starts.
 *
 * The theme is seeded in `localStorage` rather than reached by clicking the
 * toggle, so the page boots in the theme under test instead of transitioning
 * into it — and the light-theme walk is a fresh load rather than a walk of a
 * page that was mid-transition when the first scan ran.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // Fail fast on an unreachable control. Playwright's default action timeout is
  // the whole test timeout, so a click on something a sticky header covers, or
  // a locator gated on a prerequisite that never ran, silently burns the entire
  // budget instead of pointing at the state it could not reach.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

  // The playground, the ceremony toggles and the quiz are all built by JS at
  // load. Scanning before they exist is scanning an empty page.
  await expect(page.locator('#play-x')).toBeVisible();
  await expect(page.locator('#play-witness')).not.toBeEmpty();
  await expect(page.locator('#ceremony-toggles .ptoggle')).toHaveCount(5);
  await expect(page.locator('#forge-facts')).not.toBeEmpty();
  await expect(page.locator('.quiz-q')).toHaveCount(5);

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all, and this lab is a
 * plausible offender: it prints BN254 curve points as long monospace
 * big-integers, ships two head-to-head comparison tables, and lays several
 * panels out on `repeat(auto-fit, minmax(160px, 1fr))` / `minmax(280px, 1fr)`
 * tracks whose fixed floor a 380px viewport cannot go below.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide table inside an `overflow-x: auto` wrapper has a huge bounding rect
    // but is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const widest = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .filter((x) => !clipped(x.el))
      .sort((a, b) => b.r.right - a.r.right)[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return (
          ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY)
        );
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Five assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - `violations` — the usual WCAG A/AA rule failures.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically. Everything else in that bucket is a real result
 *    axe simply could not finish — including `aria-prohibited-attr`, which is
 *    where an `aria-label` on a role-less div hides, a defect that never
 *    reaches the violations array at all.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast,
 * and the arithmetic text walk cannot reach a control's boundary or a
 * `::before` glyph, because a pseudo-element is not an element and owns no text
 * node. Both were being found by hand-sampling screenshot pixels, which does
 * not regress-test.
 *
 * The backlog is real, so this does not block on it — but a check that merely
 * logs is not a gate, and this sweep has spent its whole length deleting checks
 * that could not fail. So it ratchets instead: anything NOT in the baseline
 * fails, anything in the baseline that got WORSE fails, and anything in the
 * baseline that has been FIXED fails until its entry is deleted. That last rule
 * is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it. Opt-in via env, and the run is
  // deliberately left failing at the end by `expectBaselineNotStale` so a
  // capture pass can never be mistaken for a passing gate.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(
        `WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`
      );
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the point
 * — or the drive stopped reaching the state that shows it, which is a coverage
 * regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)'
  ).toEqual([]);
}

export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  expect(violations, `axe violations in state: ${label}`).toEqual([]);

  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  expect(unexplainedIncomplete, `axe incomplete results in state: ${label}`).toEqual([]);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  expect(contrast, `measured contrast failures in state: ${label}`).toEqual([]);

  await expectNoNewNonTextFailures(page, label);
  await expectScrollersReachable(page, label);
  await expectNoHorizontalOverflow(page, label);
}

/**
 * Drive the whole single-page document, scanning each state.
 *
 * EVERY control on the page is reached, which the old gate did not manage:
 * `#play-x`, `#play-cheat`, `#play-reset`, `#rp-x`, `#rp-prove`, `#rp-verify`,
 * `#rp-tamper`, `#groth16-chain-run`, every `#ceremony-toggles` checkbox,
 * `#ceremony-run`, `#ceremony-randomize`, `#forge-honest`, `#forge-lie`, every
 * `.quiz-opt` across all five questions, the `.toc-link` chips and `#to-top`.
 *
 * The REAL-PROOF exhibit is the headline gap. Its three buttons drive genuine
 * snarkjs proving and verification and render three distinct result panels
 * (`cb-ok`, `cb-bad`, and a busy state), and the old gate never touched any of
 * them — its comment asserted the "Verify proof" buttons "were removed", which
 * is true of the two SIMULATED ones in Exhibits 02/03 and false of these.
 * `#rp-verify` and `#rp-tamper` are also disabled until a proof exists, so a
 * probe that skips `#rp-prove` waits forever rather than failing.
 *
 * Both branches of every two-verdict exhibit are visited: the playground
 * honest and forged, the ceremony with a deleter and with nobody deleting, the
 * KZG opening honest and forged, and the quiz answered wrong then right.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  await scan(page, `${theme} / first paint`);

  // The skip link parks off-screen until focused; the focused rendering is the
  // state a keyboard visitor actually sees.
  await page.locator('.cl-skip-link').focus();
  await scan(page, `${theme} / skip link focused`);

  // ── Exhibit 01 — R1CS playground ───────────────────────────────────────
  // Move the slider off its default so the wires and verdict recompute, and
  // land on a value that does NOT satisfy the statement — the failing-verdict
  // rendering is a different palette from the satisfying one.
  await page.locator('#play-x').fill('4');
  await expect(page.locator('#play-verdict')).not.toBeEmpty();
  await scan(page, `${theme} / playground unsatisfying witness`);

  await page.locator('#play-x').fill('3');
  await expect(page.locator('#play-verdict')).not.toBeEmpty();
  await scan(page, `${theme} / playground satisfying witness`);

  // Cheating forges the v2 wire: the constraint list gains its error styling
  // and `#play-reset` — which ships `hidden` — appears.
  await page.locator('#play-cheat').click();
  await expect(page.locator('#play-reset')).toBeVisible();
  await expect(page.locator('#play-cheat-note')).not.toBeEmpty();
  await scan(page, `${theme} / playground forged wire`);

  await page.locator('#play-reset').click();
  await expect(page.locator('#play-reset')).toBeHidden();
  await scan(page, `${theme} / playground cheat reverted`);

  // ── Real proof (snarkjs / BN254) ───────────────────────────────────────
  // Never driven by the old gate. Proving loads ~0.7 MB of snarkjs and runs
  // single-threaded, hence the generous ceiling; the verify/tamper buttons are
  // disabled until it succeeds, so the order here is a prerequisite, not a
  // preference.
  await page.locator('#rp-x').fill('7');
  await expect(page.locator('#rp-x-val')).toHaveText('7');
  await page.locator('#rp-prove').click();
  await expect(page.locator('#rp-verify')).toBeEnabled({ timeout: 300_000 });
  await expect(page.locator('#rp-out')).toHaveClass(/cb-ok/);
  await scan(page, `${theme} / real proof generated`);

  await page.locator('#rp-verify').click();
  await expect(page.locator('#rp-out .calc-verdict')).toBeVisible({ timeout: 300_000 });
  await expect(page.locator('#rp-out')).toHaveClass(/cb-ok/);
  await scan(page, `${theme} / real proof verified`);

  await page.locator('#rp-tamper').click();
  await expect(page.locator('#rp-out')).toHaveClass(/cb-bad/, { timeout: 300_000 });
  await expect(page.locator('#rp-out .pv-bad')).toBeVisible();
  await scan(page, `${theme} / real proof tampered and rejected`);

  // ── Exhibit 02 — ceremony chain animation ──────────────────────────────
  await page.locator('#groth16-chain-run').click();
  await expect(page.locator('#groth16-chain .chain-node').first()).toBeVisible();
  await expect(page.locator('#groth16-chain-status')).not.toBeEmpty();
  await scan(page, `${theme} / groth16 chain run`);

  // ── Exhibit 05 — real ceremony arithmetic ──────────────────────────────
  // Default state has P3 deleting, so tau stays unknown: the SAFE verdict.
  await page.locator('#ceremony-run').click();
  await expect(page.locator('#ceremony-calc')).not.toBeEmpty();
  await expect(page.locator('#ceremony-verdict')).not.toBeEmpty();
  await scan(page, `${theme} / ceremony with an honest deleter`);

  // Untick every participant: nobody deletes, tau is recoverable — the OTHER
  // verdict, and the whole point of the exhibit.
  const boxes = page.locator('#ceremony-toggles input[type="checkbox"]');
  await expect(boxes).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    if (await boxes.nth(i).isChecked()) await boxes.nth(i).uncheck();
  }
  await page.locator('#ceremony-run').click();
  await expect(page.locator('#ceremony-verdict')).not.toBeEmpty();
  await scan(page, `${theme} / ceremony with nobody deleting`);

  // Tick every participant, and re-roll the contributions.
  for (let i = 0; i < 5; i++) {
    if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).check();
  }
  await page.locator('#ceremony-randomize').click();
  await page.locator('#ceremony-run').click();
  await expect(page.locator('#ceremony-calc')).not.toBeEmpty();
  await scan(page, `${theme} / ceremony re-randomised, all deleting`);

  // ── Exhibit 05 — KZG forgery ───────────────────────────────────────────
  await page.locator('#forge-honest').click();
  await expect(page.locator('#forge-calc')).not.toBeEmpty();
  await scan(page, `${theme} / KZG honest opening`);

  await page.locator('#forge-lie').click();
  await expect(page.locator('#forge-calc')).not.toBeEmpty();
  await scan(page, `${theme} / KZG forged opening`);

  // ── Self-check quiz ────────────────────────────────────────────────────
  // Answer Q1 wrong and the rest right, so BOTH explanation styles render, and
  // scan the completed board — the old gate answered two questions and then
  // un-hid the other three explanations, which is not a state anyone can be in.
  await page.locator('.quiz-opt[data-q="0"][data-o="0"]').click();
  await expect(page.locator('#quiz-ex-0')).toBeVisible();
  await expect(page.locator('#quiz-ex-0')).toHaveClass(/qx-bad/);
  await scan(page, `${theme} / quiz answered wrong`);

  const answers = [1, 1, 2, 1, 1];
  for (let q = 1; q < answers.length; q++) {
    await page.locator(`.quiz-opt[data-q="${q}"][data-o="${answers[q]}"]`).click();
    await expect(page.locator(`#quiz-ex-${q}`)).toHaveClass(/qx-ok/);
  }
  await expect(page.locator('#quiz-score')).toContainText('Done');
  await scan(page, `${theme} / quiz complete`);

  // ── Navigation chrome ──────────────────────────────────────────────────
  // Scrolling deep into the page reveals `#to-top` (it ships `hidden`) and
  // moves the scroll-spy's `.toc-active`/`aria-current` chip, neither of which
  // exists at first paint.
  await page.locator('#glossary').scrollIntoViewIfNeeded();
  await expect(page.locator('#to-top')).toBeVisible();
  await expect(page.locator('.toc-link.toc-active')).toHaveCount(1);
  await scan(page, `${theme} / scrolled to glossary`);

  await page.locator('#to-top').click();
  await expect(page.locator('#to-top')).toBeHidden();
  await scan(page, `${theme} / back at the top`);
}
