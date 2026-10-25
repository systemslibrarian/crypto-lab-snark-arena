import { describe, expect, it } from 'vitest';
import {
  BN254_SCALAR_FIELD,
  bn254,
  decodeXorPublicSignals,
  expectedXorPublicSignals,
  intendedXor,
  repairedXorRelation,
  weakXorRelation,
  xorPolynomial,
} from './constraint-gap';

describe('computation/constraint XOR gap', () => {
  it.each([
    [0n, 0n, 0n],
    [0n, 1n, 1n],
    [1n, 0n, 1n],
    [1n, 1n, 0n],
  ])('agrees on the legitimate binary assignment (%s, %s)', (a, b, out) => {
    expect(intendedXor(a, b)).toBe(out);
    expect(xorPolynomial(a, b)).toBe(out);
    expect(weakXorRelation(a, b, out)).toBe(true);
    expect(repairedXorRelation(a, b, out)).toBe(true);
  });

  it('derives the paper example as a phantom output, not random corruption', () => {
    const out = xorPolynomial(2n, 2n);
    expect(out).toBe(BN254_SCALAR_FIELD - 4n);
    expect(intendedXor(2n, 2n)).toBeNull();
    expect(weakXorRelation(2n, 2n, out)).toBe(true);
    expect(repairedXorRelation(2n, 2n, out)).toBe(false);
  });

  it('rejects an output that does not satisfy even the weak polynomial', () => {
    expect(weakXorRelation(2n, 2n, BN254_SCALAR_FIELD - 3n)).toBe(false);
    expect(repairedXorRelation(0n, 1n, 0n)).toBe(false);
  });

  it('normalizes negative and wrapped field representatives', () => {
    expect(bn254(-4n)).toBe(BN254_SCALAR_FIELD - 4n);
    expect(bn254(BN254_SCALAR_FIELD + 7n)).toBe(7n);
  });

  it('binds the public-signal order and rejects malformed backend output', () => {
    const expected = expectedXorPublicSignals(2n, 2n);
    expect(expected).toEqual([String(BN254_SCALAR_FIELD - 4n), '2', '2']);
    expect(decodeXorPublicSignals(expected)).toEqual({
      out: BN254_SCALAR_FIELD - 4n,
      a: 2n,
      b: 2n,
    });
    expect(decodeXorPublicSignals(['1', '2'])).toBeNull();
    expect(decodeXorPublicSignals(['1', 'not-a-field-value', '2'])).toBeNull();
  });
});
