// Transparent finite-field arithmetic.
//
// Everything in a SNARK happens over a prime field F_p: the circuit wires, the
// witness, the trusted-setup secret, the polynomials. This module implements
// that field directly so the demo computes real values you can check by hand —
// nothing here is faked or hard-coded.

export function mod(a: number, p: number): number {
  return ((a % p) + p) % p;
}

/** A prime field F_p. p is kept small so every value is human-readable. */
export class Field {
  constructor(public readonly p: number) {}

  add(a: number, b: number): number { return mod(a + b, this.p); }
  sub(a: number, b: number): number { return mod(a - b, this.p); }
  mul(a: number, b: number): number { return mod(a * b, this.p); }

  /** Modular exponentiation by square-and-multiply. */
  pow(base: number, exp: number): number {
    let result = 1;
    let b = mod(base, this.p);
    let e = exp;
    while (e > 0) {
      if (e & 1) result = mod(result * b, this.p);
      b = mod(b * b, this.p);
      e >>= 1;
    }
    return result;
  }

  /** Multiplicative inverse via Fermat's little theorem: a^(p-2) mod p. */
  inv(a: number): number {
    if (mod(a, this.p) === 0) throw new Error('no inverse of 0');
    return this.pow(a, this.p - 2);
  }

  div(a: number, b: number): number { return this.mul(a, this.inv(b)); }

  /** Dot product of two equal-length vectors, reduced mod p. */
  dot(u: number[], v: number[]): number {
    let acc = 0;
    for (let i = 0; i < u.length; i += 1) acc = mod(acc + u[i] * v[i], this.p);
    return acc;
  }
}

// ── Dense univariate polynomials over a Field (coefficients low-degree first) ──

export type Poly = number[];

export function polyEval(F: Field, poly: Poly, x: number): number {
  // Horner's method.
  let acc = 0;
  for (let i = poly.length - 1; i >= 0; i -= 1) acc = F.add(F.mul(acc, x), poly[i]);
  return acc;
}

/**
 * Divide poly by the linear factor (X - z), returning quotient and remainder.
 * If z is a root, the remainder is 0 and the quotient is an honest polynomial.
 * This is exactly the step a KZG opening proof relies on.
 */
export function polyDivLinear(F: Field, poly: Poly, z: number): { quotient: Poly; remainder: number } {
  const n = poly.length;
  if (n === 0) return { quotient: [], remainder: 0 };
  const quotient = new Array<number>(n - 1).fill(0);
  let carry = poly[n - 1];
  for (let i = n - 2; i >= 0; i -= 1) {
    quotient[i] = carry;
    carry = F.add(poly[i], F.mul(carry, z));
  }
  return { quotient, remainder: carry };
}

/** Pretty-print a polynomial like  3 + 2x + x^2  over its field. */
export function polyToString(poly: Poly): string {
  const terms: string[] = [];
  poly.forEach((c, i) => {
    if (c === 0) return;
    if (i === 0) terms.push(`${c}`);
    else if (i === 1) terms.push(c === 1 ? 'x' : `${c}x`);
    else terms.push(c === 1 ? `x^${i}` : `${c}x^${i}`);
  });
  return terms.length ? terms.join(' + ') : '0';
}
