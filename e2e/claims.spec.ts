import { expect, test, type Page } from '@playwright/test';

/**
 * Functional claims gate for SNARK Arena.
 *
 * The a11y suite proves the page is reachable; this suite proves it is TRUE.
 * Every headline verdict, counter and failure path the exhibits advertise is
 * driven in a real browser and checked against a value re-derived here from the
 * field arithmetic, rather than against a copied string. Where the page prints
 * numbers it computed (witness wires, ceremony products, KZG exponents, the
 * measured Groth16 proof size), those numbers are read back out of the DOM and
 * recomputed independently, so a wrong verdict cannot pass by happening to
 * match a hardcoded expectation.
 */

// ── independent re-implementations (deliberately NOT imported from src/) ─────

const R1CS_P = 8191; // field of the circuit playground
const PUBLIC_OUT = 35;
const SCALAR_R = 17; // scalar field of the ceremony / KZG exhibits
const ENC_P = 103;
const GEN_G = 64;

function m(a: number, p: number): number {
  return ((a % p) + p) % p;
}

function powMod(base: number, exp: number, p: number): number {
  let r = 1;
  let b = m(base, p);
  let e = exp;
  while (e > 0) {
    if (e & 1) r = m(r * b, p);
    b = m(b * b, p);
    e >>= 1;
  }
  return r;
}

/** g^a in the order-17 subgroup of F_103*, the demo's "in the exponent" encoding. */
function enc(a: number): number {
  return powMod(GEN_G, m(a, SCALAR_R), ENC_P);
}

/** Honest witness wires for the circuit x^3 + x + 5 = 35 over F_8191. */
function witnessFor(x: number): { v1: number; v2: number; computedOut: number } {
  const v1 = m(x * x, R1CS_P);
  const v2 = m(v1 * x, R1CS_P);
  return { v1, v2, computedOut: m(v2 + x + 5, R1CS_P) };
}

/** Every x in F_8191 satisfying the circuit, by exhaustive search. */
function circuitRoots(): number[] {
  const roots: number[] = [];
  for (let x = 0; x < R1CS_P; x += 1) {
    if (m(m(m(x * x, R1CS_P) * x, R1CS_P) + x + 5, R1CS_P) === PUBLIC_OUT) roots.push(x);
  }
  return roots;
}

/** poly / (X - z) over F_17, low-degree-first coefficients. */
function divLinear(poly: number[], z: number): { quotient: number[]; remainder: number } {
  const n = poly.length;
  const quotient = new Array<number>(n - 1).fill(0);
  let carry = poly[n - 1];
  for (let i = n - 2; i >= 0; i -= 1) {
    quotient[i] = carry;
    carry = m(poly[i] + m(carry * z, SCALAR_R), SCALAR_R);
  }
  return { quotient, remainder: carry };
}

function polyEvalF17(poly: number[], x: number): number {
  let acc = 0;
  for (let i = poly.length - 1; i >= 0; i -= 1) acc = m(acc * x + poly[i], SCALAR_R);
  return acc;
}

function invF17(a: number): number {
  return powMod(a, SCALAR_R - 2, SCALAR_R);
}

// ── DOM number helpers ──────────────────────────────────────────────────────

/** All integers appearing in a DOM string, in order. */
function nums(text: string): number[] {
  return (text.match(/\d+/g) ?? []).map(Number);
}

/** The first integer appearing after `label` in a DOM string. */
function numAfter(text: string, label: string | RegExp): number {
  const src = typeof label === 'string' ? label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : label.source;
  const hit = new RegExp(`${src}[^0-9]*(\\d+)`).exec(text);
  expect(hit, `expected a number after ${String(label)} in: ${text}`).not.toBeNull();
  return Number(hit![1]);
}

