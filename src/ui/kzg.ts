// Live KZG forgery demo. Shows that an honest prover can only open a commitment
// to the true evaluation, while an attacker who kept the toxic-waste secret τ
// can open the same commitment to a lie — and the verifier accepts.

import { polyEval, polyToString, Field } from '../crypto/field';
import {
  powersOfTau, kzgCommit, kzgOpen, kzgVerify, forgeOpening,
  SCALAR_R, PAIRING_NOTE, type SrsElement, type CommitResult,
} from '../crypto/setup';

// A fixed demo polynomial and evaluation point over F_17, with a leaked τ.
const F = new Field(SCALAR_R);
const POLY = [2, 3, 1]; // f(x) = 2 + 3x + x^2
const Z = 4; // evaluation point
const TAU = 5; // the leaked toxic-waste secret
const Y_TRUE = polyEval(F, POLY, Z); // honest value f(4) = 13
const Y_LIE = 7; // the false value the attacker wants to "prove"

let srs: SrsElement[];
let commit: CommitResult;

function renderFacts(host: HTMLElement): void {
  host.innerHTML = `
    <div class="forge-fact"><span class="ff-k">Polynomial</span><span class="ff-v">f(x) = ${polyToString(POLY)}</span></div>
    <div class="forge-fact"><span class="ff-k">Evaluation point</span><span class="ff-v">z = ${Z}</span></div>
    <div class="forge-fact"><span class="ff-k">True value</span><span class="ff-v">f(${Z}) = ${Y_TRUE}</span></div>
    <div class="forge-fact"><span class="ff-k">Commitment C = g<sup>f(τ)</sup></span><span class="ff-v">${commit.element} (mod 103)</span></div>
    <div class="forge-fact forge-leak"><span class="ff-k">⚠ Leaked secret</span><span class="ff-v">τ = ${TAU}</span></div>`;
}

export function initKzg(): void {
  const factsHost = document.getElementById('forge-facts');
  const honestBtn = document.getElementById('forge-honest') as HTMLButtonElement | null;
  const lieBtn = document.getElementById('forge-lie') as HTMLButtonElement | null;
  const calc = document.getElementById('forge-calc');
  const polyTag = document.getElementById('forge-poly');
  if (!factsHost || !honestBtn || !lieBtn || !calc) return;

  srs = powersOfTau(TAU, POLY.length - 1);
  commit = kzgCommit(POLY, srs);
  if (polyTag) polyTag.textContent = `f(x) = ${polyToString(POLY)}`;
  renderFacts(factsHost);

  honestBtn.addEventListener('click', () => {
    const open = kzgOpen(POLY, Z, Y_TRUE, srs);
    const v = kzgVerify(commit.exp, Y_TRUE, open.proofExp, TAU, Z);
    calc.className = 'calc-box cb-ok';
    calc.innerHTML = `
      <div class="calc-line"><strong>Honest opening of f at z = ${Z} to y = ${Y_TRUE}</strong></div>
      <div class="calc-line">Quotient q(x) = (f(x) − ${Y_TRUE}) / (x − ${Z}) = ${polyToString(open.quotient)} &nbsp; <span class="muted">remainder ${open.remainder}</span></div>
      <div class="calc-line">Proof π = g<sup>q(τ)</sup> = g<sup>${open.proofExp}</sup> = ${open.proofElement} &nbsp;<span class="muted">(built from the SRS)</span></div>
      <div class="calc-line">Pairing check enforces: f(τ) − y = q(τ)·(τ − z) → ${v.lhs} = ${v.rhs}</div>
      <div class="calc-note">${PAIRING_NOTE}</div>
      <div class="calc-verdict pv-ok">✓ Accepted — the remainder is 0, so an honest proof exists and verifies.</div>`;
  });

  lieBtn.addEventListener('click', () => {
    const fg = forgeOpening(POLY, Z, Y_LIE, TAU, srs);
    calc.className = 'calc-box cb-bad';
    calc.innerHTML = `
      <div class="calc-line"><strong>Goal: prove the lie f(${Z}) = ${Y_LIE}</strong> &nbsp;<span class="muted">(really f(${Z}) = ${Y_TRUE})</span></div>
      <div class="calc-line"><span class="muted">Honest route —</span> q(x) = (f(x) − ${Y_LIE}) / (x − ${Z}) leaves <strong>remainder ${fg.honest.remainder} ≠ 0</strong>: not a polynomial, so it can't be built from the SRS. An honest prover is stuck. ✗</div>
      <div class="calc-line forge-leak-line"><span class="muted">Attacker route, knowing τ = ${TAU} —</span> divide in the exponent directly: π = g<sup>(f(τ) − ${Y_LIE})/(τ − ${Z})</sup> = g<sup>${fg.forgedProofExp}</sup> = ${fg.forgedProofElement}</div>
      <div class="calc-line">Pairing check: f(τ) − y = q(τ)·(τ − z) → ${fg.verify.lhs} = ${fg.verify.rhs}</div>
      <div class="calc-note">${PAIRING_NOTE}</div>
      <div class="calc-verdict pv-bad">✗ Soundness broken — the forged proof is <strong>accepted</strong>. The leaked τ let the attacker satisfy the verifier's equation for a false statement.</div>`;
  });
}
