function initThemeToggle() {
  const root = document.documentElement;
  const header = document.querySelector('.site-header');
  if (!header) {
    return;
  }

  const button = document.createElement('button');
  button.className = 'theme-toggle';
  button.type = 'button';

  function applyButtonState() {
    const current = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const isDark = current === 'dark';
    button.textContent = isDark ? '🌙' : '☀️';
    button.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  }

  button.addEventListener('click', () => {
    const current = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    applyButtonState();
  });

  header.appendChild(button);
  applyButtonState();
}

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

function bindVerificationButtons() {
  const grothBtn = document.getElementById('groth16-verify');
  const grothResult = document.getElementById('groth16-result');
  const grothTime = document.getElementById('groth16-time');

  grothBtn?.addEventListener('click', () => {
    const ms = (1 + Math.random()).toFixed(2);
    if (grothTime) grothTime.textContent = `${ms} ms`;
    if (grothResult) grothResult.textContent = `✓ Verified (simulated verifier path, ${ms} ms)`;
  });

  const plonkBtn = document.getElementById('plonk-verify');
  const plonkResult = document.getElementById('plonk-result');
  const plonkTime = document.getElementById('plonk-time');

  plonkBtn?.addEventListener('click', () => {
    const ms = (3 + Math.random() * 2).toFixed(2);
    if (plonkTime) plonkTime.textContent = `${ms} ms`;
    if (plonkResult) plonkResult.textContent = `✓ Verified (simulated verifier path, ${ms} ms)`;
  });
}

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
  buttons.forEach((b) => {
    if (b instanceof HTMLButtonElement) b.disabled = true;
  });
  nodes.forEach((n, i) => {
    n.className = 'chain-node';
    n.textContent = `P${i + 1}`;
  });
  nodes.forEach((n, idx) => {
    setTimeout(() => {
      n.className = `chain-node active`;
      n.textContent = `P${idx + 1} contributing...`;
      n.setAttribute('aria-label', `Participant ${idx + 1}: contributing`);
      setTimeout(() => {
        n.className = `chain-node ${statuses[idx]}`;
        n.textContent = labels[idx];
        n.setAttribute('aria-label', `Participant ${idx + 1}: ${labels[idx]}`);
        if (idx === nodes.length - 1) {
          buttons.forEach((b) => {
            if (b instanceof HTMLButtonElement) b.disabled = false;
          });
          onDone();
        }
      }, 250);
    }, idx * 500);
  });
}

function bindCeremonyVisualizers() {
  const grothNodes = buildChain('groth16-chain');
  const grothRun = document.getElementById('groth16-chain-run');
  const grothStatus = document.getElementById('groth16-chain-status');

  grothRun?.addEventListener('click', () => {
    const statuses: Array<'safe' | 'bad'> = grothNodes.map((_, i) => (i < 4 ? 'safe' : 'bad'));
    const labels = grothNodes.map((_, i) => (i < 4 ? `P${i + 1} ✓ deleted waste` : `P${i + 1} kept waste`));
    if (grothStatus) grothStatus.textContent = 'Running ceremony…';
    const btns = [grothRun].filter(Boolean) as HTMLElement[];
    animateChain(grothNodes, statuses, labels, btns, () => {
      if (grothStatus) grothStatus.textContent = 'Secure: at least one honest participant destroyed toxic waste. Ceremony is safe.';
    });
  });

  const setupNodes = buildChain('setup-chain');
  const setupRun = document.getElementById('setup-run');
  const setupBreak = document.getElementById('setup-break');
  const setupResult = document.getElementById('setup-result');

  const setupBtns = [setupRun, setupBreak].filter(Boolean) as HTMLElement[];

  setupRun?.addEventListener('click', () => {
    const statuses: Array<'safe' | 'bad'> = setupNodes.map((_, i) => (i === 1 ? 'bad' : 'safe'));
    const labels = setupNodes.map((_, i) => (i === 1 ? `P${i + 1} ✗ cheating` : `P${i + 1} ✓ honest`));
    if (setupResult) setupResult.textContent = 'Running ceremony…';
    animateChain(setupNodes, statuses, labels, setupBtns, () => {
      if (setupResult) setupResult.textContent = 'Result: ceremony remains secure — the cheater cannot extract honest participants\' randomness from the final SRS.';
    });
  });

  setupBreak?.addEventListener('click', () => {
    const statuses: Array<'safe' | 'bad'> = setupNodes.map(() => 'bad');
    const labels = setupNodes.map((_, i) => `P${i + 1} ✗ retained waste`);
    if (setupResult) setupResult.textContent = 'Running ceremony…';
    animateChain(setupNodes, statuses, labels, setupBtns, () => {
      if (setupResult) setupResult.textContent = 'Result: catastrophic compromise — all participants retained toxic waste. Soundness is broken; fake proofs can be created.';
    });
  });
}

function init() {
  initThemeToggle();
  showProofHexes();
  bindVerificationButtons();
  bindCeremonyVisualizers();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
