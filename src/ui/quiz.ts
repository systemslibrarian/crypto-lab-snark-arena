// Self-check quiz. Multiple choice, instant feedback with explanations, and a
// running tally. Nothing is stored — purely for the learner's own reinforcement.

interface Question {
  q: string;
  options: string[];
  answer: number;
  explain: string;
}

const QUESTIONS: Question[] = [
  {
    q: 'In the circuit x³ + x + 5 = 35, what is the "witness"?',
    options: ['The public output 35', 'The secret value x the prover knows', 'The verification key', 'The proof bytes'],
    answer: 1,
    explain: 'The witness is the secret input (x). A valid witness makes every constraint hold against the public statement.',
  },
  {
    q: 'Why is a single-party trusted setup considered equivalent to no trust at all?',
    options: [
      'It is too slow to compute',
      'That one party knows τ and can forge proofs for false statements',
      'It produces larger proofs',
      'It cannot be verified on-chain',
    ],
    answer: 1,
    explain: 'With one party, that party holds the full toxic-waste secret τ. The ceremony is only safe if at least one of many participants deletes their factor.',
  },
  {
    q: 'What does Groth16 trade away to get the smallest proofs and fastest verification?',
    options: [
      'Zero-knowledge',
      'Completeness',
      'A universal setup — it needs a fresh ceremony per circuit',
      'Finite-field arithmetic',
    ],
    answer: 2,
    explain: 'Groth16 is per-circuit: every new circuit needs its own phase-2 ceremony. PLONK uses one universal setup at the cost of slightly larger proofs.',
  },
  {
    q: 'In the forgery demo, why can an honest prover NOT open the commitment to a false value?',
    options: [
      'The proof would be too large',
      'The quotient (f(x) − y)/(x − z) has a nonzero remainder, so it is not a polynomial buildable from the SRS',
      'The verifier rejects all openings',
      'The field is too small',
    ],
    answer: 1,
    explain: 'A genuine opening needs (f − y) to be divisible by (x − z), which only happens when y = f(z). For a lie the remainder is nonzero, so no SRS combination yields the proof — unless you know τ and divide in the exponent directly.',
  },
  {
    q: 'Neither Groth16 nor PLONK is post-quantum secure. Why?',
    options: [
      'They use hash functions',
      'They rely on pairing-based (discrete-log) assumptions a quantum computer could break',
      'Their proofs are too small',
      'They require interaction',
    ],
    answer: 1,
    explain: 'Both rest on elliptic-curve pairing assumptions, which Shor-style quantum attacks defeat. STARKs, which rely only on hashes, are the post-quantum alternative.',
  },
];

export function initQuiz(): void {
  const root = document.getElementById('quiz-root');
  const scoreHost = document.getElementById('quiz-score');
  if (!root) return;

  const answered = new Array<boolean>(QUESTIONS.length).fill(false);
  let correct = 0;

  function updateScore(): void {
    if (!scoreHost) return;
    const done = answered.filter(Boolean).length;
    if (done === 0) { scoreHost.textContent = ''; scoreHost.className = 'play-verdict'; return; }
    scoreHost.className = 'play-verdict pv-ok';
    scoreHost.innerHTML = done === QUESTIONS.length
      ? `<strong>Done — ${correct} / ${QUESTIONS.length} on the first try.</strong> Re-read any exhibit whose question tripped you up; the answers are all there.`
      : `Progress: ${done} / ${QUESTIONS.length} answered · ${correct} correct so far.`;
  }

  root.innerHTML = QUESTIONS.map((item, qi) => {
    const opts = item.options
      .map((opt, oi) => `<button class="quiz-opt" data-q="${qi}" data-o="${oi}" type="button">${opt}</button>`)
      .join('');
    return `<div class="quiz-q" id="quiz-q-${qi}">
      <p class="quiz-prompt"><span class="quiz-n">Q${qi + 1}</span> ${item.q}</p>
      <div class="quiz-opts">${opts}</div>
      <p class="quiz-explain" id="quiz-ex-${qi}" role="status" aria-live="polite" hidden></p>
    </div>`;
  }).join('');

  root.querySelectorAll<HTMLButtonElement>('.quiz-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      const qi = Number(btn.dataset.q);
      const oi = Number(btn.dataset.o);
      const item = QUESTIONS[qi];
      const group = root.querySelectorAll<HTMLButtonElement>(`.quiz-opt[data-q="${qi}"]`);
      const explain = document.getElementById(`quiz-ex-${qi}`);
      const isCorrect = oi === item.answer;

      if (!answered[qi]) {
        answered[qi] = true;
        if (isCorrect) correct += 1;
      }

      group.forEach((b, bi) => {
        b.disabled = true;
        b.classList.toggle('quiz-correct', bi === item.answer);
        b.classList.toggle('quiz-wrong', bi === oi && !isCorrect);
      });
      if (explain) {
        explain.hidden = false;
        explain.className = `quiz-explain ${isCorrect ? 'qx-ok' : 'qx-bad'}`;
        explain.innerHTML = `${isCorrect ? '✓ Correct. ' : '✗ Not quite. '}${item.explain}`;
      }
      updateScore();
    });
  });
}
