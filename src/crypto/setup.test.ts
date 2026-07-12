import { describe, it, expect } from 'vitest';
import {
  enc, powersOfTau, runCeremony, kzgCommit, kzgOpen, kzgVerify, forgeOpening,
  SCALAR_R, ENC_P, GEN_G, PAIRING_NOTE,
} from './setup';
import { Field, polyEval, type Poly } from './field';

const Fr = new Field(SCALAR_R);
const POLY: Poly = [2, 3, 1]; // f(x) = 2 + 3x + x^2
const TAU = 5;
const Z = 4;

describe('encoding group F_103, generator 64', () => {
  it('uses the advertised toy parameters', () => {
    expect(SCALAR_R).toBe(17);
    expect(ENC_P).toBe(103);
    expect(GEN_G).toBe(64);
  });

  it('generator 64 has order exactly 17 in F_103*', () => {
    let x = 1;
    let order = 0;
    for (let i = 1; i <= SCALAR_R + 1; i += 1) {
      x = (x * GEN_G) % ENC_P;
      if (x === 1) { order = i; break; }
    }
    expect(order).toBe(17);
  });

  it('enc is a group homomorphism: enc(a+b) = enc(a)*enc(b) mod P', () => {
    for (let a = 0; a < SCALAR_R; a += 1) {
      for (let b = 0; b < SCALAR_R; b += 1) {
        const lhs = enc(Fr.add(a, b));
        const rhs = (enc(a) * enc(b)) % ENC_P;
        expect(lhs).toBe(rhs);
      }
    }
  });

  it('matches hand-computed encodings', () => {
    expect(enc(0)).toBe(1);
    expect(enc(1)).toBe(64);
    expect(enc(8)).toBe(13);
  });
});

describe('powersOfTau SRS', () => {
  it('produces g^(tau^i) with correct exponents', () => {
    const srs = powersOfTau(TAU, 2);
    expect(srs.map((s) => s.exp)).toEqual([1, 5, 8]); // tau^0, tau^1, tau^2 mod 17
    expect(srs.map((s) => s.element)).toEqual([64, 93, 13]);
    expect(srs.map((s) => s.power)).toEqual([0, 1, 2]);
  });
});

describe('runCeremony (powers of tau)', () => {
  it('combined tau is the PRODUCT of contributions', () => {
    const rep = runCeremony([2, 3, 5], [true, true, true]);
    expect(rep.finalTau).toBe(Fr.mul(Fr.mul(2, 3), 5)); // 30 mod 17 = 13
    expect(rep.finalTau).toBe(13);
    expect(rep.steps).toHaveLength(3);
    expect(rep.steps[2].runningElement).toBe(enc(13));
  });

  it('is secure iff at least one participant deletes their toxic waste', () => {
    expect(runCeremony([2, 3], [false, true]).secure).toBe(true);
    expect(runCeremony([2, 3], [true, false]).secure).toBe(true);
    expect(runCeremony([2, 3], [false, false]).secure).toBe(false);
  });
});

describe('KZG commit', () => {
  it('C = g^(f(tau)); exponent equals f(tau) mod r', () => {
    const srs = powersOfTau(TAU, POLY.length - 1);
    const c = kzgCommit(POLY, srs);
    expect(c.exp).toBe(polyEval(Fr, POLY, TAU)); // f(5) = 8
    expect(c.exp).toBe(8);
    expect(c.element).toBe(enc(8)); // 13
  });

  it('throws if the SRS degree is too small for the polynomial', () => {
    const srs = powersOfTau(TAU, 1); // covers up to degree 1
    expect(() => kzgCommit(POLY, srs)).toThrow(/SRS degree/); // POLY is degree 2
  });
});

describe('KZG open + verify (honest)', () => {
  it('honest opening has remainder 0 and verifies', () => {
    const srs = powersOfTau(TAU, POLY.length - 1);
    const commit = kzgCommit(POLY, srs);
    const yTrue = polyEval(Fr, POLY, Z); // f(4) = 13
    const open = kzgOpen(POLY, Z, yTrue, srs);
    expect(open.remainder).toBe(0);
    expect(open.honest).toBe(true);
    expect(open.proofExp).toBe(12); // q(tau) = 12

    const v = kzgVerify(commit.exp, yTrue, open.proofExp, TAU, Z);
    expect(v.accepts).toBe(true);
    expect(v.lhs).toBe(v.rhs);
  });

  it('rejects an honest opening claiming the WRONG value', () => {
    const srs = powersOfTau(TAU, POLY.length - 1);
    const commit = kzgCommit(POLY, srs);
    const yLie = 7; // real f(4) = 13
    const open = kzgOpen(POLY, Z, yLie, srs);
    // Honest route cannot produce a valid quotient: nonzero remainder.
    expect(open.remainder).not.toBe(0);
    expect(open.honest).toBe(false);
    // And feeding that honest (broken) proof through verify is rejected.
    const v = kzgVerify(commit.exp, yLie, open.proofExp, TAU, Z);
    expect(v.accepts).toBe(false);
  });

  it('throws if the SRS is too small to open', () => {
    const srs = powersOfTau(TAU, 1);
    expect(() => kzgOpen(POLY, Z, 13, srs)).toThrow(/SRS degree/);
  });
});

describe('KZG forgery with leaked tau (soundness break)', () => {
  it('an attacker holding tau forges an accepted proof of a lie', () => {
    const srs = powersOfTau(TAU, POLY.length - 1);
    const yLie = 7; // false claim: f(4) = 7 (truly 13)
    const fg = forgeOpening(POLY, Z, yLie, TAU, srs);

    // Honest route is blocked (nonzero remainder)...
    expect(fg.honest.remainder).not.toBe(0);
    // ...but the forged proof, built by dividing in the exponent, is ACCEPTED.
    expect(fg.verify.accepts).toBe(true);
    expect(fg.forgedProofExp).toBe(1); // (f(5)-7)/(5-4) = 1 mod 17
    expect(fg.forgedProofElement).toBe(enc(1));
  });

  it('the SAME leaked-tau trick fails once tau is unknown to the verifier — sanity: honest y still verifies, lie only passes via forgery', () => {
    const srs = powersOfTau(TAU, POLY.length - 1);
    const commit = kzgCommit(POLY, srs);
    // A verifier given the real commitment + an honest proof accepts the truth
    // and rejects the lie when the proof is built honestly.
    const yTrue = polyEval(Fr, POLY, Z);
    const honest = kzgOpen(POLY, Z, yTrue, srs);
    expect(kzgVerify(commit.exp, yTrue, honest.proofExp, TAU, Z).accepts).toBe(true);
  });
});

describe('honesty disclosure', () => {
  it('PAIRING_NOTE states that no real pairing is computed', () => {
    expect(PAIRING_NOTE).toMatch(/pairing/i);
    expect(PAIRING_NOTE).toMatch(/No pairing is computed here|never touching τ/);
  });
});
