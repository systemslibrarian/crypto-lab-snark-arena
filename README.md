# crypto-lab-snark-arena

## What It Is

SNARK Arena demonstrates the two most deployed zk-SNARK proving systems: Groth16 (Groth, EUROCRYPT 2016) and PLONK (Gabizon et al., 2019). Both are succinct non-interactive arguments of knowledge: under their security assumptions, they prove knowledge of a witness satisfying a circuit without disclosing additional information beyond the public statement, in small proofs. That statement can itself reveal the witness. Groth16 produces 128-byte proofs on BN254 with per-circuit trusted setup — that is the compressed encoding; the same three group elements are 256 bytes uncompressed, which is what snarkjs writes and what the live-proof panel reports. PLONK produces approximately 400-byte proofs with a universal trusted setup reusable across circuits. Both rely on pairing-based assumptions and are not post-quantum secure.

## When to Use It

- ✅ Groth16: fixed circuits requiring minimal proof size and fastest verification, such as Zcash and Semaphore-style deployments where proof bytes matter.
- ✅ PLONK: circuits that evolve or where avoiding a new per-circuit ceremony is important, such as Aztec and Polygon zkEVM style workflows.
- ✅ Halo2 (PLONK variant): when recursive proof composition or no trusted setup is needed — but "no trusted setup" is a property of the IPA backend that upstream (Zcash) halo2 uses, not of halo2 as such. The PSE fork swaps IPA for KZG for cheaper L1 verification, and KZG needs a ceremony.
- ❌ Neither Groth16 nor PLONK is post-quantum secure; use STARK systems for long-term quantum resistance targets.
- ❌ A single-party setup requires trusting that one participant generated and destroyed the setup secrets correctly. A verified multi-party ceremony reduces that trust to at least one honest participant; these demo artifacts have no authenticated ceremony evidence.
- ❌ Do not treat this as production proving infrastructure — it is a teaching demo, and the interactive panels use toy fields — `F₈₁₉₁` in the R1CS playground, `F₁₇` in the ceremony and KZG exhibits (real systems use 254-bit curves and audited libraries).

## Live Demo

