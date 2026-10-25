import { expect, test } from '@playwright/test';

const BN254_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

async function runComparison(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#cw-run').click();
  await expect(page.locator('#cw-run')).toBeEnabled({ timeout: 120_000 });
}

test('actual Groth16 backends preserve a legitimate witness before and after repair', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('.');
  await expect(page.locator('#cw-contract')).toContainText('Intended computation: ACCEPT');

  await runComparison(page);

  const weak = page.locator('#cw-weak-out');
  const repaired = page.locator('#cw-repaired-out');
  await expect(weak).toHaveAttribute('data-result', 'weak-accepted-legitimate');
  await expect(repaired).toHaveAttribute('data-result', 'repaired-accepted-legitimate');
  await expect(weak).toContainText('groth16.verify → true');
  await expect(repaired).toContainText('groth16.verify → true');
  await expect(weak).toContainText('[out, a, b] = [1, 0, 1]');
  await expect(weak).toContainText('integer expression is 1');
  await expect(weak).not.toContainText('integer expression is −4');
  await expect(repaired).toContainText('[out, a, b] = [1, 0, 1]');
});

test('actual weak relation proves the explicit phantom output and repaired relation rejects it', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('.');
  await page.locator('#cw-a').selectOption('2');
  await page.locator('#cw-b').selectOption('2');

  const contract = page.locator('#cw-contract');
  await expect(contract).toContainText('Intended computation: REJECT');
  await expect(contract).toContainText('not the circuit repair');
  await runComparison(page);

  const weak = page.locator('#cw-weak-out');
  const repaired = page.locator('#cw-repaired-out');
  const residue = BN254_R - 4n;
  await expect(weak).toHaveAttribute('data-result', 'weak-accepted-phantom');
  await expect(weak).toContainText('groth16.verify → true');
  await expect(weak).toContainText(`[out, a, b] = [${residue}, 2, 2]`);
  await expect(weak).toContainText('integer expression is −4');
  await expect(weak).toContainText('genuine and unmodified');
  await expect(repaired).toHaveAttribute('data-result', 'repaired-rejected-phantom');
  await expect(repaired).toContainText('No proof produced');
  await expect(repaired).toContainText('This is the repair');
  await expect(repaired).not.toContainText('groth16.verify → true');

  await page.locator('#cw-tamper').click();
  const tampered = page.locator('#cw-tamper-out');
  await expect(tampered).toHaveAttribute('data-result', 'tampered-rejected', { timeout: 60_000 });
  await expect(tampered).toContainText('groth16.verify → false');
  await expect(tampered).toContainText('distinct');
});

test('changing inputs retires old proof evidence and disables tampering', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('.');
  await runComparison(page);
  await expect(page.locator('#cw-tamper')).toBeEnabled();

  await page.locator('#cw-a').selectOption('2');
  for (const selector of ['#cw-weak-out', '#cw-repaired-out']) {
    await expect(page.locator(selector)).toContainText('earlier evidence has been retired');
    await expect(page.locator(selector)).not.toHaveAttribute('data-result', /.+/);
    await expect(page.locator(selector)).not.toContainText('groth16.verify → true');
  }
  await expect(page.locator('#cw-tamper')).toBeDisabled();
});

test('an unrelated repaired-backend error is never presented as constraint rejection', async ({ page }) => {
  await page.addInitScript(() => {
    let calls = 0;
    Object.defineProperty(window, 'snarkjs', {
      configurable: true,
      value: {
        groth16: {
          fullProve: async ({ a, b }: { a: string; b: string }) => {
            calls += 1;
            if (calls === 2) throw new Error('network fixture failure');
            const av = BigInt(a);
            const bv = BigInt(b);
            const r = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
            const out = ((av + bv - 2n * av * bv) % r + r) % r;
            return {
              proof: { pi_a: ['1', '2', '1'], pi_b: [['1', '2'], ['3', '4'], ['1', '0']], pi_c: ['5', '6', '1'] },
              publicSignals: [String(out), a, b],
            };
          },
          verify: async () => true,
        },
      },
    });
  });
  await page.goto('.');
  await page.locator('#cw-a').selectOption('2');
  await page.locator('#cw-b').selectOption('2');
  await runComparison(page);

  await expect(page.locator('#cw-weak-out')).toHaveAttribute('data-result', 'weak-accepted-phantom');
  await expect(page.locator('#cw-repaired-out')).toHaveAttribute('data-result', 'repaired-backend-error');
  await expect(page.locator('#cw-repaired-out')).toContainText('no security conclusion');
  await expect(page.locator('#cw-repaired-out')).not.toContainText('This is the repair');
});

test('an operational tamper-check error is never presented as cryptographic rejection', async ({ page }) => {
  await page.addInitScript(() => {
    let verificationCalls = 0;
    Object.defineProperty(window, 'snarkjs', {
      configurable: true,
      value: {
        groth16: {
          fullProve: async ({ a, b }: { a: string; b: string }) => ({
            proof: { pi_a: ['1', '2', '1'], pi_b: [['1', '2'], ['3', '4'], ['1', '0']], pi_c: ['5', '6', '1'] },
            publicSignals: [String(BigInt(a) ^ BigInt(b)), a, b],
          }),
          verify: async () => {
            verificationCalls += 1;
            if (verificationCalls === 3) throw new Error('transport fixture failure');
            return true;
          },
        },
      },
    });
  });
  await page.goto('.');
  await runComparison(page);
  await page.locator('#cw-tamper').click();

  const output = page.locator('#cw-tamper-out');
  await expect(output).toHaveAttribute('data-result', 'tampered-backend-error');
  await expect(output).toContainText('no proof-tampering claim');
  await expect(output).toContainText('not cryptographic rejection');
  await expect(output).not.toContainText('groth16.verify → false');
});

test('an in-flight proof cannot publish after the selected assignment changes', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'snarkjs', {
      configurable: true,
      value: {
        groth16: {
          fullProve: async ({ a, b }: { a: string; b: string }) => {
            await new Promise((resolve) => setTimeout(resolve, 300));
            return {
              proof: { pi_a: ['1', '2', '1'], pi_b: [['1', '2'], ['3', '4'], ['1', '0']], pi_c: ['5', '6', '1'] },
              publicSignals: [String(BigInt(a) ^ BigInt(b)), a, b],
            };
          },
          verify: async () => true,
        },
      },
    });
  });
  await page.goto('.');
  await page.locator('#cw-run').click();
  await expect(page.locator('#cw-weak-out')).toContainText('Generating and verifying');
  await page.locator('#cw-a').selectOption('1');
  await expect(page.locator('#cw-weak-out')).toContainText('earlier evidence has been retired');
  await page.waitForTimeout(500);

  await expect(page.locator('#cw-weak-out')).toContainText('earlier evidence has been retired');
  await expect(page.locator('#cw-weak-out')).not.toContainText('groth16.verify → true');
  await expect(page.locator('#cw-tamper')).toBeDisabled();
  await expect(page.locator('#cw-run')).toBeEnabled();
});
