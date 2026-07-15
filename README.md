# crypto-lab-snark-arena

## What It Is

SNARK Arena demonstrates the two most deployed zk-SNARK proving systems: Groth16 (Groth, EUROCRYPT 2016) and PLONK (Gabizon et al., 2019). Both are succinct non-interactive arguments of knowledge: they prove knowledge of a secret witness satisfying a circuit without revealing the witness, in proofs small enough to verify in milliseconds. Groth16 produces 128-byte proofs with per-circuit trusted setup. PLONK produces approximately 400-byte proofs with a universal trusted setup reusable across circuits. Both rely on pairing-based assumptions and are not post-quantum secure.

## When to Use It

- ✅ Groth16: fixed circuits requiring minimal proof size and fastest verification, such as Zcash and Semaphore-style deployments where proof bytes matter.
- ✅ PLONK: circuits that evolve or where avoiding a new per-circuit ceremony is important, such as Aztec and Polygon zkEVM style workflows.
- ✅ Halo2 (PLONK variant): when recursive proof composition or no trusted setup is needed.
- ❌ Neither Groth16 nor PLONK is post-quantum secure; use STARK systems for long-term quantum resistance targets.
- ❌ Do not deploy without a multi-party trusted setup ceremony when a setup is required; a single-party setup is equivalent to no setup trust model.
- ❌ Do not treat this as production proving infrastructure — it is a teaching demo, and the interactive panels use a toy field (real systems use 254-bit curves and audited libraries).

## Live Demo

