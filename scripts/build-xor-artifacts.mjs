#!/usr/bin/env node

/**
 * Regenerate the bounded XOR lesson's demo-only Groth16 material.
 *
 * This is an explicit maintenance command, not part of the normal site build.
 * It uses the exact vendored snarkjs browser bundle that the lesson executes.
 * Generated keys remain single-party teaching keys: successful generation and
 * verification do not prove that setup secrets were destroyed.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNARKJS_SHA256 = '3f61bbd9ac0a10173902eaef65b510fa4e9a2c057f759c7f18a6d0446b20fd06';
const ALLOWED = ['xor_weak', 'xor_repaired'];

function usage(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(
    'usage: node scripts/build-xor-artifacts.mjs --circom PATH --out DIR ' +
      '--circuit all|xor_weak|xor_repaired [--reuse-ptau PATH]\n',
  );
  process.exit(2);
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--circom', '--out', '--circuit', '--reuse-ptau'].includes(flag) || !value) {
      usage('invalid arguments');
    }
    if (values[flag]) usage(`duplicate argument: ${flag}`);
    values[flag] = value;
  }
  if (!values['--circom'] || !values['--out'] || !values['--circuit']) {
    usage('circom, output directory, and circuit selection are required');
  }
  const circuits = values['--circuit'] === 'all' ? ALLOWED : [values['--circuit']];
  if (circuits.some((name) => !ALLOWED.includes(name))) usage('unsupported circuit selection');
  if (circuits.length !== ALLOWED.length && !values['--reuse-ptau']) {
    usage('a single-circuit build must reuse an explicit phase-2 PTAU');
  }
  return {
    circom: resolve(values['--circom']),
    out: resolve(values['--out']),
    circuits,
    reusePtau: values['--reuse-ptau'] ? resolve(values['--reuse-ptau']) : null,
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function loadSnarkjs() {
  const bundle = await readFile(join(ROOT, 'public/vendor/snarkjs.min.js'));
  assert.equal(sha256(bundle), SNARKJS_SHA256, 'vendored snarkjs bundle hash mismatch');
  (0, eval)(`${bundle.toString('utf8')}\nglobalThis.__artifactSnarkjs = snarkjs;`);
  const api = globalThis.__artifactSnarkjs;
  delete globalThis.__artifactSnarkjs;
  assert.ok(api?.powersOfTau?.verify && api?.zKey?.newZKey, 'incomplete snarkjs API');
  return api;
}

function runCircom(binary, source, output) {
  const result = spawnSync(binary, [source, '--r1cs', '--wasm', '-p', 'bn128', '-o', output], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Circom failed (${result.status}):\n${result.stdout}${result.stderr}`);
  }
}

async function makePtau(snarkjs, reusePtau) {
  if (reusePtau) {
    const supplied = new Uint8Array(await readFile(reusePtau));
    assert.equal(await snarkjs.powersOfTau.verify(supplied), true, 'supplied PTAU is invalid');
    return supplied;
  }

  const initial = { type: 'mem' };
  const contributed = { type: 'mem' };
  const phase2 = { type: 'mem' };
  const curve = await snarkjs.curves.getCurveFromName('bn128');
  await snarkjs.powersOfTau.newAccumulator(curve, 4, initial);
  await snarkjs.powersOfTau.contribute(
    initial.data,
    contributed,
    'SNARK Arena bounded XOR teaching setup',
    randomBytes(64).toString('hex'),
  );
  await snarkjs.powersOfTau.preparePhase2(contributed.data, phase2);
  assert.equal(
    await snarkjs.powersOfTau.verify(phase2.data),
    true,
    'generated PTAU failed verification',
  );
  return phase2.data;
}

async function buildCircuit(snarkjs, args, name, work, ptau) {
  const source = join(ROOT, 'public/zk', `${name}.circom`);
  assert.equal(basename(source), `${name}.circom`);
  runCircom(args.circom, source, work);

  const r1cs = join(work, `${name}.r1cs`);
  const wasm = join(work, `${name}_js`, `${name}.wasm`);
  const r1csBytes = new Uint8Array(await readFile(r1cs));
  const initialZkey = { type: 'mem' };
  const finalZkey = { type: 'mem' };
  await snarkjs.zKey.newZKey(r1csBytes, ptau, initialZkey);
  await snarkjs.zKey.contribute(
    initialZkey.data,
    finalZkey,
    `SNARK Arena ${name} teaching setup`,
    randomBytes(64).toString('hex'),
  );
  assert.equal(
    await snarkjs.zKey.verifyFromR1cs(r1csBytes, ptau, finalZkey.data),
    true,
    `${name} zkey failed R1CS/PTAU binding verification`,
  );
  const verificationKey = await snarkjs.zKey.exportVerificationKey(finalZkey.data);
  return { wasm, finalZkey: finalZkey.data, verificationKey };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  await mkdir(args.out, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), 'snark-arena-xor-build-'));
  try {
    const snarkjs = await loadSnarkjs();
    const ptau = await makePtau(snarkjs, args.reusePtau);
    const completed = [];
    for (const name of args.circuits) {
      const built = await buildCircuit(snarkjs, args, name, work, ptau);
      await copyFile(built.wasm, join(args.out, `${name}.wasm`));
      await writeFile(join(args.out, `${name}_final.zkey`), built.finalZkey);
      await writeFile(
        join(args.out, `${name}_verification_key.json`),
        `${JSON.stringify(built.verificationKey, null, 1)}\n`,
      );
      completed.push(name);
    }
    if (!args.reusePtau) await writeFile(join(args.out, 'xor_phase2.ptau'), ptau);
    process.stdout.write(
      `generated and verified ${completed.join(', ')}; ` +
        `${args.reusePtau ? 'reused' : 'created'} phase-2 PTAU\n`,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
