const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, before, test } = require('node:test');

const contextPath = path.resolve(__dirname, '../src/context.js');
const botPath = path.resolve(__dirname, '../src/bot.js');
const context = require(contextPath);
let fixtureRoot;
let validRepoPath;

function createValidRepo(target) {
  for (const artifact of context.REQUIRED_ARTIFACTS) {
    const artifactPath = path.join(target, artifact);
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, `fixture for ${artifact}\n`);
  }
}

before(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'demerzel-context-'));
  validRepoPath = path.join(fixtureRoot, 'valid');
  createValidRepo(validRepoPath);
});

after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

test('importing context has no process-level validation side effect', () => {
  const missingRepo = path.join(fixtureRoot, 'missing-import-target');
  const result = spawnSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(contextPath)}); process.stdout.write('imported')`],
    {
      encoding: 'utf8',
      env: { ...process.env, DEMERZEL_REPO_PATH: missingRepo },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'imported');
});

test('accepts a repo containing every required governance artifact', () => {
  assert.equal(typeof context.validateDemerzelPath, 'function');
  assert.deepEqual(context.validateDemerzelPath(validRepoPath), {
    ok: true,
    resolvedPath: path.resolve(validRepoPath),
    missingArtifacts: [],
    message: `[demerzel-bot] Demerzel repo validated at: ${path.resolve(validRepoPath)}`,
  });
});

test('rejects a missing Demerzel repo with an actionable message', () => {
  const missingRepo = path.join(fixtureRoot, 'missing-repo');
  const result = context.validateDemerzelPath(missingRepo);

  assert.equal(result.ok, false);
  assert.equal(result.resolvedPath, path.resolve(missingRepo));
  assert.deepEqual(result.missingArtifacts, []);
  assert.match(result.message, /Demerzel repo not found/);
  assert.match(result.message, /DEMERZEL_REPO_PATH/);
});

test('bot startup fails closed before loading the runtime', () => {
  const missingRepo = path.join(fixtureRoot, 'missing-startup-repo');
  const result = spawnSync(process.execPath, [botPath], {
    encoding: 'utf8',
    env: { ...process.env, DEMERZEL_REPO_PATH: missingRepo },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Demerzel repo not found/);
  assert.match(result.stderr, /DEMERZEL_REPO_PATH/);
  assert.doesNotMatch(result.stderr, /MODULE_NOT_FOUND/);
});

for (const missingArtifact of [
  'constitutions/default.constitution.md',
  'constitutions/asimov.constitution.md',
  'constitutions/demerzel-mandate.md',
]) {
  test(`rejects a repo missing ${missingArtifact}`, () => {
    const incompleteRepo = path.join(
      fixtureRoot,
      `missing-${path.basename(missingArtifact, path.extname(missingArtifact))}`,
    );

    if (!context.REQUIRED_ARTIFACTS) {
      assert.fail('context.js must export REQUIRED_ARTIFACTS');
    }
    createValidRepo(incompleteRepo);
    fs.rmSync(path.join(incompleteRepo, missingArtifact));

    const result = context.validateDemerzelPath(incompleteRepo);
    assert.equal(result.ok, false);
    assert.deepEqual(result.missingArtifacts, [missingArtifact]);
    assert.match(result.message, new RegExp(missingArtifact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(result.message, /git pull/);
  });
}