**[systemslibrarian.github.io/crypto-lab-snark-arena](https://systemslibrarian.github.io/crypto-lab-snark-arena/)**

Six numbered exhibits, a focused constraint-gap case study, a glossary, and a self-check quiz walk from what a zk-SNARK is — with an interactive R1CS circuit playground — through Groth16 and PLONK, a head-to-head comparison, the trusted-setup problem in depth (a live powers-of-tau ceremony and a KZG forgery demo), and production deployments. A featured panel generates and verifies a genuine Groth16 proof entirely in your browser with snarkjs: produce it, verify it (`true`), then tamper with the public output and watch the pairing check reject it (`false`). The case study also generates an unmodified proof for a deliberately weak XOR relation, shows the explicit `(a,b,out)=(2,2,−4 mod r)` assignment that relation accepts, and runs the same assignment against a repaired circuit whose in-circuit bit constraints reject it. No server, no simulation.

## What Can Go Wrong

- **Private input is not necessarily confidential.** The live proof panel publishes `out = x³ + x + 5`. All 21 slider values 0–20 have distinct outputs below field wraparound, so `out=35` identifies `x=3` without inspecting the proof. The toy playground likewise has only `x=3` in its 0–9 slider range, while its full field still has the documented three roots. This example teaches proof mechanics, not witness confidentiality; zero knowledge cannot undo information already implied by public inputs. This is separate from the unverified setup provenance described below.

- **Trusted-setup toxic waste** — anyone who retains the secret `τ` from the setup ceremony can forge proofs for false statements; the powers-of-tau and KZG-forgery exhibits demonstrate exactly this.
- **Single-party setup** — trust rests entirely on that participant's honest generation and secret destruction. Multi-party setup distributes that trust: at least one honest participant must destroy their contribution. Participant count alone does not prove destruction or soundness.
- **Not post-quantum** — Groth16 and PLONK rest on pairing-based assumptions and fall to a quantum adversary; use STARKs where long-term quantum resistance is required.
- **Under-constrained relations** — proof validity establishes only the relation actually encoded. The constraint-gap case study makes this concrete: a weak relation accepts a genuine, unmodified Groth16 proof for public inputs `(2,2)` and output `−4 mod r`, even though the intended Boolean-XOR computation rejects non-bits. The repair is `a(a−1)=0` and `b(b−1)=0` inside the circuit, followed by circuit-specific artifact regeneration; a browser input check is not a proof-relation repair.
- **Toy-field intuition** — the interactive panels use small fields so values verify by hand, and there is more than one: the R1CS circuit playground runs over `F₈₁₉₁` (2¹³ − 1), while the powers-of-tau ceremony and KZG-forgery exhibits use `F₁₇`. Both are toy and both are labeled in-app; real deployments need 254-bit curves, and the demo's proof-size/timing figures in Exhibits 02–04 are labeled illustrative.

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
   - **★ Constraint gap (paper-bounded case study)** — two real Circom/Groth16 relations separate intended witness computation from verifier constraints. The weak relation proves the explicit phantom output from Kolozyan et al.; the repaired relation rejects that same assignment while preserving all four legitimate XOR rows. Ordinary proof-byte tampering is shown separately.
2. **Groth16** with per-circuit trusted setup and a ceremony visualizer.
3. **PLONK** with a universal SRS and circuit flexibility.
4. **Head-to-head** comparison on the same circuit, with a decision tree.
5. **The trusted-setup problem in depth** — a **live powers-of-tau ceremony** showing the combined secret `τ = τ₁·τ₂·…·τₙ` as a running product (toggle who deletes their toxic waste), and a **live KZG forgery demo** proving that an honest prover cannot open a commitment to a lie, while an attacker who keeps `τ` can.
6. **Production deployments** in Zcash, Polygon zkEVM, WorldID/Semaphore, and zkLogin.

## Real math, not mock-ups

The interactive panels run genuine finite-field arithmetic in the browser (`src/crypto/`): the R1CS witness check, modular inverse/exponentiation, polynomial division, the powers-of-tau SRS, KZG commit/open/verify, and the weak/repaired XOR relation over the BN254 scalar field. The R1CS playground uses the toy field `F₈₁₉₁`; the ceremony and KZG exhibits use `F₁₇` with a group of order 17 encoded mod 103, so every value is small enough to verify by hand. Real systems use the same constructions on 254-bit curves. The cryptographic core has no UI dependencies and is unit-tested in isolation: `npm test` runs 51 Vitest cases (`src/crypto/*.test.ts`) — field KATs and homomorphism/Fermat properties, the powers-of-tau product and SRS encodings, KZG commit/open/verify round-trips, verify-rejects-a-lie, the leaked-`τ` forgery, R1CS witness checks, and independent XOR-domain/residue/public-signal checks.

**On the verify step specifically:** a real KZG verifier checks the bilinear pairing `e(C·g⁻ʸ, g) = e(π, g^(τ−z))` over the group elements `C` and `π` alone, never touching `τ`. This demo has no pairing on its toy group, so `kzgVerify` tests the *same* algebraic relation the pairing enforces — the exponent equality `f(τ)−y = q(τ)(τ−z)` — by reading the exponents directly (including `τ`). It faithfully models *what* the pairing verifies, not *how*; that scope limit is now stated in-app at the verify step (via `PAIRING_NOTE`), not only in code comments.

The **Real proof** and **Constraint gap** panels go one step further and run the *production* stack — `snarkjs.groth16.fullProve` / `verify` on circom-compiled circuits and real trusted-setup proving keys — entirely client-side. For the gap lesson, the repository gate independently binds each shipped XOR proving key to its freshly rebuilt R1CS and shared phase-2 PTAU, exports and compares the verification key, and exercises the valid and phantom assignments. The Groth16/PLONK proof-size and timing figures in Exhibits 02–04 remain illustrative (labeled "simulated") and follow snarkjs benchmark conventions.

## Real SNARKs on GitHub Pages

A real SNARK needs no server: proving and verifying are pure client-side computation. The circuit artifacts are generated once and shipped as static files in `public/zk/` (witness-generator WASM, proving key, verification key, plus the XOR lesson's phase-2 PTAU), with snarkjs vendored in `public/vendor/`. The only real constraint is that GitHub Pages can't send the COOP/COEP headers needed for multi-threaded WASM, so proving runs single-threaded — fine for small-to-medium circuits; large circuits (hundreds-of-MB proving keys) hit the 100 MB per-file limit.

**On the trust in those artifacts.** The cubic recipe below documents a local two-phase snarkjs setup with one contribution in each phase and published entropy strings. Those strings alone do not establish public toxic waste: [snarkjs mixes fresh random bytes with the supplied entropy](https://github.com/iden3/snarkjs/blob/9a8f1c0083d18b9b5e18f526cfd729e7259423be/src/misc.js). The XOR regeneration helper likewise creates single-party teaching keys. The original setup execution records, contribution transcripts and secret destruction are not authenticated. The page performs genuine Groth16 proving and verification, but passing examples do not certify setup soundness. These are demo-only keys with **unverified ceremony provenance**, not production trust material. The featured panels and trust banners state the same limit.

All three witness generators have a separate [repeatable source-to-shipped-artifact check](docs/cubic-provenance.md): `python3 scripts/verify-cubic-wasm.py`. It builds authenticated pinned Circom source and compiles each captured circuit twice, requiring both results to match the shipped WASM. For the two XOR circuits it additionally verifies the shared PTAU, proves that each zkey is bound to the rebuilt R1CS/PTAU, compares the verification key exported from that zkey, and executes positive and negative proof controls. It does not certify toxic-waste destruction, reproduce the vendored snarkjs bundle from its source, or authenticate the original setup ceremony.

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

# Regenerate both XOR circuits plus a fresh demo-only setup using the exact
# vendored snarkjs bundle (this replaces the XOR WASM/PTAU/zkey/vkey files):
node scripts/build-xor-artifacts.mjs --circom /path/to/circom --out public/zk --circuit all
```

The constraint-gap example is a bounded adaptation of Kolozyan et al., [*Language-Agnostic Detection of Computation-Constraint Inconsistencies in ZKP Programs via Value Inference*](https://eprint.iacr.org/2025/2120), ePrint 2025/2120, revision 7 (11 April 2026), especially §§2.1–2.3 and §3.2.3. The paper's §3.2.3 XOR example supplies the computation/constraint mismatch and explicit `a=b=2` phantom output; this lab adapts it into two small public-input Circom/Groth16 relations. It does not implement CCC-Check, reproduce the §5 evaluation, or generalize beyond the concrete lesson; §7's limitations remain applicable.

---

*Part of the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
