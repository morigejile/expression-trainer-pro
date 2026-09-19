const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  loadRecordingPolicy,
  acknowledgeRecordingPolicy
} = require('../lib/recording-policy-store');

function fakeFs(files = {}) {
  return {
    existsSync(filePath) {
      return Object.hasOwn(files, filePath);
    },
    readFileSync(filePath) {
      return files[filePath];
    }
  };
}

test('recording policy defaults to unacknowledged and writes only the boolean flag', () => {
  const writes = [];
  const atomicWrite = (filePath, value) => writes.push({filePath, value});

  assert.deepEqual(
    loadRecordingPolicy('C:\\user-data', {fsImpl: fakeFs()}),
    {schemaVersion: 2, acknowledged: false}
  );
  const saved = acknowledgeRecordingPolicy('C:\\user-data', {
    fsImpl: fakeFs(),
    atomicWrite
  });

  assert.deepEqual(saved, {schemaVersion: 2, acknowledged: true});
  assert.equal(writes[0].filePath, path.join('C:\\user-data', 'recording-policy.json'));
  assert.deepEqual(Object.keys(writes[0].value).sort(), ['acknowledged', 'schemaVersion']);
});

test('invalid recording policy JSON falls back without overwriting the original', () => {
  const filePath = path.join('C:\\user-data', 'recording-policy.json');
  const writes = [];

  assert.deepEqual(
    loadRecordingPolicy('C:\\user-data', {
      fsImpl: fakeFs({[filePath]: '{"acknowledged":'}),
      atomicWrite: (...args) => writes.push(args),
      logger: {warn() {}}
    }),
    {schemaVersion: 2, acknowledged: false}
  );
  assert.deepEqual(writes, []);
});

test('acknowledging malformed recording policy JSON preserves the source and does not write', () => {
  const filePath = path.join('C:\\user-data', 'recording-policy.json');
  const original = '{"acknowledged":';
  const files = {[filePath]: original};
  const writes = [];

  assert.throws(
    () => acknowledgeRecordingPolicy('C:\\user-data', {
      fsImpl: fakeFs(files),
      atomicWrite: (...args) => writes.push(args)
    }),
    error => error.code === 'invalid-recording-policy-json'
  );
  assert.equal(files[filePath], original);
  assert.deepEqual(writes, []);
});

test('acknowledging refuses to overwrite a future recording policy schema', () => {
  const filePath = path.join('C:\\user-data', 'recording-policy.json');
  const original = '{"schemaVersion":3,"acknowledged":true}';
  const files = {[filePath]: original};
  const writes = [];

  assert.throws(
    () => acknowledgeRecordingPolicy('C:\\user-data', {
      fsImpl: fakeFs(files),
      atomicWrite: (...args) => writes.push(args)
    }),
    error => error.code === 'unsupported-schema-version'
  );
  assert.equal(files[filePath], original);
  assert.deepEqual(writes, []);
});

test('only the current durable-history policy acknowledgement bypasses confirmation', () => {
  const filePath = path.join('C:\\user-data', 'recording-policy.json');
  for (const [raw, acknowledged] of [
    [{schemaVersion: 1, acknowledged: true}, false],
    [{acknowledged: true}, false],
    [{schemaVersion: 2, acknowledged: true}, true],
    [{schemaVersion: 2, acknowledged: false}, false],
    [{schemaVersion: 3, acknowledged: true}, false]
  ]) {
    const original = JSON.stringify(raw);
    const files = {[filePath]: original};
    assert.deepEqual(
      loadRecordingPolicy('C:\\user-data', {fsImpl: fakeFs(files)}),
      {schemaVersion: 2, acknowledged},
      original
    );
    assert.equal(files[filePath], original);
  }
});

test('explicit confirmation upgrades an old policy and survives a subsequent load', () => {
  const filePath = path.join('C:\\user-data', 'recording-policy.json');
  const files = {[filePath]: '{"schemaVersion":1,"acknowledged":true}'};
  const fsImpl = fakeFs(files);

  acknowledgeRecordingPolicy('C:\\user-data', {
    fsImpl,
    atomicWrite(targetPath, policy) {
      files[targetPath] = JSON.stringify(policy);
    }
  });

  assert.deepEqual(JSON.parse(files[filePath]), {schemaVersion: 2, acknowledged: true});
  assert.deepEqual(loadRecordingPolicy('C:\\user-data', {fsImpl}), {
    schemaVersion: 2, acknowledged: true
  });
});
