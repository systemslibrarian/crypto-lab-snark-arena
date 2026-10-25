import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const workflow = readFileSync(new URL('.github/workflows/deploy.yml', root), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const index = readFileSync(new URL('index.html', root), 'utf8');
const provenance = readFileSync(new URL('scripts/verify-cubic-wasm.py', root), 'utf8');
const artifactChecker = readFileSync(new URL('scripts/check-zk-artifacts.mjs', root), 'utf8');
const mutations = readFileSync(new URL('scripts/mutations.mjs', root), 'utf8');

function job(name) {
  const match = workflow.match(new RegExp(`\\n  ${name}:\\n[\\s\\S]*?(?=\\n  [a-z][a-z0-9-]*:\\n|$)`));
  assert.ok(match, `missing ${name} job`);
  return match[0];
}

test('pull-request builds cannot mint Pages credentials', () => {
  const workflowHeader = workflow.slice(0, workflow.indexOf('\njobs:'));
  assert.match(workflowHeader, /permissions:\n  contents: read\n/);
  assert.doesNotMatch(workflowHeader, /pages: write|id-token: write/);

  const build = job('build');
  assert.doesNotMatch(build, /pages: write|id-token: write/);

  const deploy = job('deploy');
  assert.match(deploy, /permissions:\n      contents: read\n      pages: write\n      id-token: write\n/);
});

test('Pages-only steps cannot run for pull requests', () => {
  assert.match(
    workflow,
    /- name: Upload Pages artifact\n        if: github\.event_name != 'pull_request'\n        uses:/,
  );
  assert.match(job('deploy'), /if: github\.event_name != 'pull_request'/);
});

test('every action is pinned to an immutable commit', () => {
  const actions = [...workflow.matchAll(/^\s*-\s+uses:\s+([^@\s]+)@([^\s]+)/gm)];
  assert.ok(actions.length > 0, 'workflow has no actions');
  for (const [, action, reference] of actions) {
    assert.match(reference, /^[0-9a-f]{40}$/, `${action} is not commit-pinned`);
  }
});

test('the post-merge deployment dispatch stays direct and fail-closed', () => {
  const autoMerge = job('dependabot-auto-merge');
  assert.doesNotMatch(autoMerge, /dependabot\/fetch-metadata/);
  assert.match(autoMerge, /gh workflow run deploy\.yml --repo "\$GITHUB_REPOSITORY" --ref main/);
  assert.doesNotMatch(autoMerge, /\|\|\s*(?:echo|true)|continue-on-error/);
});

test('the build path runs typechecking and this maintenance gate', () => {
  assert.equal(packageJson.scripts['test:maintenance'], 'node --test tests/maintenance-controls.node.mjs');
  assert.match(packageJson.scripts.build, /npm run typecheck/);
  assert.match(packageJson.scripts.build, /npm run test:maintenance/);
});

test('the hosted gate binds actual XOR artifacts and runs the focused mutation', () => {
  assert.equal(
    packageJson.scripts['test:mutations'],
    'node scripts/mutations.mjs --circom zkbuild/circom',
  );
  const build = job('build');
  assert.match(
    build,
    /python3 scripts\/verify-cubic-wasm\.py --compiler-output zkbuild\/circom/,
  );
  assert.match(build, /npm run test:mutations/);
  assert.match(
    build,
    /build-xor-artifacts\.mjs --circom zkbuild\/circom --out zkbuild\/xor-regeneration-smoke --circuit all/,
  );
  assert.ok(
    build.indexOf('verify-cubic-wasm.py') < build.indexOf('npm run test:mutations'),
    'the authenticated compiler must exist before mutation regeneration',
  );
  assert.doesNotMatch(build, /continue-on-error/);
});

test('provenance and mutation checks fail closed on the repaired relation', () => {
  assert.match(provenance, /xor_weak/);
  assert.match(provenance, /xor_repaired/);
  assert.match(provenance, /check-zk-artifacts\.mjs/);
  assert.match(artifactChecker, /zKey\.verifyFromR1cs/);
  assert.match(artifactChecker, /powersOfTau\.verify/);
  assert.match(artifactChecker, /weakPhantomSignals/);
  assert.match(artifactChecker, /proofElementSwapRejected/);
  assert.match(artifactChecker, /repairedPhantomRejected/);
  assert.match(mutations, /a \* \(a - 1\) === 0/);
  assert.match(mutations, /b \* \(b - 1\) === 0/);
  assert.match(mutations, /baseline: unmutated copy PASSES/);
  assert.match(mutations, /all 1 mutation\(s\) caught/);
  assert.match(mutations, /byte restoration failed/);
});

test('the first skip link points to the real main-content target', () => {
  assert.match(index, /<a class="cl-skip-link" href="#main-content">/);
  assert.doesNotMatch(index, /class="cl-skip-link" href="#app"/);
  assert.match(index, /<main[^>]+id="main-content"/);
});
