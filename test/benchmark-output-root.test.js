const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function withTempDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-output-root-'));
  return Promise.resolve(run(directory)).finally(() => fs.rmSync(directory, { recursive: true, force: true }));
}

test('formal run lock excludes a concurrent runner and never reclaims a stale lock', async () => {
  const { acquireFormalRunLock } = require('../benchmark/lib/output-root');
  await withTempDirectory(async (directory) => {
    const release = await acquireFormalRunLock(directory);
    await assert.rejects(acquireFormalRunLock(directory), /formal benchmark lock already exists/);
    await release();

    const staleLockPath = path.join(directory, '.benchmark-formal.lock');
    fs.writeFileSync(staleLockPath, '{"pid":999}');
    await assert.rejects(acquireFormalRunLock(directory), /formal benchmark lock already exists/);
    assert.equal(fs.readFileSync(staleLockPath, 'utf8'), '{"pid":999}');
  });
});