async function setSlider(page: Page, selector: string, value: number): Promise<void> {
  await page.locator(selector).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

/** name -> value for the rendered witness vector cells. */
async function readWitness(page: Page): Promise<Record<string, number>> {
  return page.locator('#play-witness .wv-cell').evaluateAll((cells) => {
    const out: Record<string, number> = {};
    for (const c of cells) {
      out[c.querySelector('.wv-name')?.textContent ?? ''] = Number(c.querySelector('.wv-val')?.textContent ?? '');
    }
    return out;
  });
}

interface ConstraintRow { label: string; ok: boolean; evalText: string; }

async function readConstraints(page: Page): Promise<ConstraintRow[]> {
  return page.locator('#play-constraints .cn-row').evaluateAll((rows) =>
    rows.map((r) => ({
      label: r.querySelector('.cn-label')?.textContent?.trim() ?? '',
      ok: r.classList.contains('cn-ok'),
      evalText: r.querySelector('.cn-eval')?.textContent?.trim() ?? '',
    })),
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('.');
  await expect(page.locator('#play-x')).toBeVisible();
});

// ════════════ EXHIBIT 01 — R1CS circuit playground ════════════

test('playground: the default witness vector is the one the circuit actually computes', async ({ page }) => {
  const w = witnessFor(3);
  await expect(page.locator('#play-x')).toHaveValue('3');
  await expect(page.locator('#play-x-val')).toHaveText('3');

  expect(await readWitness(page)).toEqual({ '1': 1, x: 3, out: PUBLIC_OUT, v1: w.v1, v2: w.v2 });

  const verdict = page.locator('#play-verdict');
  await expect(verdict).toHaveClass(/pv-ok/);
  const text = await verdict.innerText();
  expect(text).toContain('Valid witness');
  expect(numAfter(text, 'public statement')).toBe(PUBLIC_OUT);
  expect(numAfter(text, 'x =')).toBe(3);
});

test('playground: every constraint row prints arithmetic that is true in F_8191', async ({ page }) => {
  const rows = await readConstraints(page);
  expect(rows.map((r) => r.label)).toEqual(['C1', 'C2', 'C3']);
  for (const row of rows) {
    expect(row.ok, `${row.label} should hold for x = 3`).toBe(true);
    // "a · b = c" — re-multiply it here rather than trusting the tick.
    const [a, b, c] = nums(row.evalText);
    expect(m(a * b, R1CS_P), `${row.label}: ${row.evalText}`).toBe(c);
  }
});

test('playground: only the satisfying x is accepted, and rejects quote the value the circuit computed', async ({ page }) => {
  const roots = circuitRoots();
  const verdict = page.locator('#play-verdict');

  for (let x = 0; x <= 9; x += 1) {
    await setSlider(page, '#play-x', x);
    await expect(page.locator('#play-x-val')).toHaveText(String(x));
    const text = await verdict.innerText();

    if (roots.includes(x)) {
      await expect(verdict).toHaveClass(/pv-ok/);
      expect(text).toContain('Valid witness');
      continue;
    }

    await expect(verdict).toHaveClass(/pv-bad/);
    expect(text).toContain('Not a satisfying witness');
    // The page states what x^3 + x + 5 came to for this x; recompute it.
    expect(numAfter(text, /x³ \+ x \+ 5 =/)).toBe(witnessFor(x).computedOut);
    // …and blames the constraint that pins the public wire.
    expect(text).toContain('C3');
    expect(numAfter(text, 'public output')).toBe(PUBLIC_OUT);
    const rows = await readConstraints(page);
    expect(rows.filter((r) => !r.ok).map((r) => r.label)).toEqual(['C3']);
  }
});

test('playground: the roots sentence reports the field, not the integers', async ({ page }) => {
  const roots = circuitRoots();
  expect(roots.length, 'the sentence only means something if there is more than one root').toBeGreaterThan(1);

  const sentence = await page.locator('#play-roots').innerText();
  expect(nums(sentence)[0]).toBe(roots.length);
  for (const r of roots) expect(sentence, `root ${r} must be listed`).toContain(String(r));
  expect(sentence).toContain(String(R1CS_P));
  expect(roots.filter((r) => r <= 9)).toEqual([3]); // only one is reachable on the slider
});

test('playground: forging the v2 wire is caught by a multiplication gate', async ({ page }) => {
  await page.locator('#play-cheat').click();

  const cells = await readWitness(page);
  expect(cells.v2, 'the wire really was forged').not.toBe(witnessFor(3).v2);
  await expect(page.locator('#play-witness .wv-forged .wv-name')).toHaveText('v2');

  const verdict = page.locator('#play-verdict');
  await expect(verdict).toHaveClass(/pv-bad/);
  const text = await verdict.innerText();
  expect(text).toContain('Caught cheating');
  expect(numAfter(text, 'v2 =')).toBe(cells.v2);
  expect(text, 'the multiplication constraint is named').toContain('C2');
  expect(text).toContain('multiplication gate');

  const byLabel = Object.fromEntries((await readConstraints(page)).map((r) => [r.label, r]));
  expect(byLabel.C1.ok, 'x·x = v1 is untouched by the forgery').toBe(true);
  expect(byLabel.C2.ok, 'v1·x = v2 must break').toBe(false);
  // C2 prints  v1 · x = <true product> ≠ <forged v2>
  const [a, b, product, claimed] = nums(byLabel.C2.evalText);
  expect(m(a * b, R1CS_P)).toBe(product);
  expect(product).not.toBe(claimed);
  expect(claimed).toBe(cells.v2);

  await expect(page.locator('#play-cheat-note')).toContainText('forged');
});

test('playground: leaving cheat mode restores the valid witness', async ({ page }) => {
  await page.locator('#play-cheat').click();
  await expect(page.locator('#play-verdict')).toHaveClass(/pv-bad/);
  await page.locator('#play-reset').click();
  await expect(page.locator('#play-verdict')).toHaveClass(/pv-ok/);
  expect((await readWitness(page)).v2).toBe(witnessFor(3).v2);
  await expect(page.locator('#play-witness .wv-forged')).toHaveCount(0);
});

// ════════════ FEATURED — real Groth16 proof via snarkjs ════════════

/**
 * Blank the output region before driving a control, so that what we then wait
 * for must have been written by THIS action — a previous run's text can never
 * satisfy the assertion. (Strictly stronger than waiting on the transient busy
 * message, which a fast local run can replace before the poller sees it.)
 */
async function resetOut(page: Page): Promise<void> {
  await page.locator('#rp-out').evaluate((el) => { el.innerHTML = ''; });
  await expect(page.locator('#rp-out')).toBeEmpty();
}

async function prove(page: Page, x: number): Promise<string> {
  const out = page.locator('#rp-out');
  await setSlider(page, '#rp-x', x);
  await expect(page.locator('#rp-x-val')).toHaveText(String(x));
  await resetOut(page);
  await page.locator('#rp-prove').click();
  await expect(out).toContainText('Proof generated in', { timeout: 120_000 });
  return out.innerText();
}

test('real proof: the public output the proof commits to is x^3 + x + 5', async ({ page }) => {
  for (const x of [3, 7, 20]) {
    const text = await prove(page, x);
    const expected = BigInt(x) ** 3n + BigInt(x) + 5n;
    expect(numAfter(text, 'out ='), `public signal for x = ${x}`).toBe(Number(expected));
    await expect(page.locator('#rp-out')).toHaveClass(/cb-ok/);
    expect(text, 'the witness must not be printed').toContain('x stays secret');
  }
});

test('real proof: the reported size is counted from the proof object and matches the figure Exhibit 02 quotes', async ({ page }) => {
  const text = await prove(page, 3);
  const bytes = numAfter(text, 'Proof size:');
  const coords = numAfter(text, 'counted from the proof object above (');
  const perCoord = numAfter(text, 'BN254 base-field coordinates × ');
  expect(coords * perCoord, 'size must be the coordinate count times the coordinate width').toBe(bytes);
  expect(perCoord, 'one BN254 base-field element').toBe(32);
  expect(bytes, 'Groth16 A + B + C, uncompressed').toBe(256);

  // Exhibit 02 quotes the same uncompressed figure in prose; they must agree.
  expect(await page.locator('#exhibit-2').innerText()).toContain(`${bytes} bytes uncompressed`);
});

test('real proof: groth16.verify returns true for the honest proof', async ({ page }) => {
  const trueOut = numAfter(await prove(page, 3), 'out =');
  const out = page.locator('#rp-out');

  await resetOut(page);
  await page.locator('#rp-verify').click();
  await expect(out).toContainText('groth16.verify', { timeout: 60_000 });

  const text = await out.innerText();
  expect(text).toContain('groth16.verify → true');
  await expect(out).toHaveClass(/cb-ok/);
  await expect(page.locator('#rp-out .calc-verdict')).toHaveClass(/pv-ok/);
  expect(numAfter(text, 'public output (')).toBe(trueOut);
  expect(text).toContain('never saw x');
});

test('real proof: a tampered public output is rejected, and the panel states why', async ({ page }) => {
  const trueOut = numAfter(await prove(page, 3), 'out =');
  const out = page.locator('#rp-out');

  await resetOut(page);
  await page.locator('#rp-tamper').click();
  await expect(out).toContainText('groth16.verify', { timeout: 60_000 });

  const text = await out.innerText();
  expect(text, 'a tampered statement must be REJECTED').toContain('groth16.verify → false');
  expect(text).not.toContain('→ true');
  await expect(out).toHaveClass(/cb-bad/);
  await expect(page.locator('#rp-out .calc-verdict')).toHaveClass(/pv-bad/);

  // The reason, with the substituted statement spelled out: faked = real + 1.
  const [faked, real] = nums(text.split('lied about the public output')[1]);
  expect(real).toBe(trueOut);
  expect(faked).toBe(trueOut + 1);
  expect(text).toContain('pairing check fails');
  expect(text).toContain('bound to the true statement');
});

// ════════════ EXHIBIT 02 — ceremony visualizer ════════════

async function runLegacyChain(page: Page): Promise<string> {
  const status = page.locator('#groth16-chain-status');
  await page.locator('#groth16-chain-run').click();
  await expect(status).toHaveText(/^(Secure|Compromised):/, { timeout: 20_000 });
  return status.innerText();
}

test('ceremony visualizer: the headline verdict agrees with the participant states it drew', async ({ page }) => {
  await expect(page.locator('#groth16-chain-status')).toContainText('at least one participant');

  for (let run = 0; run < 4; run += 1) {
    const text = await runLegacyChain(page);
    const kept = await page.locator('#groth16-chain .chain-node.bad').count();
    const deleted = await page.locator('#groth16-chain .chain-node.safe').count();
    expect(kept + deleted, 'every node must settle to one state or the other').toBe(5);

    if (text.startsWith('Secure')) {
      expect(deleted, 'a secure ceremony needs at least one deleter').toBeGreaterThan(0);
      const [claimed, total] = nums(text);
      expect(claimed, 'the counter must be the number of nodes that deleted').toBe(deleted);
      expect(total).toBe(5);
      expect(text).toContain('unrecoverable');
    } else {
      expect(deleted, 'a compromised ceremony means nobody deleted').toBe(0);
      expect(text).toContain('Soundness is broken');
      expect(numAfter(text, 'reconstruct τ =')).toBeLessThan(SCALAR_R);
    }
  }
});

test('ceremony visualizer: both outcomes are reachable, with the draw pinned', async ({ page }) => {
  // 0.9 -> every honesty coin fails (< 0.75 is false): nobody deletes.
  await page.addInitScript(() => { Math.random = () => 0.9; });
  await page.reload();
  const bad = await runLegacyChain(page);
  expect(bad).toContain('Compromised');
  await expect(page.locator('#groth16-chain .chain-node.safe')).toHaveCount(0);
  // Contribution drawn is 1 + floor(0.9 * 16) = 15 for all five, so τ = 15^5 mod 17.
  expect(numAfter(bad, 'reconstruct τ =')).toBe(powMod(15, 5, SCALAR_R));

  // 0.1 -> every coin passes: all five delete.
  await page.addInitScript(() => { Math.random = () => 0.1; });
  await page.reload();
  const good = await runLegacyChain(page);
  expect(good).toContain('Secure');
  await expect(page.locator('#groth16-chain .chain-node.safe')).toHaveCount(5);
  expect(nums(good).slice(0, 2)).toEqual([5, 5]);
});

// ════════════ EXHIBIT 05 — powers-of-tau ceremony (real arithmetic) ════════════

async function readContributions(page: Page): Promise<number[]> {
  return page.locator('#ceremony-toggles .ptoggle-c').evaluateAll((els) =>
    els.map((e) => Number((e.textContent ?? '').replace(/[^0-9]/g, ''))),
  );
}

async function runCeremonyPanel(page: Page): Promise<{ calc: string; verdict: string }> {
  await page.locator('#ceremony-run').click();
  await expect(page.locator('#ceremony-calc')).toContainText('Combined secret', { timeout: 20_000 });
  await expect(page.locator('#ceremony-verdict')).not.toBeEmpty();
  return {
    calc: await page.locator('#ceremony-calc').innerText(),
    verdict: await page.locator('#ceremony-verdict').innerText(),
  };
}

/** τ is the running product of the contributions; g^τ is its encoding. */
async function assertCeremonyArithmetic(page: Page, calc: string): Promise<number> {
  const contributions = await readContributions(page);
  expect(contributions).toHaveLength(5);
  for (const c of contributions) {
    expect(c).toBeGreaterThan(0);
    expect(c, 'contributions live in F_17').toBeLessThan(SCALAR_R);
  }

  const line = calc.split('\n')[0];
  const parsed = /τ = (.+?) mod (\d+) = (\d+)/.exec(line);
  expect(parsed, `could not parse the combined-secret line: ${line}`).not.toBeNull();
  expect(nums(parsed![1]), 'the printed product must be the printed contributions').toEqual(contributions);
  expect(Number(parsed![2])).toBe(SCALAR_R);

  const expectedTau = contributions.reduce((acc, c) => m(acc * c, SCALAR_R), 1);
  expect(Number(parsed![3]), line).toBe(expectedTau);

  // g^τ, printed on the next line, recomputed here.
  expect(numAfter(calc, 'Public SRS element')).toBe(enc(expectedTau));
  expect(numAfter(calc.split('Public SRS element')[1], 'mod ')).toBe(ENC_P);

  // Each participant node shows the running product up to that step.
  const running = await page.locator('#ceremony-chain .chain-node .cn-run').evaluateAll((els) =>
    els.map((e) => Number((e.textContent ?? '').replace(/[^0-9]/g, ''))),
  );
  let acc = 1;
  expect(running).toEqual(contributions.map((c) => (acc = m(acc * c, SCALAR_R))));
  return expectedTau;
}

test('powers-of-tau: the combined secret is the product of the contributions, and g^tau matches', async ({ page }) => {
  const { calc, verdict } = await runCeremonyPanel(page);
  const tau = await assertCeremonyArithmetic(page, calc);

  // One participant deletes by default, so the ceremony is secure and says who.
  await expect(page.locator('#ceremony-verdict')).toHaveClass(/pv-ok/);
  expect(verdict).toContain('Secure');
  const deleters = await page.locator('#ceremony-chain .chain-node.safe .cn-p').allInnerTexts();
  expect(deleters.length).toBeGreaterThan(0);
  for (const p of deleters) expect(verdict, `${p} deleted, so the verdict must credit them`).toContain(p);
  expect(numAfter(verdict, 'τ =')).toBe(tau);
  expect(verdict).toContain('discrete-log wall');
});

test('powers-of-tau: with nobody deleting, the ceremony is compromised and prints the recoverable tau', async ({ page }) => {
  const boxes = page.locator('#ceremony-toggles input[type="checkbox"]');
  const n = await boxes.count();
  for (let i = 0; i < n; i += 1) await boxes.nth(i).uncheck();

  const { calc, verdict } = await runCeremonyPanel(page);
  const tau = await assertCeremonyArithmetic(page, calc);

  await expect(page.locator('#ceremony-verdict')).toHaveClass(/pv-bad/);
  expect(verdict).toContain('Compromised');
  expect(verdict).toContain('soundness is broken');
  expect(numAfter(verdict, 'reconstruct τ =')).toBe(tau);
  await expect(page.locator('#ceremony-chain .chain-node.safe')).toHaveCount(0);
  await expect(page.locator('#ceremony-chain .chain-node.bad')).toHaveCount(5);
});

test('powers-of-tau: one honest deleter out of five is enough', async ({ page }) => {
  const boxes = page.locator('#ceremony-toggles input[type="checkbox"]');
  const n = await boxes.count();
  for (let i = 0; i < n; i += 1) await boxes.nth(i).uncheck();
  await boxes.nth(n - 1).check(); // the last participant alone deletes

  const { calc, verdict } = await runCeremonyPanel(page);
  await assertCeremonyArithmetic(page, calc);
  await expect(page.locator('#ceremony-verdict')).toHaveClass(/pv-ok/);
  expect(verdict).toContain('Secure');
  expect(verdict).toContain(`P${n}`);
  await expect(page.locator('#ceremony-chain .chain-node.safe')).toHaveCount(1);
});

test('powers-of-tau: randomized contributions still satisfy the same product identity', async ({ page }) => {
  const before = await readContributions(page);
  await page.locator('#ceremony-randomize').click();
  await expect(page.locator('#ceremony-calc')).toBeEmpty();
  expect(await readContributions(page)).toHaveLength(before.length);

  const { calc } = await runCeremonyPanel(page);
  await assertCeremonyArithmetic(page, calc);
});

// ════════════ EXHIBIT 05 — KZG opening and forgery ════════════

interface ForgeFacts { poly: number[]; z: number; yTrue: number; commit: number; tau: number; }

/** The fixed facts the forgery panel publishes: f, z, f(z), C and the leaked τ. */
async function readForgeFacts(page: Page): Promise<ForgeFacts> {
  const pairs = await page.locator('#forge-facts .forge-fact').evaluateAll((els) =>
    els.map((e) => [e.querySelector('.ff-k')?.textContent ?? '', e.querySelector('.ff-v')?.textContent ?? '']),
  );
  const find = (needle: string): string => {
    const hit = pairs.find(([k]) => k.toLowerCase().includes(needle));
    expect(hit, `no "${needle}" fact in ${JSON.stringify(pairs)}`).toBeTruthy();
    return hit![1];
  };

  // "f(x) = 2 + 3x + x^2"  ->  [2, 3, 1]
  const poly: number[] = [];
  for (const term of find('polynomial').split('=')[1].split('+').map((t) => t.trim())) {
    const pow = /x\^(\d+)/.exec(term);
    const deg = pow ? Number(pow[1]) : term.includes('x') ? 1 : 0;
    const coeff = /^(\d+)/.exec(term);
    poly[deg] = coeff ? Number(coeff[1]) : 1;
  }
  for (let i = 0; i < poly.length; i += 1) if (poly[i] === undefined) poly[i] = 0;

  return {
    poly,
    z: numAfter(find('evaluation point'), 'z ='),
    yTrue: numAfter(find('true value'), '='),
    commit: nums(find('commitment'))[0],
    tau: numAfter(find('leaked'), 'τ ='),
  };
}

test('KZG: the published facts are the real evaluation and the real commitment', async ({ page }) => {
  const f = await readForgeFacts(page);
  expect(f.poly.length, 'a nontrivial polynomial').toBeGreaterThan(1);
  expect(polyEvalF17(f.poly, f.z), 'the "true value" must be f(z)').toBe(f.yTrue);
  expect(f.commit, 'C = g^f(τ)').toBe(enc(polyEvalF17(f.poly, f.tau)));
  await expect(page.locator('#forge-poly')).toHaveText(/x/);
});

test('KZG: an honest opening divides exactly and the verifier equation balances', async ({ page }) => {
  const f = await readForgeFacts(page);
  const calc = page.locator('#forge-calc');
  await page.locator('#forge-honest').click();
  await expect(calc).toContainText('Honest opening');
  const text = await calc.innerText();

  const shifted = [...f.poly];
  shifted[0] = m(shifted[0] - f.yTrue, SCALAR_R);
  const { quotient, remainder } = divLinear(shifted, f.z);
  expect(remainder, 'y = f(z), so (X - z) divides exactly').toBe(0);
  expect(numAfter(text, 'remainder')).toBe(remainder);

  // "Proof π = g^q(τ) = g^<exp> = <element>"
  const qTau = polyEvalF17(quotient, f.tau);
  const proofLine = text.split('\n').find((l) => l.includes('Proof π'))!;
  expect(nums(proofLine)).toEqual([qTau, enc(qTau)]);

  const lhs = m(polyEvalF17(f.poly, f.tau) - f.yTrue, SCALAR_R);
  const rhs = m(qTau * m(f.tau - f.z, SCALAR_R), SCALAR_R);
  expect(lhs, 'the verifier equation must balance for an honest opening').toBe(rhs);
  expect(nums(text.split('Pairing check enforces')[1].split('\n')[0]).slice(-2)).toEqual([lhs, rhs]);

  await expect(calc).toHaveClass(/cb-ok/);
  await expect(page.locator('#forge-calc .calc-verdict')).toHaveClass(/pv-ok/);
  expect(text).toContain('Accepted');
  expect(text).not.toContain('honest opening path is broken');
  // The pairing-scope note the README promises is shown at the verify step.
  expect(text).toContain('No pairing is computed here');
});

test('KZG: an honest prover cannot open to a lie — the quotient leaves a remainder', async ({ page }) => {
  const f = await readForgeFacts(page);
  await page.locator('#forge-lie').click();
  await expect(page.locator('#forge-calc')).toContainText('Honest route');
  const text = await page.locator('#forge-calc').innerText();

  const yLie = numAfter(text, /prove the lie f\(\d+\) =/);
  expect(yLie, 'the demo must actually claim a false value').not.toBe(f.yTrue);
  expect(numAfter(text.split('really')[1], /f\(\d+\) =/)).toBe(f.yTrue);

  const shifted = [...f.poly];
  shifted[0] = m(shifted[0] - yLie, SCALAR_R);
  const { remainder } = divLinear(shifted, f.z);
  expect(remainder, 'a false y must leave a nonzero remainder').not.toBe(0);
  expect(numAfter(text, 'leaves remainder')).toBe(remainder);
  expect(text).toContain("can't be built from the SRS");
  expect(text).toContain('An honest prover is stuck');
});

test('KZG: a leaked tau forges an accepted opening, and the panel calls soundness broken', async ({ page }) => {
  const f = await readForgeFacts(page);
  const calc = page.locator('#forge-calc');
  await page.locator('#forge-lie').click();
  await expect(calc).toContainText('Attacker route');
  const text = await calc.innerText();
  const yLie = numAfter(text, /prove the lie f\(\d+\) =/);

  // π = g^((f(τ) − yLie)/(τ − z)) — recomputed from the panel's own facts.
  const fTau = polyEvalF17(f.poly, f.tau);
  const forgedExp = m(m(fTau - yLie, SCALAR_R) * invF17(m(f.tau - f.z, SCALAR_R)), SCALAR_R);
  const attackerLine = text.split('\n').find((l) => l.includes('Attacker route'))!;
  expect(nums(attackerLine).slice(-2)).toEqual([forgedExp, enc(forgedExp)]);

  const lhs = m(fTau - yLie, SCALAR_R);
  const rhs = m(forgedExp * m(f.tau - f.z, SCALAR_R), SCALAR_R);
  expect(lhs, 'the forged proof satisfies the verifier equation').toBe(rhs);
  expect(nums(text.split('Pairing check:')[1].split('\n')[0]).slice(-2)).toEqual([lhs, rhs]);

  await expect(calc).toHaveClass(/cb-bad/);
  await expect(page.locator('#forge-calc .calc-verdict')).toHaveClass(/pv-bad/);
  expect(text).toContain('Soundness broken');
  expect(text).toContain('accepted');
  expect(text).toContain('No pairing is computed here');
});

// ════════════ Cross-exhibit consistency of the quoted figures ════════════

test('quoted proof sizes agree across Exhibits 02, 03, 04 and the comparison table', async ({ page }) => {
  const ex2 = await page.locator('#exhibit-2').innerText();
  const ex3 = await page.locator('#exhibit-3').innerText();
  const ex4 = await page.locator('#exhibit-4').innerText();

  const groth = numAfter(ex2, 'Proof size:');
  const plonk = numAfter(ex3, 'Proof size:');
  expect(groth).toBe(128); // BN254, compressed
  expect(plonk).toBe(448);
  expect(groth, 'the headline trade-off').toBeLessThan(plonk);

  expect(ex4).toContain(`${groth} bytes (BN254, compressed)`);
  expect(ex4).toContain(`${plonk} bytes`);
  // The comparison table's PLONK range must bracket the figure quoted above it.
  const range = /~(\d+)-(\d+) bytes/.exec(ex4)!;
  expect(plonk).toBeGreaterThanOrEqual(Number(range[1]));
  expect(plonk).toBeLessThanOrEqual(Number(range[2]));
  expect(ex4, 'neither system is post-quantum').toContain('No (pairing-based)');
});

test('the simulated panels declare that they compute nothing, and carry no verify affordance', async ({ page }) => {
  for (const id of ['#exhibit-2', '#exhibit-3']) {
    const text = await page.locator(id).innerText();
    expect(text).toContain('Nothing is computed in this panel');
    expect(text).toContain('Now Prove It For Real');
  }
  // The only verify affordance on the page belongs to the real-proof panel.
  await expect(page.locator('button', { hasText: /^Verify/ })).toHaveCount(1);
  await expect(page.locator('#realproof #rp-verify')).toHaveCount(1);

  // Filler hex is filler — but the same filler wherever it is shown.
  const groth = await page.locator('#groth16-proof-hex').innerText();
  const plonk = await page.locator('#plonk-proof-hex').innerText();
  expect(groth).toBe(await page.locator('#head-groth16').innerText());
  expect(plonk).toBe(await page.locator('#head-plonk').innerText());
  expect(groth).toMatch(/^[0-9a-f]{32}\.\.\.[0-9a-f]{32}$/);
  expect(plonk).toMatch(/^[0-9a-f]{48}\.\.\.[0-9a-f]{48}$/);
  expect(plonk.length, 'the filler widths mirror 448 > 128').toBeGreaterThan(groth.length);
});

// ════════════ Self-check quiz ════════════

test('quiz: the tally counts first-try correctness, and the page marks the right answer', async ({ page }) => {
  const total = await page.locator('.quiz-q').count();
  expect(total).toBeGreaterThan(0);

  let expectedCorrect = 0;
  for (let q = 0; q < total; q += 1) {
    // Always click the FIRST option; whether that was right is the page's call.
    await page.locator(`.quiz-opt[data-q="${q}"][data-o="0"]`).click();
    const explain = page.locator(`#quiz-ex-${q}`);
    await expect(explain).toBeVisible();

    await expect(page.locator(`.quiz-opt[data-q="${q}"].quiz-correct`), 'exactly one option is marked correct').toHaveCount(1);
    const chosenWasRight = await page
      .locator(`.quiz-opt[data-q="${q}"][data-o="0"]`)
      .evaluate((el) => el.classList.contains('quiz-correct'));
    if (chosenWasRight) expectedCorrect += 1;

    await expect(explain).toHaveClass(chosenWasRight ? /qx-ok/ : /qx-bad/);
    expect(await explain.innerText()).toContain(chosenWasRight ? 'Correct' : 'Not quite');

    if (q + 1 < total) {
      const score = await page.locator('#quiz-score').innerText();
      expect(numAfter(score, 'Progress:')).toBe(q + 1);
      expect(numAfter(score, '·')).toBe(expectedCorrect);
    }
  }

  const final = await page.locator('#quiz-score').innerText();
  expect(final).toContain('Done');
  expect(nums(final).slice(0, 2)).toEqual([expectedCorrect, total]);
});

test('quiz: a correct first answer is credited', async ({ page }) => {
  // Discover the right option by answering, then start over and pick it.
  await page.locator('.quiz-opt[data-q="0"][data-o="0"]').click();
  const right = await page.locator('.quiz-opt[data-q="0"].quiz-correct').getAttribute('data-o');
  expect(right).not.toBeNull();

  await page.reload();
  await page.locator(`.quiz-opt[data-q="0"][data-o="${right}"]`).click();
  await expect(page.locator('#quiz-ex-0')).toHaveClass(/qx-ok/);
  const score = await page.locator('#quiz-score').innerText();
  expect(numAfter(score, 'Progress:')).toBe(1);
  expect(numAfter(score, '·')).toBe(1);
});

test('quiz: an answered question locks, so the tally cannot be inflated by re-clicking', async ({ page }) => {
  await page.locator('.quiz-opt[data-q="0"][data-o="0"]').click();
  const before = await page.locator('#quiz-score').innerText();

  const opts = page.locator('.quiz-opt[data-q="0"]');
  const n = await opts.count();
  for (let o = 0; o < n; o += 1) await expect(opts.nth(o)).toBeDisabled();

  await opts.nth(1).click({ force: true, timeout: 2_000 }).catch(() => undefined);
  expect(await page.locator('#quiz-score').innerText()).toBe(before);
});
