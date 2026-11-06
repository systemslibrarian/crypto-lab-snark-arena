/** Disclosed exponents in F_17: no pairings, proofs of knowledge, or real SRS security. */
export type Check = 'pass' | 'fail' | 'unavailable';
export type AuditCase = 'honest' | 'replacement' | 'missing' | 'corrupt' | 'omitted';
export interface Update { participant: string; factor: number; before: number[]; after: number[] }
export interface Transcript { final: number[]; updates: Update[] | null }
const R = 17;
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const canonical = (a: number[]) => a.length === 4 && a.every(x => Number.isInteger(x) && x >= 0 && x < R);
export function powers(tau: number): number[] {
  if (!Number.isInteger(tau) || tau < 1 || tau >= R) throw new Error('tau must be nonzero in F_17');
  return [1, tau, tau * tau % R, tau * tau * tau % R];
}
function chain(factors: Array<[string, number]>): Update[] {
  let tau = 1;
  return factors.map(([participant, factor]) => {
    const before = powers(tau); tau = tau * factor % R;
    return { participant, factor, before, after: powers(tau) };
  });
}
const honest = () => chain([['P1', 3], ['You', 5], ['P3', 2]]);
/** A retained receipt binds the contributor to both states, not just a name. */
export const ownReceipt = (): Update => honest()[1];
export function auditCase(kind: AuditCase): Transcript {
  const updates = kind === 'omitted' ? chain([['P1', 3], ['P3', 2]]) : honest();
  const final = [...updates[updates.length - 1].after];
  if (kind === 'replacement') return { final: powers(7), updates };
  if (kind === 'missing') return { final, updates: null };
  if (kind === 'corrupt') updates[1].after[2] = (updates[1].after[2] + 1) % R;
  return { final, updates };
}
export function auditTranscript(t: Transcript, receipt = ownReceipt()): {
  finalConsistency: Check; updateChain: Check; ownInclusion: Check; firstBadLink: number | null;
} {
  const validFinal = canonical(t.final) && t.final[1] !== 0 && same(t.final, powers(t.final[1]));
  const result = { finalConsistency: validFinal ? 'pass' : 'fail', updateChain: 'unavailable', ownInclusion: 'unavailable', firstBadLink: null } as ReturnType<typeof auditTranscript>;
  if (!t.updates) return result;
  let previous = powers(1);
  for (const [i, u] of t.updates.entries()) {
    const factorValid = Number.isInteger(u.factor) && u.factor > 0 && u.factor < R;
    const expected = u.before.map((x, k) => x * u.factor ** k % R);
    if (!factorValid || !canonical(u.before) || !canonical(u.after) || !same(previous, u.before) || !same(expected, u.after)) {
      result.firstBadLink = i + 1; break;
    }
    previous = u.after;
  }
  result.updateChain = result.firstBadLink === null && same(previous, t.final) ? 'pass' : 'fail';
  // A receipt in a broken or disconnected chain does not prove inclusion in the final result.
  result.ownInclusion = result.updateChain === 'pass' && t.updates.some(u =>
    u.participant === receipt.participant && u.factor === receipt.factor && same(u.before, receipt.before) && same(u.after, receipt.after)) ? 'pass' : 'fail';
  return result;
}
