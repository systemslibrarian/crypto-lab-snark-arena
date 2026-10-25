import {
  decodeXorPublicSignals,
  expectedXorPublicSignals,
  intendedXor,
  isBit,
  xorPolynomial,
} from '../crypto/constraint-gap';
import { artifactUrl, loadSnarkjs } from './snarkjs';

const WEAK_WASM = artifactUrl('xor_weak.wasm');
const WEAK_ZKEY = artifactUrl('xor_weak_final.zkey');
const WEAK_VKEY = artifactUrl('xor_weak_verification_key.json');
const REPAIRED_WASM = artifactUrl('xor_repaired.wasm');
const REPAIRED_ZKEY = artifactUrl('xor_repaired_final.zkey');
const REPAIRED_VKEY = artifactUrl('xor_repaired_verification_key.json');

interface ProofState {
  proof: any;
  publicSignals: string[];
}

let weakVerificationKey: any = null;
let repairedVerificationKey: any = null;

async function fetchVerificationKey(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`verification-key request failed (${response.status})`);
  return response.json();
}

async function getWeakVerificationKey(): Promise<any> {
  weakVerificationKey ??= await fetchVerificationKey(WEAK_VKEY);
  return weakVerificationKey;
}

async function getRepairedVerificationKey(): Promise<any> {
  repairedVerificationKey ??= await fetchVerificationKey(REPAIRED_VKEY);
  return repairedVerificationKey;
}

function setBusy(host: HTMLElement, message: string): void {
  host.className = 'calc-box';
  host.removeAttribute('data-result');
  host.innerHTML = `<div class="calc-line">${message}<span class="rp-spinner" aria-hidden="true"></span></div>`;
}

function assertExpectedSignals(signals: unknown, a: bigint, b: bigint): string[] {
  const decoded = decodeXorPublicSignals(signals);
  const expected = expectedXorPublicSignals(a, b);
  if (!decoded || !Array.isArray(signals) || signals.some((value, index) => String(value) !== expected[index])) {
    throw new Error('backend returned public signals that do not match out, a, b');
  }
  return expected;
}

function expectedConstraintFailure(error: unknown): boolean {
  const message = String(error);
  return message.includes('Assert Failed') && message.includes('XorRepaired');
}

function applicationText(a: bigint, b: bigint): string {
  const intended = intendedXor(a, b);
  if (intended === null) {
    return `<strong>Intended computation: REJECT</strong> — ${a}, ${b} are not both bits, so the application defines no XOR output: <span class="mono-inline">D<sub>P</sub>(out | a=${a}, b=${b}) = ∅</span>. This browser check documents the contract; it is <strong>not</strong> the circuit repair.`;
  }
  return `<strong>Intended computation: ACCEPT</strong> — binary XOR(${a}, ${b}) = ${intended}. Both proof relations should accept this legitimate assignment.`;
}

