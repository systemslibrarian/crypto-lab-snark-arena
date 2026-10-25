#!/usr/bin/env node

/**
 * Bind the shipped XOR proving material to freshly compiled R1CS files.
 *
 * This helper intentionally loads the already shipped browser bundle. It does
 * not install a second snarkjs implementation whose result could disagree with
 * what learners actually run. The caller supplies an immutable Git capture of
 * public/ plus an independently generated R1CS directory.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SNARKJS_SHA256 = '3f61bbd9ac0a10173902eaef65b510fa4e9a2c057f759c7f18a6d0446b20fd06';
const BN254_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function usage(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(
    'usage: node scripts/check-zk-artifacts.mjs --captured DIR --r1cs-dir DIR\n',
  );
  process.exit(2);
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--captured', '--r1cs-dir'].includes(flag) || !value) usage('invalid arguments');
    if (values[flag]) usage(`duplicate argument: ${flag}`);
    values[flag] = resolve(value);
  }
  if (!values['--captured'] || !values['--r1cs-dir']) usage('both directories are required');
  return { captured: values['--captured'], r1csDir: values['--r1cs-dir'] };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function loadSnarkjs(bundlePath) {
  const bundle = await readFile(bundlePath);
  assert.equal(sha256(bundle), SNARKJS_SHA256, 'vendored snarkjs bundle hash mismatch');
  // The browser distribution deliberately exposes a `snarkjs` global. Append
  // one assignment inside the same indirect-eval program so ESM lexical scope
  // cannot hide it from this helper.
  (0, eval)(`${bundle.toString('utf8')}\nglobalThis.__artifactSnarkjs = snarkjs;`);
  const api = globalThis.__artifactSnarkjs;
  delete globalThis.__artifactSnarkjs;
  assert.ok(api?.groth16?.fullProve && api?.zKey?.verifyFromR1cs, 'incomplete snarkjs API');
  return api;
}

function bytes(path) {
  return readFile(path).then((value) => new Uint8Array(value));
}

function normalizeJson(value) {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalizeJson(child)]),
    );
  }
  return value;
}

function xorSignals(a, b) {
  const integer = a + b - 2n * a * b;
  const out = ((integer % BN254_SCALAR_FIELD) + BN254_SCALAR_FIELD) % BN254_SCALAR_FIELD;
  return [out, a, b].map(String);
}

async function proveAndVerify(snarkjs, material, input) {
  const result = await snarkjs.groth16.fullProve(input, material.wasm, material.zkey);
  const verified = await snarkjs.groth16.verify(material.vkey, result.publicSignals, result.proof);
  assert.equal(verified, true, `${material.name} proof did not verify`);
  return result;
}

async function main() {
  const { captured, r1csDir } = parseArguments(process.argv.slice(2));
  const bundlePath = `${captured}/public/vendor/snarkjs.min.js`;
  const snarkjs = await loadSnarkjs(bundlePath);
  const ptau = await bytes(`${captured}/public/zk/xor_phase2.ptau`);
  assert.equal(await snarkjs.powersOfTau.verify(ptau), true, 'shipped phase-2 PTAU is invalid');

  const circuits = {};
  for (const name of ['xor_weak', 'xor_repaired']) {
    const material = {
      name,
      r1cs: await bytes(`${r1csDir}/${name}.r1cs`),
      wasm: await bytes(`${captured}/public/zk/${name}.wasm`),
      zkey: await bytes(`${captured}/public/zk/${name}_final.zkey`),
      vkey: JSON.parse(await readFile(`${captured}/public/zk/${name}_verification_key.json`, 'utf8')),
    };
    assert.equal(
      await snarkjs.zKey.verifyFromR1cs(material.r1cs, ptau, material.zkey),
      true,
      `${name} zkey is not bound to the rebuilt R1CS and shipped PTAU`,
    );
    const exported = await snarkjs.zKey.exportVerificationKey(material.zkey);
    assert.deepEqual(
      normalizeJson(exported),
      normalizeJson(material.vkey),
      `${name} verification key is not the key exported from its zkey`,
    );
    circuits[name] = material;
  }

  const truthTable = [];
  for (const [a, b] of [
    [0n, 0n],
    [0n, 1n],
    [1n, 0n],
    [1n, 1n],
  ]) {
    for (const material of Object.values(circuits)) {
      const result = await proveAndVerify(snarkjs, material, { a: String(a), b: String(b) });
      assert.deepEqual(result.publicSignals.map(String), xorSignals(a, b), 'unexpected public-signal order');
    }
    truthTable.push({ a: Number(a), b: Number(b), out: Number(BigInt(xorSignals(a, b)[0])) });
  }

  const weakPhantom = await proveAndVerify(snarkjs, circuits.xor_weak, { a: '2', b: '2' });
  assert.deepEqual(
    weakPhantom.publicSignals.map(String),
    xorSignals(2n, 2n),
    'weak relation did not expose the exact paper-derived phantom output',
  );

  const changedSignals = [...weakPhantom.publicSignals.map(String)];
  changedSignals[0] = String((BigInt(changedSignals[0]) + 1n) % BN254_SCALAR_FIELD);
  assert.equal(
    await snarkjs.groth16.verify(circuits.xor_weak.vkey, changedSignals, weakPhantom.proof),
    false,
    'changed public output unexpectedly verified',
  );
  assert.equal(
    await snarkjs.groth16.verify(
      circuits.xor_repaired.vkey,
      weakPhantom.publicSignals,
      weakPhantom.proof,
    ),
    false,
    'weak proof unexpectedly verified under the repaired key',
  );
  const swappedProof = structuredClone(weakPhantom.proof);
  [swappedProof.pi_a, swappedProof.pi_c] = [swappedProof.pi_c, swappedProof.pi_a];
  assert.equal(
    await snarkjs.groth16.verify(
      circuits.xor_weak.vkey,
      weakPhantom.publicSignals,
      swappedProof,
    ),
    false,
    'proof-element swap unexpectedly verified',
  );

  let repairedError = null;
  const repairedDiagnostics = [];
  const originalConsoleError = console.error;
  try {
    console.error = (...parts) => repairedDiagnostics.push(parts.map(String).join(' '));
    await snarkjs.groth16.fullProve(
      { a: '2', b: '2' },
      circuits.xor_repaired.wasm,
      circuits.xor_repaired.zkey,
    );
  } catch (error) {
    repairedError = String(error);
  } finally {
    console.error = originalConsoleError;
  }
  assert.match(
    `${repairedDiagnostics.join('\n')}\n${repairedError ?? ''}`,
    /Assert Failed[\s\S]*XorRepaired/,
    'repaired witness generator did not reject the unintended assignment at its constraint',
  );

  process.stdout.write(
    `${JSON.stringify({
      state: 'bound-and-exercised',
      snarkjsSha256: SNARKJS_SHA256,
      ptauValid: true,
      truthTable,
      weakPhantomSignals: weakPhantom.publicSignals.map(String),
      changedPublicOutputRejected: true,
      crossKeyRejected: true,
      proofElementSwapRejected: true,
      repairedPhantomRejected: true,
    })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
