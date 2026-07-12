// Trusted setup, made honest.
//
// A pairing-based SNARK needs a Structured Reference String (SRS): a list of
// group elements g^(τ^0), g^(τ^1), g^(τ^2), …  The secret exponent τ is the
// "toxic waste". Anyone who keeps τ can forge proofs for false statements; the
// security of the whole system rests on τ being unrecoverable.
//
// We make all of this concrete with real modular arithmetic on a tiny group:
//   • scalar field F_r where the exponents (τ, polynomials) live, r = 17
//   • a cyclic group of order r, elements written g^a, encoded as g^a mod P
//   • base P = 103, generator g = 64 (order exactly 17 in F_103*)
// The numbers are toy-sized so you can verify every step; real systems use the
// same construction on 254-bit elliptic curves where discrete log is infeasible.

import { Field, polyEval, polyDivLinear, type Poly } from './field';

export const SCALAR_R = 17; // prime order of the group / scalar field
export const ENC_P = 103; // encoding prime, 103 = 6·17 + 1
export const GEN_G = 64; // generator of the order-17 subgroup of F_103*

const Fr = new Field(SCALAR_R); // exponent arithmetic (mod 17)

/** Encode an exponent a as the group element g^a mod P. This is the "in the
 * exponent" trick: a is hidden behind a discrete log. */
export function enc(a: number): number {
  let result = 1;
  let b = GEN_G % ENC_P;
  let e = ((a % SCALAR_R) + SCALAR_R) % SCALAR_R;
  while (e > 0) {
    if (e & 1) result = (result * b) % ENC_P;
    b = (b * b) % ENC_P;
    e >>= 1;
  }
  return result;
}

// ── Powers of tau ─────────────────────────────────────────────────────────

export interface SrsElement { power: number; exp: number; element: number; }

/** SRS = [ g^(τ^0), g^(τ^1), …, g^(τ^degree) ]. */
export function powersOfTau(tau: number, degree: number): SrsElement[] {
  const srs: SrsElement[] = [];
  for (let i = 0; i <= degree; i += 1) {
    const exp = Fr.pow(tau, i); // τ^i mod r
    srs.push({ power: i, exp, element: enc(exp) });
  }
  return srs;
}

// ── Multi-party ceremony ──────────────────────────────────────────────────

export interface CeremonyStep {
  index: number;
  contribution: number; // this participant's secret τ_i
  deleted: boolean; // did they destroy their toxic waste?
  runningTau: number; // τ_1 · τ_2 · … · τ_i  so far
  runningElement: number; // g^(runningTau): the public SRS after this step
}

export interface CeremonyReport {
  steps: CeremonyStep[];
  finalTau: number; // the real combined secret (unknown to all if any deleted)
  secure: boolean; // true iff at least one participant deleted their waste
}

/**
 * Run a powers-of-tau ceremony. Each participant multiplies the running secret
 * by their own contribution. The combined τ is the PRODUCT of contributions, so
 * it stays unknown as long as a single participant deletes their factor.
 */
export function runCeremony(contributions: number[], deletedFlags: boolean[]): CeremonyReport {
  const steps: CeremonyStep[] = [];
  let running = 1;
  contributions.forEach((c, i) => {
    running = Fr.mul(running, c);
    steps.push({
      index: i,
      contribution: c,
      deleted: deletedFlags[i] ?? true,
      runningTau: running,
      runningElement: enc(running),
    });
  });
  return {
    steps,
    finalTau: running,
    secure: deletedFlags.some((d) => d),
  };
}

// ── KZG commitment, opening, and forgery ────────────────────────────────────
//
// These show WHY a leaked τ is catastrophic. The honest prover can only commit
// to and open genuine polynomials; an attacker holding τ can open a commitment
// to a value that is a lie, and the verifier's equation still balances.

export interface CommitResult { exp: number; element: number; }

/** C = g^(f(τ)). Computed from the SRS alone — note τ is never used here. */
export function kzgCommit(f: Poly, srs: SrsElement[]): CommitResult {
  // The SRS must expose g^(τ^i) for every coefficient index of f, i.e. its
  // degree must cover deg(f). Committing to a polynomial the SRS was not sized
  // for is undefined in KZG; catch it instead of silently reading undefined.
  if (f.length > srs.length) {
    throw new Error(
      `SRS degree ${srs.length - 1} too small to commit to a degree-${f.length - 1} polynomial`,
    );
  }
  // C = Π  SRS[i]^(a_i)  =  g^(Σ a_i τ^i)  =  g^(f(τ))
  let element = 1;
  f.forEach((coeff, i) => {
    const term = modPowSmall(srs[i].element, coeff, ENC_P);
    element = (element * term) % ENC_P;
  });
  // exponent (for display only; a real committer never learns it)
  let exp = 0;
  f.forEach((coeff, i) => { exp = Fr.add(exp, Fr.mul(coeff, srs[i].exp)); });
  return { exp, element };
}