**[systemslibrarian.github.io/crypto-lab-snark-arena](https://systemslibrarian.github.io/crypto-lab-snark-arena/)**

Six exhibits, a glossary, and a self-check quiz walk from what a zk-SNARK is — with an interactive R1CS circuit playground — through Groth16 and PLONK, a head-to-head comparison, the trusted-setup problem in depth (a live powers-of-tau ceremony and a KZG forgery demo), and production deployments. A featured panel generates and verifies a genuine Groth16 proof entirely in your browser with snarkjs: produce it, verify it (`true`), then tamper with the public output and watch the pairing check reject it (`false`). No server, no simulation.

## What Can Go Wrong

- **Trusted-setup toxic waste** — anyone who retains the secret `τ` from the setup ceremony can forge proofs for false statements; the powers-of-tau and KZG-forgery exhibits demonstrate exactly this.
- **Single-party setup** — a one-participant ceremony is no better than no setup; soundness requires a multi-party ceremony where at least one honest participant destroys their contribution.
- **Not post-quantum** — Groth16 and PLONK rest on pairing-based assumptions and fall to a quantum adversary; use STARKs where long-term quantum resistance is required.
- **Under-constrained circuits** — a circuit that fails to constrain a wire lets a prover satisfy it with forged values; soundness depends on the circuit, not just the proof system.
- **Toy-field intuition** — the interactive panels use a small field (`F₁₇`) so values verify by hand; real deployments need 254-bit curves, and the demo's proof-size/timing figures in Exhibits 02–04 are labeled illustrative.

## Real-World Usage

- **Zcash** — Groth16 proofs authorize shielded transactions without revealing sender, receiver, or amount.
- **zkEVM rollups** — Polygon zkEVM and Aztec use PLONK-family systems to prove correct execution off-chain.
- **Identity / anti-Sybil** — WorldID and Semaphore use Groth16 proofs for private set membership and one-person-one-action guarantees.
- **zkLogin** — proves a valid OAuth login without revealing identity, using a SNARK over the JWT.
- **General zk-rollups** — succinct, constant-size proofs let a chain verify a whole batch of transactions in milliseconds.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-snark-arena
cd crypto-lab-snark-arena
npm install
npm run dev      # dev server
npm test         # crypto-core unit tests (Vitest)
npm run build && npm run test:a11y   # production build + WCAG a11y gate
```

## Related Demos

- [crypto-lab-stark-tower](https://systemslibrarian.github.io/crypto-lab-stark-tower/) — zk-STARKs, the transparent, post-quantum alternative to pairing-based SNARKs.
- [crypto-lab-zk-arena](https://systemslibrarian.github.io/crypto-lab-zk-arena/) — side-by-side comparison of zk-SNARK and zk-STARK proof systems.
- [crypto-lab-bulletproofs](https://systemslibrarian.github.io/crypto-lab-bulletproofs/) — short range proofs and inner-product arguments with no trusted setup.
- [crypto-lab-zk-proof-lab](https://systemslibrarian.github.io/crypto-lab-zk-proof-lab/) — Schnorr commitments and the Fiat-Shamir transform that underpins non-interactive proofs.
- [crypto-lab-mpcith-sign](https://systemslibrarian.github.io/crypto-lab-mpcith-sign/) — MPC-in-the-Head, a post-quantum signature built from zero-knowledge proofs.

## The Exhibits

1. **What a zk-SNARK is** — plus an **interactive R1CS circuit playground**: drag the secret `x`, watch the witness vector and the three constraints `(A·s)(B·s) = (C·s)` for `x³ + x + 5 = 35` recompute live over a real field, and try to cheat to see a multiplication gate catch a forged wire.
   - **★ Real proof (featured)** — a genuine **Groth16 proof generated and verified entirely in your browser** with snarkjs, on the same circuit. Generate it, verify it (`true`), then tamper with the public output and watch the pairing check reject it (`false`). No server, no simulation.
2. **Groth16** with per-circuit trusted setup and a ceremony visualizer.
3. **PLONK** with a universal SRS and circuit flexibility.
4. **Head-to-head** comparison on the same circuit, with a decision tree.
5. **The trusted-setup problem in depth** — a **live powers-of-tau ceremony** showing the combined secret `τ = τ₁·τ₂·…·τₙ` as a running product (toggle who deletes their toxic waste), and a **live KZG forgery demo** proving that an honest prover cannot open a commitment to a lie, while an attacker who keeps `τ` can.
6. **Production deployments** in Zcash, Polygon zkEVM, WorldID/Semaphore, and zkLogin.

## Real math, not mock-ups

The interactive panels run genuine finite-field arithmetic in the browser (`src/crypto/`): the R1CS witness check, modular inverse/exponentiation, polynomial division, the powers-of-tau SRS, and KZG commit/open/verify. The numbers use a toy-sized field (`F₁₇`, group order 17 encoded mod 103) so every value is small enough to verify by hand; real systems use the same constructions on 254-bit curves. The cryptographic core has no UI dependencies and is unit-tested in isolation: `npm test` runs 37 Vitest cases (`src/crypto/*.test.ts`) — field KATs and homomorphism/Fermat properties, the powers-of-tau product and SRS encodings, KZG commit/open/verify round-trips, verify-rejects-a-lie, the leaked-`τ` forgery, and the R1CS witness catching a forged wire.

**On the verify step specifically:** a real KZG verifier checks the bilinear pairing `e(C·g⁻ʸ, g) = e(π, g^(τ−z))` over the group elements `C` and `π` alone, never touching `τ`. This demo has no pairing on its toy group, so `kzgVerify` tests the *same* algebraic relation the pairing enforces — the exponent equality `f(τ)−y = q(τ)(τ−z)` — by reading the exponents directly (including `τ`). It faithfully models *what* the pairing verifies, not *how*; that scope limit is now stated in-app at the verify step (via `PAIRING_NOTE`), not only in code comments.

The **Real proof** panel goes one step further and runs the *production* stack — `snarkjs.groth16.fullProve` / `verify` on a circom-compiled circuit and a real trusted-setup proving key — entirely client-side. The Groth16/PLONK proof-size and timing figures in Exhibits 02–04 remain illustrative (labeled "simulated") and follow snarkjs benchmark conventions.

## Real SNARKs on GitHub Pages

A real SNARK needs no server: proving and verifying are pure client-side computation. The circuit artifacts are generated once at build time and shipped as static files in `public/zk/` (witness-generator WASM, proving key, verification key), with snarkjs vendored in `public/vendor/`. The only real constraint is that GitHub Pages can't send the COOP/COEP headers needed for multi-threaded WASM, so proving runs single-threaded — fine for small-to-medium circuits; large circuits (hundreds-of-MB proving keys) hit the 100 MB per-file limit.

To regenerate the artifacts (requires the [circom](https://github.com/iden3/circom) compiler):

```bash
circom public/zk/cubic.circom --r1cs --wasm -p bn128 -o build
npx snarkjs powersoftau new bn128 8 pot.ptau
npx snarkjs powersoftau contribute pot.ptau pot1.ptau -e="random"
npx snarkjs powersoftau prepare phase2 pot1.ptau potf.ptau
npx snarkjs groth16 setup build/cubic.r1cs potf.ptau zk0.zkey
npx snarkjs zkey contribute zk0.zkey public/zk/cubic_final.zkey -e="random2"
npx snarkjs zkey export verificationkey public/zk/cubic_final.zkey public/zk/verification_key.json
# copy build/cubic_js/cubic.wasm -> public/zk/cubic.wasm
```

---

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
