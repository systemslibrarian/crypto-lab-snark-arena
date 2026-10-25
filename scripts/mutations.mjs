#!/usr/bin/env node

/** Focused mutation gate for the repaired XOR proof relation. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_TITLE = 'actual weak relation proves the explicit phantom output and repaired relation rejects it';
const CONSTRAINTS = '    a * (a - 1) === 0;\n    b * (b - 1) === 0;';
const MUTANT =
  '    // MUTATION: the two binary-input constraints were removed.\n' +
  '    // A direct prover can now supply non-binary field elements.';
const TARGETS = [
  'public/zk/xor_repaired.circom',
  'public/zk/xor_repaired.wasm',
  'public/zk/xor_repaired_final.zkey',
  'public/zk/xor_repaired_verification_key.json',
];

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== '--circom' || !argv[1]) {
    throw new Error('usage: node scripts/mutations.mjs --circom PATH');
  }
  return resolve(argv[1]);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
}

function browserCheck(expectPass) {
  const cli = join(ROOT, 'node_modules/@playwright/test/cli.js');
  const result = run(process.execPath, [
    cli,
    'test',
    'e2e/constraint-gap.spec.ts',
    '--grep',
    TEST_TITLE,
    '--workers=1',
    '--reporter=list',
  ]);
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  assert.match(output, /actual weak relation proves the explicit phantom output/, 'owning test did not run');
  assert.doesNotMatch(
    output,
    /browserType\.launch|Process from config\.webServer was not able to start/,
    'environment failure cannot count as a mutation result',
  );
  if (expectPass) {
    assert.equal(result.status, 0, `clean owning test failed:\n${output}`);
    assert.match(output, /1 passed/, 'clean result did not report one passing owning test');
  } else {
    assert.notEqual(result.status, 0, 'constraint-removal mutant survived the owning test');
    assert.match(output, /1 failed/, 'mutant failure summary was not present');
    assert.match(
      output,
      /repaired-rejected-phantom/,
      'failure was not the repaired-relation learner claim',
    );
  }
  return output;
}

async function main() {
  const circom = parseArguments(process.argv.slice(2));
  const compiler = await lstat(circom);
  assert.equal(compiler.isFile(), true, 'Circom compiler is not a regular file');

  const snapshots = new Map();
  for (const name of TARGETS) {
    const path = join(ROOT, name);
    assert.equal((await lstat(path)).isFile(), true, `${name} is not a regular file`);
    snapshots.set(name, await readFile(path));
  }
  const source = snapshots.get(TARGETS[0]).toString('utf8');
  assert.equal(source.split(CONSTRAINTS).length, 2, 'expected repaired constraint block exactly once');

  browserCheck(true);
  process.stdout.write('baseline: unmutated copy PASSES\n');

  let mutationCaught = false;
  try {
    await writeFile(join(ROOT, TARGETS[0]), source.replace(CONSTRAINTS, MUTANT));
    assert.notEqual(
      sha256(await readFile(join(ROOT, TARGETS[0]))),
      sha256(snapshots.get(TARGETS[0])),
      'mutation produced no source diff',
    );

    const build = run(process.execPath, [
      join(ROOT, 'scripts/build-xor-artifacts.mjs'),
      '--circom',
      circom,
      '--out',
      join(ROOT, 'public/zk'),
      '--circuit',
      'xor_repaired',
      '--reuse-ptau',
      join(ROOT, 'public/zk/xor_phase2.ptau'),
    ]);
    assert.equal(
      build.status,
      0,
      `mutated circuit/artifact regeneration failed:\n${build.stdout ?? ''}\n${build.stderr ?? ''}`,
    );
    for (const name of TARGETS.slice(1)) {
      assert.notEqual(
        sha256(await readFile(join(ROOT, name))),
        sha256(snapshots.get(name)),
        `mutation produced no ${name} diff`,
      );
    }
    browserCheck(false);
    mutationCaught = true;
    process.stdout.write('caught: removing both binary constraints makes the owning browser claim fail\n');
  } finally {
    for (const [name, contents] of snapshots) await writeFile(join(ROOT, name), contents);
    for (const [name, contents] of snapshots) {
      assert.equal(
        sha256(await readFile(join(ROOT, name))),
        sha256(contents),
        `byte restoration failed for ${name}`,
      );
    }
  }

  assert.equal(mutationCaught, true, 'focused constraint-removal mutation was not caught');
  browserCheck(true);
  process.stdout.write('restored baseline PASSES\n');
  process.stdout.write('all 1 mutation(s) caught\n');
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
