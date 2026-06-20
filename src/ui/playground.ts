// Interactive R1CS circuit playground. Renders the live witness vector and the
// three constraint checks for x^3 + x + 5 = 35 as the user drags the secret x.

import { evaluateWitness, WIRES, PUBLIC_OUT, R1CS_PRIME, type WitnessReport } from '../crypto/r1cs';

const FORGED_V2 = 99; // an obviously-wrong intermediate wire for the cheat demo

function renderWitness(host: HTMLElement, report: WitnessReport, cheating: boolean): void {
  const cells = report.witness
    .map((val, i) => {
      const name = WIRES[i];
      const forged = cheating && name === 'v2';
      const pub = name === 'out';
      const cls = forged ? 'wv-cell wv-forged' : pub ? 'wv-cell wv-public' : 'wv-cell';
      const tag = pub ? '<span class="wv-tag">public</span>' : name === '1' ? '<span class="wv-tag">const</span>' : '<span class="wv-tag">secret</span>';
      return `<div class="${cls}"><span class="wv-name">${name}</span><span class="wv-val">${val}</span>${tag}</div>`;
    })
    .join('');
  host.innerHTML = `<div class="wv-label">Witness vector s (mod ${R1CS_PRIME}):</div><div class="wv-row">${cells}</div>`;
}

function renderConstraints(host: HTMLElement, report: WitnessReport): void {
  host.innerHTML = report.results
    .map((r) => {
      const ok = r.holds;
      const mark = ok ? '✓' : '✗';
      const product = (r.as * r.bs) % R1CS_PRIME;
      // Left side is the real product (A·s)(B·s); right side is the claimed C·s.
      const eval_ = ok ? `${r.as} · ${r.bs} = ${r.cs}` : `${r.as} · ${r.bs} = ${product} ≠ ${r.cs}`;
      return `<div class="cn-row ${ok ? 'cn-ok' : 'cn-bad'}" role="listitem">
        <span class="cn-mark" aria-hidden="true">${mark}</span>
        <span class="cn-label">${r.constraint.label}</span>
        <span class="cn-human">${r.constraint.human}</span>
        <span class="cn-eval">${eval_}</span>
      </div>`;
    })
    .join('');
}

function renderVerdict(host: HTMLElement, report: WitnessReport, cheating: boolean): void {
  if (report.satisfied) {
    host.className = 'play-verdict pv-ok';
    host.innerHTML = `<strong>✓ Valid witness.</strong> Every constraint holds and the output wire equals the public statement (${PUBLIC_OUT}). A SNARK over this circuit would prove you know x — without revealing that x = ${report.x}.`;
    return;
  }
  const failed = report.results.find((r) => !r.holds)!;
  host.className = 'play-verdict pv-bad';
  if (cheating) {
    host.innerHTML = `<strong>✗ Caught cheating.</strong> Forcing v2 = ${FORGED_V2} breaks constraint <strong>${failed.constraint.label}</strong> (${failed.constraint.human}). A multiplication gate can't be faked — the prover is rejected.`;
    return;
  }
  host.innerHTML = `<strong>✗ Not a satisfying witness.</strong> The multiplication wires are consistent, but x = ${report.x} gives x³ + x + 5 = ${report.computedOut}, so constraint <strong>${failed.constraint.label}</strong> can't equal the public output ${PUBLIC_OUT}. Only x = 3 works.`;
}

export function initPlayground(): void {
  const slider = document.getElementById('play-x') as HTMLInputElement | null;
  const xVal = document.getElementById('play-x-val');
  const witnessHost = document.getElementById('play-witness');
  const constraintHost = document.getElementById('play-constraints');
  const verdictHost = document.getElementById('play-verdict');
  const cheatBtn = document.getElementById('play-cheat') as HTMLButtonElement | null;
  const resetBtn = document.getElementById('play-reset') as HTMLButtonElement | null;
  const cheatNote = document.getElementById('play-cheat-note');
  if (!slider || !witnessHost || !constraintHost || !verdictHost) return;

  let cheating = false;

  function update(): void {
    const x = Number(slider!.value);
    if (xVal) xVal.textContent = String(x);
    const report = evaluateWitness(x, cheating ? FORGED_V2 : undefined);
    renderWitness(witnessHost!, report, cheating);
    renderConstraints(constraintHost!, report);
    renderVerdict(verdictHost!, report, cheating);
  }

  slider.addEventListener('input', () => {
    if (cheating) {
      // Leaving cheat mode when the user starts exploring honestly again.
      cheating = false;
      toggleCheatUI();
    }
    update();
  });

  function toggleCheatUI(): void {
    if (cheatBtn) cheatBtn.hidden = cheating;
    if (resetBtn) resetBtn.hidden = !cheating;
    if (cheatNote) {
      cheatNote.textContent = cheating
        ? 'The v2 wire is forged. Notice a multiplication constraint now fails — soundness in action.'
        : '';
    }
  }

  cheatBtn?.addEventListener('click', () => { cheating = true; toggleCheatUI(); update(); });
  resetBtn?.addEventListener('click', () => { cheating = false; toggleCheatUI(); update(); });

  update();
}
