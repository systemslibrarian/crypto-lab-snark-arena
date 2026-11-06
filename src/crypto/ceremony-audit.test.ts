import { describe, it, expect } from 'vitest';
import { auditCase, auditTranscript, ownReceipt, powers } from './ceremony-audit';
describe('toy ceremony evidence checks', () => {
  it.each([
    ['honest', 'pass', 'pass', 'pass'], ['replacement', 'pass', 'fail', 'fail'],
    ['missing', 'pass', 'unavailable', 'unavailable'], ['corrupt', 'pass', 'fail', 'fail'],
    ['omitted', 'pass', 'pass', 'fail'],
  ] as const)('%s distinguishes consistency, chain, and inclusion', (kind, finalConsistency, updateChain, ownInclusion) => {
    expect(auditTranscript(auditCase(kind))).toMatchObject({ finalConsistency, updateChain, ownInclusion });
  });
  it('locates a corrupted intermediate link even with a consistent final vector', () => {
    expect(auditTranscript(auditCase('corrupt')).firstBadLink).toBe(2);
  });
  it('rejects an inconsistent final vector and a forged receipt with only the right name', () => {
    const t = auditCase('honest'); t.final[3] = 0;
    expect(auditTranscript(t).finalConsistency).toBe('fail');
    const receipt = ownReceipt(); receipt.after = powers(7);
    expect(auditTranscript(auditCase('honest'), receipt).ownInclusion).toBe('fail');
  });
  it('rejects a noncanonical vector, zero update, or disconnected initial state', () => {
    for (const mutate of [(t: ReturnType<typeof auditCase>) => { t.final[0] = 18; },
      (t: ReturnType<typeof auditCase>) => { t.updates![0].factor = 0; },
      (t: ReturnType<typeof auditCase>) => { t.updates![0].before = powers(2); }]) {
      const t = auditCase('honest'); mutate(t); expect(auditTranscript(t).updateChain).toBe('fail');
    }
  });
});
