# crypto-lab-snark-arena

## 1. What It Is

SNARK Arena demonstrates the two most deployed zk-SNARK proving systems: Groth16 (Groth, EUROCRYPT 2016) and PLONK (Gabizon et al., 2019). Both are succinct non-interactive arguments of knowledge: they prove knowledge of a secret witness satisfying a circuit without revealing the witness, in proofs small enough to verify in milliseconds. Groth16 produces 128-byte proofs with per-circuit trusted setup. PLONK produces approximately 400-byte proofs with a universal trusted setup reusable across circuits. Both rely on pairing-based assumptions and are not post-quantum secure.

## 2. When to Use It

- ✅ Groth16: fixed circuits requiring minimal proof size and fastest verification, such as Zcash and Semaphore-style deployments where proof bytes matter.
- ✅ PLONK: circuits that evolve or where avoiding a new per-circuit ceremony is important, such as Aztec and Polygon zkEVM style workflows.
- ✅ Halo2 (PLONK variant): when recursive proof composition or no trusted setup is needed.
- ❌ Neither Groth16 nor PLONK is post-quantum secure; use STARK systems for long-term quantum resistance targets.
- ❌ Do not deploy without a multi-party trusted setup ceremony when a setup is required; a single-party setup is equivalent to no setup trust model.

## 3. Live Demo

Link: https://systemslibrarian.github.io/crypto-lab-snark-arena/

Six exhibits, a glossary, and a self-check quiz, with a sticky table of contents and per-exhibit learning objectives and key takeaways:

1. **What a zk-SNARK is** — plus an **interactive R1CS circuit playground**: drag the secret `x`, watch the witness vector and the three constraints `(A·s)(B·s) = (C·s)` for `x³ + x + 5 = 35` recompute live over a real field, and try to cheat to see a multiplication gate catch a forged wire.
   - **★ Real proof (featured)** — a genuine **Groth16 proof generated and verified entirely in your browser** with snarkjs, on the same circuit. Generate it, verify it (`true`), then tamper with the public output and watch the pairing check reject it (`false`). No server, no simulation.
2. **Groth16** with per-circuit trusted setup and a ceremony visualizer.
3. **PLONK** with a universal SRS and circuit flexibility.
4. **Head-to-head** comparison on the same circuit, with a decision tree.
5. **The trusted-setup problem in depth** — a **live powers-of-tau ceremony** showing the combined secret `τ = τ₁·τ₂·…·τₙ` as a running product (toggle who deletes their toxic waste), and a **live KZG forgery demo** proving that an honest prover cannot open a commitment to a lie, while an attacker who keeps `τ` can.
6. **Production deployments** in Zcash, Polygon zkEVM, WorldID/Semaphore, and zkLogin.

### Real math, not mock-ups

The interactive panels run genuine finite-field arithmetic in the browser (`src/crypto/`): the R1CS witness check, modular inverse/exponentiation, polynomial division, the powers-of-tau SRS, and KZG commit/open/verify. The numbers use a toy-sized field (`F₁₇`, group order 17 encoded mod 103) so every value is small enough to verify by hand; real systems use the same constructions on 254-bit curves. The cryptographic core has no UI dependencies and is unit-testable in isolation.

The **Real proof** panel goes one step further and runs the *production* stack — `snarkjs.groth16.fullProve` / `verify` on a circom-compiled circuit and a real trusted-setup proving key — entirely client-side. The Groth16/PLONK proof-size and timing figures in Exhibits 02–04 remain illustrative (labeled "simulated") and follow snarkjs benchmark conventions.

### Real SNARKs on GitHub Pages

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

## 4. How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-snark-arena
cd crypto-lab-snark-arena
npm install
npm run dev
```

## 5. Part of the Crypto-Lab Suite

Part of [crypto-lab](https://systemslibrarian.github.io/crypto-lab/) — browser-based cryptography demos spanning 2,500 years of cryptographic history to NIST FIPS 2024 post-quantum standards.

So whether you eat or drink or whatever you do, do it all for the glory of God. — 1 Corinthians 10:31