import { classifySemanticOutcome } from '../crypto/semantic-outcomes';
import type { SemanticOutcome } from '../crypto/semantic-outcomes';

export function initSemanticOutcomes(): void {
  const host=document.getElementById('exhibit-constraint-gap'); if(!host)return;
  const panel=document.createElement('section'); panel.className='panel';
  panel.setAttribute('aria-labelledby','semantic-outcome-heading');
  panel.innerHTML=`<h3 id="semantic-outcome-heading">Does a changed execution change the answer?</h3>
    <p>This is a hypothetical outcome-classification exercise, not a new proof generator or an Arguzz audit of this lab. The existing weak-XOR and proof-byte controls above still run real proof verification.</p>
    <p>Hold the declared circuit C, statement S and verifier V fixed while comparing executions of a program. For the toy computation z = x × 0 + 7 over a finite field, changing x from 3 to 99 still gives z = 7. A mutation without an output mismatch is a negative control.</p>
    <label for="semantic-case">Recorded outcome</label><select id="semantic-case"><option value="correct">Correct output 7, proof accepted</option><option value="wrong">Wrong output 8, proof accepted</option><option value="honest">Honest unmodified prover with valid witness, proof rejected</option><option value="ineffectual">Change x in x × 0 + 7, output still 7, accepted</option><option value="malformed">Correct numeric output, malformed proof rejected</option><option value="crash">Fault causes a crash</option><option value="domain">Use division identity with zero denominator</option></select>
    <button type="button" id="semantic-evaluate">Classify outcome</button><p id="semantic-result" role="status"></p>
    <p>A wrong result plus acceptance is required for soundness evidence. Completeness evidence requires a legitimate, unmodified prover with a domain-valid input/witness under the declared relation. A correct number does not make malformed proof bytes valid. Division identities require a nonzero denominator. Do not count a fault-induced crash as a completeness bug.</p>
    <p>Source: <a href="https://www.usenix.org/conference/usenixsecurity26/presentation/hochrainer" target="_blank" rel="noopener noreferrer">Arguzz: Testing zkVMs for Soundness and Completeness Bugs</a>, pp. 5–10, 12, 20–21. This teaching adaptation does not reproduce zkVM attacks.</p>`;
  panel.querySelector('#semantic-evaluate')!.addEventListener('click',()=>{
    const kind=panel.querySelector<HTMLSelectElement>('#semantic-case')!.value;
    const c: SemanticOutcome={domainValid:kind!=='domain',expected:7,observed:kind==='wrong'?8:7,
      accepted:['correct','wrong','ineffectual'].includes(kind),honestUnmodifiedProver:kind==='honest',validWitness:kind==='honest',malformedProof:kind==='malformed',crashed:kind==='crash'};
    panel.querySelector('#semantic-result')!.textContent=classifySemanticOutcome(c);
  });
  host.append(panel);
}
