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

Six exhibits: what a zk-SNARK is and how circuits work, Groth16 with per-circuit trusted setup and ceremony visualizer, PLONK with universal SRS and circuit flexibility, head-to-head comparison on the same circuit, the trusted setup problem in depth with MPC ceremony simulation, and production deployments in Zcash, Polygon zkEVM, WorldID/Semaphore, and zkLogin.

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