export function initConstraintGap(): void {
  const panel = document.getElementById('constraint-gap');
  if (!panel) return;

  const aInput = document.getElementById('cw-a') as HTMLSelectElement | null;
  const bInput = document.getElementById('cw-b') as HTMLSelectElement | null;
  const runButton = document.getElementById('cw-run') as HTMLButtonElement | null;
  const tamperButton = document.getElementById('cw-tamper') as HTMLButtonElement | null;
  const contract = document.getElementById('cw-contract');
  const weakOut = document.getElementById('cw-weak-out');
  const repairedOut = document.getElementById('cw-repaired-out');
  const tamperOut = document.getElementById('cw-tamper-out');
  if (!aInput || !bInput || !runButton || !tamperButton || !contract || !weakOut || !repairedOut || !tamperOut) return;

  let evidenceVersion = 0;
  let lastWeak: ProofState | null = null;

  const selected = (): [bigint, bigint] => [BigInt(aInput.value), BigInt(bInput.value)];

  const renderContract = () => {
    const [a, b] = selected();
    contract.className = `play-verdict ${isBit(a) && isBit(b) ? 'pv-ok' : 'pv-bad'}`;
    contract.innerHTML = applicationText(a, b);
  };

  const retireEvidence = () => {
    evidenceVersion += 1;
    lastWeak = null;
    tamperButton.disabled = true;
    for (const output of [weakOut, repairedOut]) {
      output.className = 'calc-box';
      output.removeAttribute('data-result');
      output.innerHTML = '<div class="calc-line">Inputs changed. Run both relations again; earlier evidence has been retired.</div>';
    }
    tamperOut.className = 'calc-box';
    tamperOut.removeAttribute('data-result');
    tamperOut.innerHTML = '';
    renderContract();
  };

  aInput.addEventListener('change', retireEvidence);
  bInput.addEventListener('change', retireEvidence);
  renderContract();
  tamperButton.disabled = true;

  runButton.addEventListener('click', async () => {
    const [a, b] = selected();
    const intended = intendedXor(a, b);
    const requestVersion = ++evidenceVersion;
    lastWeak = null;
    runButton.disabled = true;
    tamperButton.disabled = true;
    tamperOut.innerHTML = '';
    tamperOut.removeAttribute('data-result');
    setBusy(weakOut, 'Generating and verifying an unmodified proof for the weak relation… ');
    setBusy(repairedOut, 'Testing the same assignment against the repaired relation… ');

    try {
      const snarkjs = await loadSnarkjs();
      const weakKey = await getWeakVerificationKey();
      const weak = await snarkjs.groth16.fullProve({ a: String(a), b: String(b) }, WEAK_WASM, WEAK_ZKEY);
      const weakSignals = assertExpectedSignals(weak.publicSignals, a, b);
      const weakVerified = await snarkjs.groth16.verify(weakKey, weakSignals, weak.proof);
      if (requestVersion !== evidenceVersion) return;
      if (weakVerified !== true) throw new Error('weak proof did not verify');

      lastWeak = { proof: weak.proof, publicSignals: weakSignals };
      const weakOutValue = xorPolynomial(a, b);
      const integerOut = a + b - 2n * a * b;
      const phantom = intended === null;
      weakOut.className = `calc-box ${phantom ? 'cb-bad' : 'cb-ok'}`;
      weakOut.dataset.result = phantom ? 'weak-accepted-phantom' : 'weak-accepted-legitimate';
      weakOut.innerHTML = `
        <div class="calc-verdict ${phantom ? 'pv-bad' : 'pv-ok'}">groth16.verify → true</div>
        <div class="calc-line">Actual public signals: <span class="mono-inline">[out, a, b] = [${weakSignals.join(', ')}]</span>.</div>
        <div class="calc-line">The weak relation checks only <span class="mono-inline">out = a + b − 2ab</span>. For this run, the integer expression is <strong>${integerOut}</strong> and its BN254 scalar-field residue is <strong>${weakOutValue}</strong>.</div>
        <div class="calc-line">${phantom ? '<strong>Accepted phantom output:</strong> the proof is genuine and unmodified, but the encoded relation omitted the binary-input condition.' : '<strong>Legitimate assignment:</strong> the intended binary computation and weak relation agree.'}</div>`;
      tamperButton.disabled = false;

      const repairedKey = await getRepairedVerificationKey();
      try {
        const repaired = await snarkjs.groth16.fullProve(
          { a: String(a), b: String(b) },
          REPAIRED_WASM,
          REPAIRED_ZKEY,
        );
        const repairedSignals = assertExpectedSignals(repaired.publicSignals, a, b);
        const repairedVerified = await snarkjs.groth16.verify(repairedKey, repairedSignals, repaired.proof);
        if (requestVersion !== evidenceVersion) return;

        const expectedAcceptance = intended !== null;
        const correct = expectedAcceptance && repairedVerified === true;
        repairedOut.className = `calc-box ${correct ? 'cb-ok' : 'cb-bad'}`;
        repairedOut.dataset.result = correct ? 'repaired-accepted-legitimate' : 'repaired-unexpected-acceptance';
        repairedOut.innerHTML = `
          <div class="calc-verdict ${correct ? 'pv-ok' : 'pv-bad'}">groth16.verify → ${repairedVerified}</div>
          <div class="calc-line">Actual public signals: <span class="mono-inline">[out, a, b] = [${repairedSignals.join(', ')}]</span>.</div>
          <div class="calc-line">${correct ? '<strong>Legitimate assignment accepted.</strong> The repaired relation preserves valid binary XOR witnesses.' : '<strong>Unexpected result:</strong> the repaired backend produced a proof for a non-binary assignment. This is a failed security check, not a success.'}</div>`;
      } catch (error) {
        if (requestVersion !== evidenceVersion) return;
        if (intended === null && expectedConstraintFailure(error)) {
          repairedOut.className = 'calc-box cb-ok';
          repairedOut.dataset.result = 'repaired-rejected-phantom';
          repairedOut.innerHTML = `
            <div class="calc-verdict pv-ok">No proof produced — repaired constraints rejected the assignment</div>
            <div class="calc-line">The circuit itself enforces <span class="mono-inline">a(a−1)=0</span> and <span class="mono-inline">b(b−1)=0</span>. The same (2, 2, −4) assignment fails during real witness/constraint evaluation, before Groth16 has a proof to verify.</div>
            <div class="calc-line"><strong>This is the repair.</strong> Blocking 2 in the browser alone would not change what a direct prover can prove.</div>`;
        } else {
          repairedOut.className = 'calc-box cb-bad';
          repairedOut.dataset.result = 'repaired-backend-error';
          repairedOut.innerHTML = '<div class="calc-line"><strong>Backend error:</strong> no security conclusion was drawn because this was not the repaired circuit’s expected constraint failure.</div>';
        }
      }
    } catch {
      if (requestVersion !== evidenceVersion) return;
      weakOut.className = 'calc-box cb-bad';
      weakOut.dataset.result = 'weak-backend-error';
      weakOut.innerHTML = '<div class="calc-line"><strong>Backend error:</strong> proving or verification did not complete, so the lab makes no acceptance claim for this run.</div>';
      repairedOut.className = 'calc-box cb-bad';
      repairedOut.dataset.result = 'repaired-not-run';
      repairedOut.innerHTML = '<div class="calc-line">The comparison stopped because the weak-backend prerequisite failed.</div>';
    } finally {
      runButton.disabled = false;
      if (requestVersion !== evidenceVersion) tamperButton.disabled = true;
    }
  });

  tamperButton.addEventListener('click', async () => {
    if (!lastWeak) return;
    const snapshot = lastWeak;
    const requestVersion = evidenceVersion;
    tamperButton.disabled = true;
    setBusy(tamperOut, 'Swapping the proof’s A and C group elements, then re-verifying… ');
    try {
      const snarkjs = await loadSnarkjs();
      const key = await getWeakVerificationKey();
      const tampered = structuredClone(snapshot.proof);
      [tampered.pi_a, tampered.pi_c] = [tampered.pi_c, tampered.pi_a];
      const verified = await snarkjs.groth16.verify(key, snapshot.publicSignals, tampered);
      if (requestVersion !== evidenceVersion) return;
      tamperOut.className = `calc-box ${verified ? 'cb-bad' : 'cb-ok'}`;
      tamperOut.dataset.result = verified ? 'tampered-unexpected-acceptance' : 'tampered-rejected';
      tamperOut.innerHTML = `
        <div class="calc-verdict ${verified ? 'pv-bad' : 'pv-ok'}">groth16.verify → ${verified}</div>
        <div class="calc-line">The public statement stayed fixed, but two serialized proof elements were swapped. ${verified ? '<strong>Unexpected acceptance:</strong> this security check failed.' : '<strong>Ordinary proof tampering was rejected.</strong>'}</div>
        <div class="calc-line">That rejection is different from the weak relation’s phantom output: the unintended-witness proof above is unmodified and verifies because it satisfies the relation that was actually encoded.</div>`;
    } catch {
      if (requestVersion !== evidenceVersion) return;
      tamperOut.className = 'calc-box cb-bad';
      tamperOut.dataset.result = 'tampered-backend-error';
      tamperOut.innerHTML = `
        <div class="calc-verdict pv-bad">Verification backend error</div>
        <div class="calc-line">No true/false verdict was returned, so this run makes no proof-tampering claim. Retry the control; an operational error is not cryptographic rejection.</div>`;
    } finally {
      tamperButton.disabled = requestVersion !== evidenceVersion || lastWeak !== snapshot;
    }
  });
}
