# Circuit and XOR proving-material provenance

Run:

```bash
python3 -m unittest discover -s tests -p 'test_cubic_provenance.py' -v
python3 scripts/verify-cubic-wasm.py
```

Python 3.12+, Node, and rustup are required. The supported, measured hosts are
macOS arm64 and Linux x86-64. Linux is checked by every normal pull-request and
Pages build; a deployment cannot pass this gate by copying checked-in WASM.
Passing the gate establishes the bounded artifact relationships below. It does
not turn the demo's single-party setup into a trustworthy ceremony.

## Immutable inputs and compiler

The gate captures `public/zk/` and `public/vendor/snarkjs.min.js` from the actual
Git `HEAD` as immutable blobs. It rejects dirty, missing, symlinked, included, or
unsupported additional circuit inputs. The only accepted self-contained Circom
sources are:

- `cubic.circom`
- `xor_weak.circom`
- `xor_repaired.circom`

It downloads Circom source at
[`ad44e915a12bb047b05745c2884aad9cc8326bc6`](https://github.com/iden3/circom/tree/ad44e915a12bb047b05745c2884aad9cc8326bc6)
(version 2.2.3), verifies source-archive SHA-256
`a0dbdd151cee500dfea459c4ce7f4417ff06ae7ac81502e1db35a6843749d827` and
`Cargo.lock` SHA-256
`eee7a607818fd0084d319f3098ed2babae00976bc23f6f48ace36377215b620d`,
and checks every public crate archive against its locked checksum. No lab npm
dependency supplies the compiler or proof checker.

The gate selects Rust 1.87.0 commit
`17067e9ac6d7ecb70e50f92c1944e545188d2359`, resolves rustup's executable
paths instead of accepting an unrelated system compiler, installing that exact
toolchain when it is absent, and builds Circom in an empty target with an
isolated Cargo home. The compiler build is locked and offline after the
verified fetch. User and repository Cargo settings, cached objects, wrappers,
and secrets are not inherited.

Two independent empty circuit build directories receive the captured blobs.
Both compile all three circuits with `--r1cs --wasm -p bn128`. Each pair of
R1CS files must be byte-identical, each pair of WASM files must be
byte-identical, and every rebuilt WASM must exactly match its captured shipped
Git blob. Historical R1CS files are not shipped.

## XOR key binding and executable controls

Witness compilation alone says nothing about a proving key. After the clean
rebuild, `scripts/check-zk-artifacts.mjs` loads the captured vendored snarkjs
bundle only if its SHA-256 is exactly
`3f61bbd9ac0a10173902eaef65b510fa4e9a2c057f759c7f18a6d0446b20fd06`.
It then performs all of these checks against captured artifacts:

1. Verify `xor_phase2.ptau` structurally.
2. Bind each XOR zkey to its freshly rebuilt R1CS and that PTAU with
   `zKey.verifyFromR1cs`.
3. Export each verification key from its zkey and compare the complete JSON
   value with the shipped verification key.
4. Generate and verify actual Groth16 proofs for all four binary XOR rows under
   both the weak and repaired relations.
5. Generate and verify the weak relation's explicit unintended assignment,
   with public signals `[r−4, 2, 2]` in Circom's `[out, a, b]` order.
6. Confirm that changing that public output rejects, that the weak proof does
   not verify under the repaired key, and that swapping its A/C proof elements
   rejects.
7. Confirm that the repaired witness/constraint evaluation rejects `(2,2)` at
   `XorRepaired` rather than misclassifying an unrelated backend failure.

These controls bind the learner-visible accept/reject claims to the actual
relations and shipped proof material. They do not prove general circuit
correctness. The weak circuit intentionally encodes the wrong application
relation; its valid proof for the phantom output is the lesson.

CI also runs `scripts/build-xor-artifacts.mjs` into an ignored scratch
directory with the authenticated compiler. That smoke path creates a fresh
phase-one contribution, prepares phase two, compiles both circuits, generates
and contributes both zkeys, and verifies each new R1CS/PTAU/zkey binding. It
does not replace the reviewed shipped blobs.

The focused mutation command, run after the complete browser gate in CI, is:

```bash
npm run test:mutations
```

The authenticated provenance run leaves its compiler at `zkbuild/circom` for
that command. The mutation snapshots the repaired source/WASM/zkey/vkey bytes,
removes both in-circuit bit constraints, regenerates changed artifacts, and
requires the owning real-browser claim test to fail for the repaired phantom
verdict. It restores every byte and reruns the clean owning test. A compiler,
build, browser, or unrelated-test failure cannot count as a caught mutant.

## Receipt and failure behavior

The ignored `zkbuild/cubic-provenance.json` receipt records source/blob
identities, both recipe hashes, compiler source and dependency checksums,
executable identities, commands, exit codes, timings, WASM/R1CS comparisons,
and the XOR proof-control ledger. It starts incomplete, replaces old success
before work, and becomes failed on any missing input, download/build error,
timeout, byte mismatch, malformed helper evidence, proof-control failure, or
source change. CI retains this receipt even when the gate fails. A receipt from
another SHA is historical. `--compiler-output` is optional and only copies the
already authenticated compiler after every provenance and proof-material check
has passed.

## What this does not establish

The original compiler and setup execution records remain unknown; this is a
selected, authenticated reproducing compiler plus present-day artifact binding.
The original phase-one/phase-two contribution transcripts and deleted-secret
claims are not authenticated. The vendored snarkjs bundle is hash-pinned and is
the exact implementation the browser and checker execute, but this gate does
not rebuild that bundle from source or authenticate a package version. No
constant-time property is claimed.

The README's `-e` strings are documented commands, not recovered setup
receipts. In [snarkjs's `getRandomRng`](https://github.com/iden3/snarkjs/blob/9a8f1c0083d18b9b5e18f526cfd729e7259423be/src/misc.js#L182-L202),
fresh random bytes are hashed together with supplied entropy. Publishing such
a string alone establishes neither leaked toxic waste nor secret destruction.
These demo keys are not production trust material. A passing proof, a rejected
tampered proof, and a verified zkey/R1CS binding are useful evidence for their
specific claims; none certifies setup soundness or universal relation safety.
