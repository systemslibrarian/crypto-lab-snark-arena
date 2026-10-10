import { expect, it } from 'vitest';
import { evaluateWitness, R1CS_PRIME, satisfyingWitnesses } from './r1cs';

it('the public cubic output identifies each input in the real-proof slider range', () => {
  const outputs = Array.from({ length: 21 }, (_, x) => evaluateWitness(x).computedOut);
  expect(new Set(outputs).size).toBe(21);
  for (let x = 0; x <= 20; x++) {
    const out = outputs[x];
    expect(BigInt(out)).toBe(BigInt(x) ** 3n + BigInt(x) + 5n);
    expect(out).toBeLessThan(R1CS_PRIME); // no field wrap even in the smaller toy field
    expect(outputs.flatMap((candidate, i) => candidate === out ? [i] : [])).toEqual([x]);
  }
  expect(outputs.indexOf(35)).toBe(3);
  // Distinct roots over the full toy field remain distinct from this UI range.
  expect(satisfyingWitnesses()).toEqual([3, 3527, 4661]);
});