export interface OpenResult {
  z: number;
  y: number; // claimed value f(z)
  quotient: Poly; // q(X) = (f(X) - y) / (X - z)
  remainder: number; // 0 for an honest opening
  proofExp: number; // q(τ)
  proofElement: number; // g^(q(τ))
  honest: boolean; // remainder === 0 → a real polynomial exists
}

/** Honest opening of f at z, using only the SRS. */
export function kzgOpen(f: Poly, z: number, claimedY: number, srs: SrsElement[]): OpenResult {
  if (f.length > srs.length) {
    throw new Error(
      `SRS degree ${srs.length - 1} too small to open a degree-${f.length - 1} polynomial`,
    );
  }
  const shifted = [...f];
  shifted[0] = Fr.sub(shifted[0], claimedY); // f(X) - y
  const { quotient, remainder } = polyDivLinear(Fr, shifted, z);
  // proof π = g^(q(τ)), built from the SRS
  let proofElement = 1;
  quotient.forEach((coeff, i) => {
    proofElement = (proofElement * modPowSmall(srs[i].element, coeff, ENC_P)) % ENC_P;
  });
  let proofExp = 0;
  quotient.forEach((coeff, i) => { proofExp = Fr.add(proofExp, Fr.mul(coeff, srs[i].exp)); });
  return { z, y: claimedY, quotient, remainder, proofExp, proofElement, honest: remainder === 0 };
}

export interface VerifyResult {
  lhs: number; // f(τ) - y           (in the exponent)
  rhs: number; // q(τ) · (τ - z)     (in the exponent)
  accepts: boolean;
}

/**
 * Honest disclosure of what this check is — and is not. A real KZG verifier
 * checks  e(C·g^-y, g) = e(π, g^(τ-z))  with a BILINEAR PAIRING, using only the
 * public commitment C, the proof π and the SRS; it never sees τ. This demo has
 * no pairing on its toy group, so kzgVerify below tests the SAME algebraic
 * relation the pairing enforces — the exponent equality f(τ)-y = q(τ)(τ-z) —
 * but does so by reading the exponents directly (including τ). It is a faithful
 * model of WHAT the pairing verifies, not of HOW; it must not be read as a
 * pairing implementation. This string is shown at the verify step in the UI.
 */
export const PAIRING_NOTE =
  'This checks the exponent relation f(τ)−y = q(τ)(τ−z) directly. A real verifier '
  + 'enforces the same relation with a bilinear pairing e(C·g⁻ʸ, g) = e(π, g^(τ−z)) '
  + 'over the group elements C and π alone — never touching τ. No pairing is computed here.';

/**
 * The verifier's pairing equation  e(C·g^-y, g) = e(π, g^τ·g^-z)  enforces, in
 * the exponent,  f(τ) - y = q(τ)·(τ - z).  A real verifier checks this with a
 * bilinear pairing using only C, π and the SRS — never τ. We surface the
 * exponent equality it enforces so you can see exactly what is being checked;
 * see PAIRING_NOTE for the honest scope of this model.
 */
export function kzgVerify(commitExp: number, y: number, proofExp: number, tau: number, z: number): VerifyResult {
  const lhs = Fr.sub(commitExp, y);
  const rhs = Fr.mul(proofExp, Fr.sub(tau, z));
  return { lhs, rhs, accepts: lhs === rhs };
}

export interface ForgeResult {
  honest: OpenResult; // honest attempt to open to the lie — fails (remainder ≠ 0)
  forgedProofExp: number; // attacker computes q(τ) directly using leaked τ
  forgedProofElement: number;
  verify: VerifyResult; // … and it is accepted
}

/**
 * Forge an opening of f at z to a FALSE value yLie, given the leaked secret τ.
 * The honest route is blocked (the quotient has a nonzero remainder, so no SRS
 * combination produces it). But knowing τ, the attacker divides in the exponent
 * directly:  π = g^((f(τ) - yLie)/(τ - z)).  The verifier accepts.
 */
export function forgeOpening(f: Poly, z: number, yLie: number, tau: number, srs: SrsElement[]): ForgeResult {
  const honest = kzgOpen(f, z, yLie, srs); // remainder ≠ 0: cannot be built honestly
  const fTau = polyEval(Fr, f, tau);
  const forgedProofExp = Fr.div(Fr.sub(fTau, yLie), Fr.sub(tau, z));
  const verify = kzgVerify(fTau, yLie, forgedProofExp, tau, z);
  return { honest, forgedProofExp, forgedProofElement: enc(forgedProofExp), verify };
}

// Local modpow over the encoding prime for small group exponents (coefficients).
function modPowSmall(base: number, exp: number, p: number): number {
  let result = 1;
  let b = base % p;
  let e = ((exp % SCALAR_R) + SCALAR_R) % SCALAR_R;
  while (e > 0) {
    if (e & 1) result = (result * b) % p;
    b = (b * b) % p;
    e >>= 1;
  }
  return result;
}
