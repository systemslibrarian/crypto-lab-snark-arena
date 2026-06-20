// The textbook circuit  x^3 + x + 5 = 35,  expressed as a Rank-1 Constraint
// System (R1CS) over a real prime field. This is the same example used in
// Vitalik Buterin's QAP write-up and in countless circom tutorials.
//
// A SNARK proves "I know a witness x satisfying this constraint system" without
// revealing x. Here we make the constraint system fully concrete: the witness
// vector, the three constraint matrices, and the A·s ∘ B·s = C·s check that the
// prover must satisfy. Everything is computed live.

import { Field } from './field';

// Field prime. Mersenne prime 2^13 - 1 = 8191 — small enough to read, large
// enough that the demo's input range never wraps so the arithmetic stays clean.
export const R1CS_PRIME = 8191;

// Witness layout. Index 0 is the constant wire "1". `out` is the PUBLIC wire,
// fixed to the statement value (35). x, v1, v2 are the prover's secret wires.
//   s = [ 1 , x , out , v1 , v2 ]
export const WIRES = ['1', 'x', 'out', 'v1', 'v2'] as const;
export const PUBLIC_OUT = 35;

export interface Constraint {
  label: string;
  human: string; // human-readable form, e.g. "x · x = v1"
  a: number[];
  b: number[];
  c: number[];
}

// (v2 + x + 5)·1 = out  encodes the final addition; the constant 5 rides on the
// "1" wire. The two multiplications define the cubed term.
export const CONSTRAINTS: Constraint[] = [
  { label: 'C1', human: 'x · x = v1',          a: [0, 1, 0, 0, 0], b: [0, 1, 0, 0, 0], c: [0, 0, 0, 1, 0] },
  { label: 'C2', human: 'v1 · x = v2',         a: [0, 0, 0, 1, 0], b: [0, 1, 0, 0, 0], c: [0, 0, 0, 0, 1] },
  { label: 'C3', human: '(v2 + x + 5) · 1 = out', a: [5, 1, 0, 0, 1], b: [1, 0, 0, 0, 0], c: [0, 0, 1, 0, 0] },
];

export interface ConstraintResult {
  constraint: Constraint;
  as: number;
  bs: number;
  cs: number;
  holds: boolean;
}

export interface WitnessReport {
  x: number;
  witness: number[];
  results: ConstraintResult[];
  satisfied: boolean; // all constraints hold (against the fixed public out)
  computedOut: number; // x^3 + x + 5 mod p — what an honest prover gets
}

/**
 * Build the witness for a given secret x and evaluate every constraint against
 * the FIXED public output (35). `forgedV2`, if provided, replaces the honest v2
 * wire — used to demonstrate that a multiplication gate catches a cheating
 * prover who fudges an intermediate value.
 */
export function evaluateWitness(x: number, forgedV2?: number): WitnessReport {
  const F = new Field(R1CS_PRIME);
  const v1 = F.mul(x, x);
  const honestV2 = F.mul(v1, x);
  const v2 = forgedV2 === undefined ? honestV2 : F.mul(forgedV2, 1);
  const computedOut = F.add(F.add(v2, x), 5);

  // out is the public wire, pinned to the statement (35), NOT to the prover's
  // computed value. That is the whole point: the prover must make their wires
  // agree with the public claim.
  const witness = [1, x, PUBLIC_OUT, v1, v2];

  const results: ConstraintResult[] = CONSTRAINTS.map((cn) => {
    const as = F.dot(cn.a, witness);
    const bs = F.dot(cn.b, witness);
    const cs = F.dot(cn.c, witness);
    return { constraint: cn, as, bs, cs, holds: F.mul(as, bs) === cs };
  });

  return {
    x,
    witness,
    results,
    satisfied: results.every((r) => r.holds),
    computedOut,
  };
}
