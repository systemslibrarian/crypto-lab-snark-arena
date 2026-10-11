# Cubic witness-generator provenance

Run `python3 -m unittest discover -s tests -p 'test_cubic_provenance.py' -v`, then
`python3 scripts/verify-cubic-wasm.py`. Python 3.12+ and rustup are required.
The supported, measured hosts are macOS arm64 and Linux x86-64. The latter is
also checked by the normal PR and Pages build; a deployment cannot pass this
gate by merely copying the checked-in WASM.

The gate captures `public/zk/` from the actual Git HEAD as immutable blobs,
rejecting dirty, missing, symlinked or unsupported additional circuit inputs.
It downloads Circom source at
[`ad44e915a12bb047b05745c2884aad9cc8326bc6`](https://github.com/iden3/circom/tree/ad44e915a12bb047b05745c2884aad9cc8326bc6)
(version 2.2.3), verifies source archive SHA256
`a0dbdd151cee500dfea459c4ce7f4417ff06ae7ac81502e1db35a6843749d827` and
Cargo.lock SHA256
`eee7a607818fd0084d319f3098ed2babae00976bc23f6f48ace36377215b620d`, and checks
every public crate archive against its locked checksum. No lab dependencies
are installed by this provenance command.

It selects actual Rust 1.87.0 commit
`17067e9ac6d7ecb70e50f92c1944e545188d2359`, resolves rustup's executable paths
instead of accepting an unrelated system compiler, and builds Circom in an
empty target with an isolated Cargo home. The compiler build is locked and
offline after the verified fetch. Neither user nor repository Cargo settings,
cached objects, wrappers or secrets are inherited.

Two independent empty circuit build directories receive the captured blobs.
Both run the documented `--r1cs --wasm -p bn128` recipe. Their WASM bytes must
equal each other **and the captured shipped `public/zk/cubic.wasm`**. Their
R1CS bytes must equal each other; no historical tracked R1CS is available.
The command never replaces shipped artifacts or regenerates setup keys.

The ignored `zkbuild/cubic-provenance.json` receipt records actual source/blob
identities, recipe hash, compiler source and dependency checksums, executable
identities, commands, exit codes, times and comparisons. It starts incomplete,
replaces old success before work, and becomes failed on any missing input,
download/build error, timeout, byte mismatch or source change. CI retains this
receipt even when the gate fails. A receipt from another SHA is historical.

## What this establishes and what remains unknown

Two actual clean macOS builds of the circuit at
`4a866206e5e6cf170cbab3077f17b8c5abd9806a` with this authenticated Circom source
produced the exact 34,439-byte shipped witness WASM:
`45784cb874b00f7e61c99315e8d7256a79d8ee7ef3f72dcfa435325eb9c560bd`.
The shipped getters report 2.2.3, but getters alone do not authenticate a compiler.
The gate supplies source-to-WASM evidence in an explicitly measured environment.
The **original compiler remains unknown**; this is a selected reproducing build.

The proving/verification keys, original setup software version, contribution
transcripts, deleted-secret claims and ceremony inputs are not authenticated
by witness compilation or by a passing proof. The vendored snarkjs bundle is
not source-rebuilt by this gate. These limits remain separate from application
tests, static scanner coverage, compiler reproduction and constant-time claims.

The README's `-e` strings are documented commands, not recovered setup receipts.
In [snarkjs's pinned `getRandomRng`](https://github.com/iden3/snarkjs/blob/9a8f1c0083d18b9b5e18f526cfd729e7259423be/src/misc.js#L182-L202),
fresh random bytes are hashed together with the supplied entropy. Publishing
that string alone does **not** establish that toxic waste was leaked. It also
does not establish that secrets were destroyed. These demo keys lack verified
ceremony evidence and must not be used as production trust material. An actual
tampered proof failing verification establishes rejection of that test case,
not trustworthy setup or general soundness.
