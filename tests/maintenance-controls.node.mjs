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
  // Both step shapes, because workflows here use both: `- uses: x@sha`, and a
  // step that opens with `- id:` or `- name:` carrying `uses:` on its own line.
  // Anchored on `- uses:` alone this control could not see the deploy step at
  // all -- the one action that publishes the site -- so unpinning
  // actions/deploy-pages back to @v5 left every control green. Measured.
  const actions = [...workflow.matchAll(/^[ \t]*(?:-[ \t]+)?uses:[ \t]+([^@\s]+)@([^\s]+)/gm)];
  // A declared denominator. Every `uses:` line present must be a `uses:` line
  // parsed, so a step in a shape this pattern cannot read fails here instead
  // of passing unseen -- which is how the hole above stayed quiet.
  const present = workflow.match(/^[ \t]*(?:-[ \t]+)?uses:/gm) ?? [];
  assert.equal(actions.length, present.length,
    `${present.length - actions.length} uses: line(s) this control cannot read`);

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

test('the auto-merge path reads the bump type from the pull request and fails closed', async () => {
  // This repository keeps no third-party action in the merge path, so the bump
  // type is derived from the pull request's own text by an in-repo script and
  // the merge step is gated on its answer.
  const autoMerge = job('dependabot-auto-merge');
  assert.match(autoMerge, /\.github\/scripts\/bump-type\.mjs/,
    'the job must read the bump type from the in-repo script');
  assert.match(autoMerge, /if:\s*steps\.bump\.outputs\.bump\s*==\s*'non-major'/,
    'the merge step must run only for a non-major bump');
  const { bumpType } = await import('../.github/scripts/bump-type.mjs');
  // Fails closed, which is the property that matters: anything it cannot read
  // is 'unknown', and 'unknown' does not merge.
  assert.equal(bumpType({ title: 'Bump the npm group across 1 directory', body: 'no versions here' }), 'unknown');
  assert.equal(bumpType({ title: 'a retitled pull request', body: 'prose only' }), 'unknown');
  assert.equal(bumpType({ title: 'Bump x from 1.2.3 to 2.0.0', body: undefined }), 'unknown', 'a missing body must not merge');
  assert.equal(bumpType({ title: 'Bump x from one to two', body: 'b' }), 'unknown');
  // And it still answers the two readable cases.
  assert.equal(bumpType({ title: 'Bump vitest from 5.0.5 to 5.1.0', body: 'b' }), 'non-major');
  assert.equal(bumpType({ title: 'Bump next from 15.5.27 to 16.4.2', body: 'b' }), 'major');
  assert.equal(bumpType({ title: 'Bump zod from 0.4.1 to 0.5.0', body: 'b' }), 'major', '0.x minor is breaking');
});
