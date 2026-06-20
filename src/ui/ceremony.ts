// Live powers-of-tau ceremony. Five participants each contribute a real secret
// factor in F_17; the combined secret is their product, and the public SRS
// element is g^τ. The lesson: τ stays unknown as long as ONE factor is deleted.

import { runCeremony, SCALAR_R, type CeremonyReport } from '../crypto/setup';

const N = 5;
let contributions = [3, 5, 2, 7, 4];
let deleted = [false, false, true, false, false]; // P3 honestly deletes by default

function randContribution(): number {
  // nonzero element of F_17
  return 1 + Math.floor(Math.random() * (SCALAR_R - 1));
}

function renderToggles(host: HTMLElement): void {
  host.innerHTML = contributions
    .map(
      (c, i) => `<label class="ptoggle"><input type="checkbox" data-p="${i}" ${deleted[i] ? 'checked' : ''} />
        P${i + 1} deletes waste <span class="ptoggle-c">τ${sub(i + 1)} = ${c}</span></label>`,
    )
    .join('');
  host.querySelectorAll<HTMLInputElement>('input[data-p]').forEach((box) => {
    box.addEventListener('change', () => {
      const idx = Number(box.dataset.p);
      deleted[idx] = box.checked;
    });
  });
}

function buildChain(host: HTMLElement): HTMLDivElement[] {
  host.innerHTML = '';
  host.setAttribute('role', 'group');
  host.setAttribute('aria-label', 'Ceremony participants');
  const nodes: HTMLDivElement[] = [];
  for (let i = 0; i < N; i += 1) {
    const node = document.createElement('div');
    node.className = 'chain-node';
    node.innerHTML = `<div class="cn-p">P${i + 1}</div><div class="cn-state">waiting</div>`;
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', `Participant ${i + 1}: waiting`);
    host.appendChild(node);
    nodes.push(node);
  }
  return nodes;
}

function sub(n: number): string {
  return String(n).replace(/[0-9]/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]);
}

export function initCeremony(): void {
  const toggleHost = document.getElementById('ceremony-toggles');
  const chainHost = document.getElementById('ceremony-chain');
  const runBtn = document.getElementById('ceremony-run') as HTMLButtonElement | null;
  const randBtn = document.getElementById('ceremony-randomize') as HTMLButtonElement | null;
  const calc = document.getElementById('ceremony-calc');
  const verdict = document.getElementById('ceremony-verdict');
  if (!toggleHost || !chainHost || !runBtn || !calc || !verdict) return;

  let nodes = buildChain(chainHost);
  renderToggles(toggleHost);

  function reset(): void {
    nodes = buildChain(chainHost!);
    renderToggles(toggleHost!);
    calc!.innerHTML = '';
    verdict!.className = 'play-verdict';
    verdict!.textContent = '';
  }

  function animate(report: CeremonyReport): void {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    runBtn!.disabled = true;
    if (randBtn) randBtn.disabled = true;

    const settle = (i: number) => {
      const step = report.steps[i];
      const safe = step.deleted;
      const node = nodes[i];
      node.className = `chain-node ${safe ? 'safe' : 'bad'}`;
      node.innerHTML = `<div class="cn-p">P${i + 1}</div>
        <div class="cn-state">τ${sub(i + 1)} = ${step.contribution}</div>
        <div class="cn-run">τ→ ${step.runningTau}</div>
        <div class="cn-waste">${safe ? '✓ deleted' : '✗ kept'}</div>`;
      node.setAttribute('aria-label', `Participant ${i + 1}: contributed ${step.contribution}, running secret ${step.runningTau}, waste ${safe ? 'deleted' : 'kept'}`);
    };

    if (reduceMotion) {
      report.steps.forEach((_, i) => settle(i));
      finish(report);
      return;
    }

    report.steps.forEach((_, i) => {
      setTimeout(() => {
        nodes[i].className = 'chain-node active';
        nodes[i].querySelector('.cn-state')!.textContent = 'contributing…';
        setTimeout(() => {
          settle(i);
          if (i === N - 1) finish(report);
        }, 240);
      }, i * 460);
    });
  }

  function finish(report: CeremonyReport): void {
    runBtn!.disabled = false;
    if (randBtn) randBtn.disabled = false;
    const product = report.steps.map((s) => s.contribution).join(' · ');
    calc!.innerHTML = `<div class="calc-line">Combined secret: τ = ${product} mod ${SCALAR_R} = <strong>${report.finalTau}</strong></div>
      <div class="calc-line">Public SRS element: g<sup>τ</sup> = <strong>${report.steps[N - 1].runningElement}</strong> (mod 103)</div>`;
    if (report.secure) {
      const honest = report.steps.filter((s) => s.deleted).map((s) => `P${s.index + 1}`).join(', ');
      verdict!.className = 'play-verdict pv-ok';
      verdict!.innerHTML = `<strong>✓ Secure.</strong> ${honest} deleted their factor, so no one knows all of τ. The combined secret is unrecoverable even though g<sup>τ</sup> is public — that is the discrete-log wall. <span class="muted">(We can print τ = ${report.finalTau} only because this toy group is tiny.)</span>`;
    } else {
      verdict!.className = 'play-verdict pv-bad';
      verdict!.innerHTML = `<strong>✗ Compromised.</strong> Every participant kept their factor, so anyone colluding can reconstruct τ = ${report.finalTau}. With τ in hand, soundness is broken — see the forgery demo below.`;
    }
  }

  runBtn.addEventListener('click', () => {
    nodes = buildChain(chainHost!);
    animate(runCeremony(contributions, deleted));
  });

  randBtn?.addEventListener('click', () => {
    contributions = Array.from({ length: N }, randContribution);
    deleted = [false, false, true, false, false];
    reset();
  });
}
