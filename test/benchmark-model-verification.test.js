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
