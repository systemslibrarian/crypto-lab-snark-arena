// Real, in-browser Groth16 proving and verification via snarkjs. This is NOT
// simulated: it generates a genuine BN254 proof for the SAME circuit as the
// transparent playground (x^3 + x + 5 = out), using artifacts produced by a
// real trusted-setup ceremony at build time. Every file is static, served
// from /zk/ — which is exactly why this works on GitHub Pages with no backend.

const BASE = import.meta.env.BASE_URL; // e.g. "/crypto-lab-snark-arena/"
const WASM = `${BASE}zk/cubic.wasm`;
const ZKEY = `${BASE}zk/cubic_final.zkey`;
const VKEY_URL = `${BASE}zk/verification_key.json`;
const SNARKJS_URL = `${BASE}vendor/snarkjs.min.js`;

// Groth16 on BN254: A (G1, 2×32B) + B (G2, 4×32B) + C (G1, 2×32B) = 256 bytes
// uncompressed; 128 bytes compressed. Constant regardless of circuit size.
const PROOF_BYTES = 256;

interface ProofState { proof: any; publicSignals: string[]; }

let vkey: any = null;
let last: ProofState | null = null;
let snarkjsPromise: Promise<any> | null = null;

/** Lazily load the vendored snarkjs UMD bundle (sets window.snarkjs). */
function loadSnarkjs(): Promise<any> {
  const w = window as unknown as { snarkjs?: any };
  if (w.snarkjs) return Promise.resolve(w.snarkjs);
  if (snarkjsPromise) return snarkjsPromise;
  snarkjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SNARKJS_URL;
    s.async = true;
    s.onload = () => (w.snarkjs ? resolve(w.snarkjs) : reject(new Error('snarkjs global missing')));
    s.onerror = () => reject(new Error('failed to load snarkjs'));
    document.head.appendChild(s);
  });
  return snarkjsPromise;
}

function setBusy(host: HTMLElement, msg: string): void {
  host.className = 'calc-box';
  host.innerHTML = `<div class="calc-line">${msg}<span class="rp-spinner" aria-hidden="true"></span></div>`;
}

