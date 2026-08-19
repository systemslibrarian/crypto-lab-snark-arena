import { initPlayground } from './ui/playground';
import { initRealProof } from './ui/realproof';
import { initCeremony } from './ui/ceremony';
import { initKzg } from './ui/kzg';
import { initQuiz } from './ui/quiz';
import { initNav } from './ui/nav';
import { runCeremony, SCALAR_R } from './crypto/setup';

// Dark is the only theme. index.html's boot script pins data-theme with a
// literal before first paint and overwrites any stored preference, so there is
// nothing here to set, read, or offer a way to change.

function hexBytes(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function showProofHexes() {
  const grothHex = `${hexBytes(16)}...${hexBytes(16)}`;
  const plonkHex = `${hexBytes(24)}...${hexBytes(24)}`;

  const grothTargets = ['groth16-proof-hex', 'head-groth16'];
  const plonkTargets = ['plonk-proof-hex', 'head-plonk'];

  for (const id of grothTargets) {
    const node = document.getElementById(id);
    if (node) node.textContent = grothHex;
  }

  for (const id of plonkTargets) {
    const node = document.getElementById(id);
    if (node) node.textContent = plonkHex;
  }
}

// NOTE: Exhibits 02 and 03 used to carry "Verify proof" buttons that printed
// "✓ Verified (simulated verifier path, N ms)" with N = Math.random(). No proof
// object existed in either panel, so nothing was verified and nothing was timed.
// Both buttons are gone. The comparison figures those panels quote are now
// labelled as published benchmark numbers, and the only verification affordance
// on the page is the featured panel, which runs snarkjs against real artifacts
// and prints whatever groth16.verify actually returned.

// The Groth16 ceremony animation in Exhibit 02. The safe/compromised outcome is
// computed by runCeremony() from per-participant deletion draws, not asserted.
function buildChain(containerId: string) {
  const container = document.getElementById(containerId);
  if (!container) {
    return [] as HTMLDivElement[];
  }
  container.innerHTML = '';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Ceremony participants');
  const nodes: HTMLDivElement[] = [];
  for (let i = 0; i < 5; i += 1) {
    const node = document.createElement('div');
    node.className = 'chain-node';
    node.textContent = `P${i + 1}`;
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', `Participant ${i + 1}: waiting`);
    container.appendChild(node);
    nodes.push(node);
  }
  return nodes;
}

function animateChain(
  nodes: HTMLDivElement[],
  statuses: Array<'safe' | 'bad'>,
  labels: string[],
  buttons: HTMLElement[],
  onDone: () => void,
) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  buttons.forEach((b) => {
    if (b instanceof HTMLButtonElement) b.disabled = true;
  });
  nodes.forEach((n, i) => {
    n.className = 'chain-node';
    n.textContent = `P${i + 1}`;
  });

  const settle = (idx: number) => {
    const n = nodes[idx];
    n.className = `chain-node ${statuses[idx]}`;
    n.textContent = labels[idx];
    n.setAttribute('aria-label', `Participant ${idx + 1}: ${labels[idx]}`);
    if (idx === nodes.length - 1) {
      buttons.forEach((b) => { if (b instanceof HTMLButtonElement) b.disabled = false; });
      onDone();
    }
  };

  if (reduceMotion) {
    nodes.forEach((_, idx) => settle(idx));
    return;
  }

  nodes.forEach((n, idx) => {
    setTimeout(() => {
      n.className = `chain-node active`;
      n.textContent = `P${idx + 1} contributing...`;
      n.setAttribute('aria-label', `Participant ${idx + 1}: contributing`);
      setTimeout(() => settle(idx), 250);
    }, idx * 500);
  });
}

function bindLegacyCeremony() {
  const grothNodes = buildChain('groth16-chain');
  const grothRun = document.getElementById('groth16-chain-run');
  const grothStatus = document.getElementById('groth16-chain-status');

  grothRun?.addEventListener('click', () => {
    // Draw a real contribution and an independent honesty coin for each
    // participant, then let runCeremony() decide the outcome. Every run of five
    // dishonest participants (1 in 32) genuinely reports a compromised ceremony,
    // which is what makes "at least one honest participant" a claim and not a
    // decoration.
    const contributions = grothNodes.map(() => 1 + Math.floor(Math.random() * (SCALAR_R - 1)));
    const deletedFlags = grothNodes.map(() => Math.random() < 0.75);
    const report = runCeremony(contributions, deletedFlags);

    const statuses: Array<'safe' | 'bad'> = report.steps.map((s) => (s.deleted ? 'safe' : 'bad'));
    const labels = report.steps.map(
      (s) => `P${s.index + 1} ${s.deleted ? '✓ deleted waste' : '✗ kept waste'}`,
    );
    if (grothStatus) grothStatus.textContent = 'Running ceremony…';
    const btns = [grothRun].filter(Boolean) as HTMLElement[];
    animateChain(grothNodes, statuses, labels, btns, () => {
      if (!grothStatus) return;
      const honest = report.steps.filter((s) => s.deleted).length;
      grothStatus.textContent = report.secure
        ? `Secure: ${honest} of ${report.steps.length} participants destroyed their toxic waste, so the combined τ is unrecoverable. Ceremony is safe.`
        : `Compromised: all ${report.steps.length} participants kept their factor, so colluding they can reconstruct τ = ${report.finalTau}. Soundness is broken — run it again.`;
    });
  });
}

function init() {
  initNav();
  showProofHexes();
  bindLegacyCeremony();
  initPlayground();
  initRealProof();
  initCeremony();
  initKzg();
  initQuiz();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
