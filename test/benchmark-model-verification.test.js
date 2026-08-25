const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('verification fails closed on a hash mismatch', async (t) => {
  const { verifyCandidate } = require('../benchmark/models/verify-candidate');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-verification-'));
  const filePath = path.join(fixtureRoot, 'model.onnx');
  fs.writeFileSync(filePath, 'fixture-model');
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const candidate = {
    id: 'fixture',
    status: 'verified',
    files: [{
      relativePath: 'model.onnx',
      sha256: crypto.createHash('sha256').update('different-content').digest('hex'),
      bytes: Buffer.byteLength('fixture-model'),
      role: 'model'
    }]
  };

  await assert.rejects(
    () => verifyCandidate(candidate, fixtureRoot),
    /SHA-256 mismatch/
  );
});

test('verification reports a complete verified candidate with stable file evidence', async (t) => {
  const { verifyCandidate } = require('../benchmark/models/verify-candidate');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-verification-'));
  const filePath = path.join(fixtureRoot, 'model.onnx');
  fs.writeFileSync(filePath, 'fixture-model');
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const sha256 = crypto.createHash('sha256').update('fixture-model').digest('hex');
  const result = await verifyCandidate({
    id: 'fixture',
    status: 'verified',
    files: [{ relativePath: 'model.onnx', sha256, bytes: 13, role: 'model' }]
  }, fixtureRoot);

  assert.equal(result.valid, true);
  assert.equal(result.status, 'verified');
  assert.equal(result.totalBytes, 13);
  assert.deepEqual(result.files[0], { relativePath: 'model.onnx', bytes: 13, sha256, role: 'model' });
});

test('verification fails closed on a missing file and byte-size mismatch', async (t) => {
  const { verifyCandidate } = require('../benchmark/models/verify-candidate');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-verification-'));
  const filePath = path.join(fixtureRoot, 'model.onnx');
  fs.writeFileSync(filePath, 'fixture-model');
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const sha256 = crypto.createHash('sha256').update('fixture-model').digest('hex');
  await assert.rejects(
    () => verifyCandidate({ id: 'missing', status: 'verified', files: [{ relativePath: 'missing.onnx', sha256, bytes: 13, role: 'model' }] }, fixtureRoot),
    /missing/
  );
  await assert.rejects(
    () => verifyCandidate({ id: 'wrong-size', status: 'verified', files: [{ relativePath: 'model.onnx', sha256, bytes: 12, role: 'model' }] }, fixtureRoot),
    /Byte-size mismatch/
  );
});

test('verification reports pending candidates instead of treating them as absent', async () => {
  const { verifyCandidate } = require('../benchmark/models/verify-candidate');
  const result = await verifyCandidate({
    id: 'pending-control',
    status: 'pending',
    pending: { reason: 'artifact download incomplete', missing: ['files', 'native-load'] },
    files: []
  }, process.cwd());

  assert.deepEqual(result, {
    candidateId: 'pending-control',
    status: 'pending',
    valid: false,
    pending: { reason: 'artifact download incomplete', missing: ['files', 'native-load'] }
  });
});
