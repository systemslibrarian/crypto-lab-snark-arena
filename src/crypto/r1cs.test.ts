import { describe, it, expect } from 'vitest';
import {
  evaluateWitness, satisfyingWitnesses, R1CS_PRIME, WIRES, PUBLIC_OUT, CONSTRAINTS,
} from './r1cs';

describe('R1CS circuit x^3 + x + 5 = 35', () => {
  it('has the advertised layout and prime', () => {
    expect(R1CS_PRIME).toBe(8191);
    expect(WIRES).toEqual(['1', 'x', 'out', 'v1', 'v2']);
    expect(PUBLIC_OUT).toBe(35);
    expect(CONSTRAINTS).toHaveLength(3);
  });

  it('accepts the honest witness x = 3 (all constraints hold)', () => {
    const r = evaluateWitness(3);
    expect(r.satisfied).toBe(true);
    expect(r.computedOut).toBe(35);
    // s = [1, x, out, v1, v2] with v1 = x^2 = 9, v2 = x^3 = 27.
    expect(r.witness).toEqual([1, 3, 35, 9, 27]);
    for (const cr of r.results) expect(cr.holds).toBe(true);
  });

  it('rejects a wrong secret: x = 2 does not satisfy the public output 35', () => {
    const r = evaluateWitness(2);
    // The multiplications are internally consistent, but the final
    // (v2 + x + 5)·1 = out constraint fails against the pinned public out.
    expect(r.computedOut).not.toBe(35);
    expect(r.satisfied).toBe(false);
    expect(r.results[2].holds).toBe(false); // C3 is the addition-to-out gate
  });

  it('catches a cheating prover who forges the intermediate wire v2', () => {
    // Prover keeps x = 3 but fudges v2 so that v2 + x + 5 = 35 (v2 = 27 already
    // does that honestly, so pick a different x where forging is needed).
    // Use x = 2 (honest v2 = 8) but forge v2 = 28 so 28 + 2 + 5 = 35.
    const r = evaluateWitness(2, 28);
    // The final addition constraint now "passes" against out = 35...
    expect(r.results[2].holds).toBe(true);
    // ...but the multiplication gate v1 · x = v2 catches the forged v2.
    expect(r.results[1].holds).toBe(false); // C2: v1·x = v2
    expect(r.satisfied).toBe(false);
  });

  // Regression: the playground used to end its failure verdict with the fixed
  // string "Only x = 3 works." That is true over the integers and false over
  // F_8191, the field the panel actually computes in. The sentence is now built
  // from this enumeration, so if the field or the public output ever changes the
  // page follows.
  it('has three satisfying witnesses over F_8191, not one', () => {
    const roots = satisfyingWitnesses();
    expect(roots).toEqual([3, 3527, 4661]);
  });

  it('every enumerated root really satisfies all three constraints', () => {
    for (const x of satisfyingWitnesses()) {
      const r = evaluateWitness(x);
      expect(r.satisfied).toBe(true);
      expect(r.computedOut).toBe(PUBLIC_OUT);
    }
  });

  it('only one satisfying witness is reachable from the slider range 0..9', () => {
    const reachable = satisfyingWitnesses().filter((x) => x <= 9);
    expect(reachable).toEqual([3]);
  });

  it('every constraint enforces (A·s)(B·s) = (C·s) exactly', () => {
    const r = evaluateWitness(3);
    for (const cr of r.results) {
      expect((cr.as * cr.bs) % R1CS_PRIME).toBe(cr.cs % R1CS_PRIME);
    }
  });
});
