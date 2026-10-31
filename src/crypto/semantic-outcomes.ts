export interface SemanticOutcome {
  domainValid: boolean; expected: number; observed: number;
  accepted: boolean; honestUnmodifiedProver: boolean; validWitness: boolean;
  malformedProof: boolean; crashed: boolean;
}
export function classifySemanticOutcome(c: SemanticOutcome): string {
  if (!c.domainValid) return 'Outside declared input domain';
  if (c.crashed) return 'Crash: not by itself a completeness failure';
  if (c.accepted && c.observed !== c.expected) return 'Soundness failure evidence: wrong result and accepted proof';
  if (!c.accepted && c.honestUnmodifiedProver && c.validWitness && !c.malformedProof) return 'Completeness failure evidence under the declared relation';
  if (!c.accepted) return 'Rejection control: no completeness failure established';
  return 'Correct result accepted: no soundness alarm';
}