function trunc(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(trunc).join(', ')}]`;
  const s = String(v);
  return s.length > 18 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s;
}

function fmtPt(coords: unknown[]): string {
  // Truncated big-integer coordinates of a curve point (G1 flat, G2 nested).
  return `<div class="rp-pt">${coords.map((c) => trunc(c)).join('<br>')}</div>`;
}

export function initRealProof(): void {
  const panel = document.getElementById('realproof');
  if (!panel) return;

  const xInput = document.getElementById('rp-x') as HTMLInputElement | null;
  const xVal = document.getElementById('rp-x-val');
  const proveBtn = document.getElementById('rp-prove') as HTMLButtonElement | null;
  const verifyBtn = document.getElementById('rp-verify') as HTMLButtonElement | null;
  const tamperBtn = document.getElementById('rp-tamper') as HTMLButtonElement | null;
  const out = document.getElementById('rp-out');
  if (!xInput || !proveBtn || !verifyBtn || !tamperBtn || !out) return;

  const syncX = () => { if (xVal) xVal.textContent = xInput.value; };
  xInput.addEventListener('input', syncX);
  syncX();

  const lockVerify = (disabled: boolean) => { verifyBtn.disabled = disabled; tamperBtn.disabled = disabled; };
  lockVerify(true);

  proveBtn.addEventListener('click', async () => {
    const x = Number(xInput.value);
    proveBtn.disabled = true;
    lockVerify(true);
    setBusy(out, `Loading snarkjs and generating a real Groth16 proof for x = ${x}… `);
    try {
      const snarkjs = await loadSnarkjs();
      const t0 = performance.now();
      const { proof, publicSignals } = await snarkjs.groth16.fullProve({ x }, WASM, ZKEY);
      const ms = (performance.now() - t0).toFixed(0);
      if (!Array.isArray(proof?.pi_a) || !Array.isArray(proof?.pi_b) || !Array.isArray(proof?.pi_c)) {
        throw new Error('unexpected proof shape');
      }
      last = { proof, publicSignals };
      out.className = 'calc-box cb-ok';
      out.innerHTML = `
        <div class="calc-line"><strong>Proof generated in ${ms} ms</strong> — a genuine Groth16 proof on BN254.</div>
        <div class="calc-line">Public output the proof commits to: <strong>out = ${publicSignals[0]}</strong> &nbsp;<span class="muted">(x stays secret)</span></div>
        <div class="calc-line">Proof size: <strong>${PROOF_BYTES} bytes</strong> (A, B, C group elements), independent of circuit size.</div>
        <div class="rp-proof"><div class="muted">proof.A (G1):</div>${fmtPt(proof.pi_a)}<div class="muted">proof.B (G2):</div>${fmtPt(proof.pi_b)}<div class="muted">proof.C (G1):</div>${fmtPt(proof.pi_c)}</div>
        <div class="calc-line">Now verify it against the verification key — or tamper with the public output and watch it fail.</div>`;
      lockVerify(false);
    } catch (err) {
      out.className = 'calc-box cb-bad';
      out.innerHTML = `<div class="calc-line">Proving failed: ${String(err)}. If you are offline, the snarkjs library or artifacts could not load; the transparent-math panels still work.</div>`;
    } finally {
      proveBtn.disabled = false;
    }
  });

  async function ensureVkey(): Promise<any> {
    if (!vkey) vkey = await (await fetch(VKEY_URL)).json();
    return vkey;
  }

  verifyBtn.addEventListener('click', async () => {
    if (!last) return;
    const snap = last; // pin the proof in case a new Prove resolves mid-await
    lockVerify(true);
    setBusy(out, 'Verifying the proof against the verification key… ');
    try {
      const snarkjs = await loadSnarkjs();
      const vk = await ensureVkey();
      const ok = await snarkjs.groth16.verify(vk, snap.publicSignals, snap.proof);
      out.className = `calc-box ${ok ? 'cb-ok' : 'cb-bad'}`;
      out.innerHTML = `<div class="calc-verdict ${ok ? 'pv-ok' : 'pv-bad'}">${ok ? '✓' : '✗'} groth16.verify → ${ok}</div>
        <div class="calc-line">The verifier checked the pairing equation using only the public output (${snap.publicSignals[0]}), the proof, and the verification key. It never saw x.</div>`;
    } catch (err) {
      out.className = 'calc-box cb-bad';
      out.innerHTML = `<div class="calc-line">Verification error: ${String(err)}</div>`;
    } finally {
      lockVerify(false);
    }
  });

  tamperBtn.addEventListener('click', async () => {
    if (!last) return;
    const snap = last; // pin the proof in case a new Prove resolves mid-await
    lockVerify(true);
    const realOut = snap.publicSignals[0];
    const faked = String(BigInt(realOut) + 1n); // claim a false public output (big-int safe)
    setBusy(out, `Claiming a false public output (${faked} instead of ${realOut}) and re-verifying… `);
    try {
      const snarkjs = await loadSnarkjs();
      const vk = await ensureVkey();
      const ok = await snarkjs.groth16.verify(vk, [faked], snap.proof);
      out.className = 'calc-box cb-bad';
      out.innerHTML = `<div class="calc-verdict pv-bad">✗ groth16.verify → ${ok}</div>
        <div class="calc-line">We submitted the real proof but lied about the public output (${faked} ≠ ${realOut}). The pairing check fails — the proof is cryptographically bound to the true statement. (No toxic waste was leaked here, so the lie is rejected — contrast with the forgery demo in Exhibit 05.)</div>`;
    } catch (err) {
      out.className = 'calc-box cb-bad';
      out.innerHTML = `<div class="calc-line">Verification error: ${String(err)}</div>`;
    } finally {
      lockVerify(false);
    }
  });
}
