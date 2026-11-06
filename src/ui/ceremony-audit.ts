import { auditCase, auditTranscript, ownReceipt, type AuditCase } from '../crypto/ceremony-audit';
export function initCeremonyAudit(): void {
  const host = document.getElementById('ceremony-audit');
  if (!host) return;
  host.innerHTML = `
    <h3>Three questions for a ceremony transcript</h3>
    <p>A consistent final SRS (structured reference string), a valid update chain, and evidence that your contribution is included are different checks. Predict which checks will pass before selecting a case.</p>
    <label for="audit-case">Transcript case</label>
    <select id="audit-case">
      <option value="honest">Complete honest chain</option>
      <option value="replacement">Replace final SRS with consistent powers</option>
      <option value="missing">Missing transcript</option>
      <option value="corrupt">Corrupt intermediate update</option>
      <option value="omitted">Omit your contribution</option>
    </select>
    <div id="audit-result" role="status" aria-live="polite"></div>
    <pre id="audit-transcript" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>
    <p>Toy algebra: disclosed exponent vectors [1, τ, τ², τ³] modulo 17. Each update scales entry k by factorᵏ. We check every retained link from [1,1,1,1] and bind its endpoint to the final vector; your receipt records the exact before/after states. A missing transcript means unavailable evidence, not a proved invalid ceremony. A failed inclusion check means this evidence does not establish inclusion.</p>
    <p>This is not a pairing-based SRS verifier, a proof of knowledge, randomized batch verification, or the paper’s protocol. Small public factors and receipts provide no cryptographic security or authentication. No check here proves secret deletion. Real ceremony security still needs the protocol’s assumptions, including an honest contribution and erasure where required.</p>
    <p>Source: <a href="https://eprint.iacr.org/2023/1161">Baghery, Mertens, and Sedaghat, Benchmarking the Setup of Updatable zk-SNARKs</a>, p. 4 (§1 and Fig. 1), restated in §3 on p. 9. There the prover verifies only the final (srs_i, Π_i) while the verifier also checks the intermediate proofs {Π_j}; §2.1 on p. 7 carries the party ∈ {P, V} input to SV that makes the two cases one algorithm. The paper also studies locating bad updates. §5 benchmarks BSV_P against BSV_V and does not itself state the separation, which is why this no longer points there. This exercise illustrates the evidence distinction; it does not transplant their algorithms or speedups into this lab’s Groth16 setup.</p>`;
  const select = host.querySelector<HTMLSelectElement>('#audit-case')!;
  const render = () => {
    const t = auditCase(select.value as AuditCase), r = auditTranscript(t);
    const result = host.querySelector('#audit-result')!;
    result.replaceChildren();
    for (const [label, value] of [['Final SRS consistency', r.finalConsistency], ['Update chain through final SRS', r.updateChain], ['Your exact contribution included', r.ownInclusion]]) {
      const p = document.createElement('p'); p.textContent = `${label}: ${value}`; result.append(p);
    }
    const receipt = ownReceipt();
    host.querySelector('#audit-transcript')!.textContent = `Final: [${t.final}]\nYour retained receipt: [${receipt.before}] → [${receipt.after}]\n${t.updates ? t.updates.map((u, i) => `${i + 1}. ${u.participant}: [${u.before}] × powers(${u.factor}) → [${u.after}]`).join('\n') : 'No update transcript available.'}${r.firstBadLink ? `\nFirst failed link: ${r.firstBadLink} (toy linear scan).` : r.updateChain === 'fail' ? '\nChain endpoint does not match final SRS.' : ''}`;
  };
  select.addEventListener('change', render); render();
}
