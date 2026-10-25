/** Scalar field used by Circom's BN254 R1CS backend. */
export const BN254_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export interface XorPublicStatement {
  out: bigint;
  a: bigint;
  b: bigint;
}

export function bn254(value: bigint): bigint {
  const residue = value % BN254_SCALAR_FIELD;
  return residue < 0n ? residue + BN254_SCALAR_FIELD : residue;
}

/** Arithmetic encoding of XOR; it has XOR semantics only on binary inputs. */
export function xorPolynomial(a: bigint, b: bigint): bigint {
  return bn254(a + b - 2n * a * b);
}

export function isBit(value: bigint): boolean {
  return value === 0n || value === 1n;
}

/** The application's intended computation is undefined outside {0,1}². */
export function intendedXor(a: bigint, b: bigint): bigint | null {
  if (!isBit(a) || !isBit(b)) return null;
  return a === b ? 0n : 1n;
}

export function weakXorRelation(a: bigint, b: bigint, out: bigint): boolean {
  return bn254(out) === xorPolynomial(a, b);
}

export function repairedXorRelation(a: bigint, b: bigint, out: bigint): boolean {
  return isBit(a) && isBit(b) && weakXorRelation(a, b, out);
}

/** Circom/snarkjs orders public outputs first, then declared public inputs. */
export function decodeXorPublicSignals(signals: unknown): XorPublicStatement | null {
  if (!Array.isArray(signals) || signals.length !== 3) return null;
  try {
    const [out, a, b] = signals.map((value) => BigInt(String(value)));
    return { out, a, b };
  } catch {
    return null;
  }
}

export function expectedXorPublicSignals(a: bigint, b: bigint): string[] {
  return [xorPolynomial(a, b), bn254(a), bn254(b)].map(String);
}
