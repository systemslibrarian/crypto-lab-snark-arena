import { describe, it, expect } from 'vitest';
import {
  mod, Field, polyEval, polyDivLinear, polyToString, type Poly,
} from './field';

// Reference field for most tests: F_17, the toy scalar field the demo advertises.
const F = new Field(17);

describe('mod', () => {
  it('reduces into [0, p)', () => {
    expect(mod(0, 17)).toBe(0);
    expect(mod(17, 17)).toBe(0);
    expect(mod(18, 17)).toBe(1);
    expect(mod(35, 17)).toBe(1);
  });

  it('maps negatives to a non-negative representative', () => {
    expect(mod(-1, 17)).toBe(16);
    expect(mod(-17, 17)).toBe(0);
    expect(mod(-18, 17)).toBe(16);
  });
});

describe('Field add/sub/mul', () => {
  it('wraps around the modulus', () => {
    expect(F.add(10, 10)).toBe(3); // 20 mod 17
    expect(F.sub(3, 10)).toBe(10); // -7 mod 17
    expect(F.mul(5, 7)).toBe(1); // 35 mod 17
  });

  it('add is commutative and 0 is the additive identity', () => {
    for (let a = 0; a < 17; a += 1) {
      expect(F.add(a, 0)).toBe(a);
      for (let b = 0; b < 17; b += 1) {
        expect(F.add(a, b)).toBe(F.add(b, a));
      }
    }
  });
});

describe('Field.pow', () => {
  it('matches known small powers', () => {
    expect(F.pow(2, 0)).toBe(1);
    expect(F.pow(2, 4)).toBe(16); // 16
    expect(F.pow(2, 5)).toBe(15); // 32 mod 17
    expect(F.pow(3, 3)).toBe(10); // 27 mod 17
  });

  it("satisfies Fermat's little theorem a^(p-1) = 1 for a != 0", () => {
    for (let a = 1; a < 17; a += 1) {
      expect(F.pow(a, 16)).toBe(1);
    }
  });
});

describe('Field.inv / div', () => {
  it('produces the multiplicative inverse (a * inv(a) = 1)', () => {
    for (let a = 1; a < 17; a += 1) {
      expect(F.mul(a, F.inv(a))).toBe(1);
    }
  });

  it('matches hand-computed inverses in F_17', () => {
    expect(F.inv(1)).toBe(1);
    expect(F.inv(2)).toBe(9); // 2*9 = 18 = 1
    expect(F.inv(3)).toBe(6); // 3*6 = 18 = 1
    expect(F.inv(4)).toBe(13); // 4*13 = 52 = 1
  });

  it('throws on inverse of 0', () => {
    expect(() => F.inv(0)).toThrow();
    expect(() => F.inv(17)).toThrow(); // 17 ≡ 0
  });

  it('div(a, b) = a * inv(b)', () => {
    expect(F.div(1, 2)).toBe(F.inv(2));
    expect(F.mul(F.div(7, 3), 3)).toBe(7); // (7/3)*3 = 7
  });
});

describe('Field.dot', () => {
  it('computes a reduced dot product', () => {
    expect(F.dot([1, 2, 3], [4, 5, 6])).toBe(mod(4 + 10 + 18, 17)); // 32 -> 15
    expect(F.dot([0, 0], [9, 9])).toBe(0);
  });
});

describe('polyEval (Horner)', () => {
  const poly: Poly = [2, 3, 1]; // 2 + 3x + x^2
  it('matches direct evaluation over F_17', () => {
    expect(polyEval(F, poly, 4)).toBe(mod(2 + 12 + 16, 17)); // f(4) = 30 -> 13
    expect(polyEval(F, poly, 5)).toBe(mod(2 + 15 + 25, 17)); // f(5) = 42 -> 8
    expect(polyEval(F, poly, 0)).toBe(2);
  });
});

describe('polyDivLinear', () => {
  it('divides exactly when z is a root (remainder 0)', () => {
    // f(x) = 2 + 3x + x^2, f(4) = 13 over F_17; (f - 13)/(x - 4) is exact.
    const shifted: Poly = [F.sub(2, 13), 3, 1];
    const { quotient, remainder } = polyDivLinear(F, shifted, 4);
    expect(remainder).toBe(0);
    // Reconstruct: quotient*(x-4) + remainder should equal shifted.
    expect(polyEval(F, quotient, 5)).toBe(12); // q(5) = 12 (used by KZG proof)
  });

  it('leaves a nonzero remainder when z is not a root', () => {
    // Opening f to a lie y=7 at z=4 leaves remainder != 0 (the forgery setup).
    const shifted: Poly = [F.sub(2, 7), 3, 1];
    const { remainder } = polyDivLinear(F, shifted, 4);
    expect(remainder).not.toBe(0);
  });

  it('satisfies the division identity f(x) = q(x)(x - z) + r for all points', () => {
    const f: Poly = [5, 0, 2, 1]; // 5 + 2x^2 + x^3
    const z = 3;
    const { quotient, remainder } = polyDivLinear(F, f, z);
    for (let x = 0; x < 17; x += 1) {
      const lhs = polyEval(F, f, x);
      const rhs = F.add(F.mul(polyEval(F, quotient, x), F.sub(x, z)), remainder);
      expect(lhs).toBe(rhs);
    }
  });

  it('handles the empty polynomial', () => {
    expect(polyDivLinear(F, [], 3)).toEqual({ quotient: [], remainder: 0 });
  });
});

describe('polyToString', () => {
  it('formats terms with 0 for the zero polynomial', () => {
    expect(polyToString([0, 0, 0])).toBe('0');
    expect(polyToString([2, 3, 1])).toBe('2 + 3x + x^2');
    expect(polyToString([0, 1])).toBe('x');
  });
});
