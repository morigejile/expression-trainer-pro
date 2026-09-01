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
    {schemaVersion: 1, acknowledged: false}
  );
  const saved = acknowledgeRecordingPolicy('C:\\user-data', {
    fsImpl: fakeFs(),
    atomicWrite
  });

  assert.deepEqual(saved, {schemaVersion: 1, acknowledged: true});
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
    {schemaVersion: 1, acknowledged: false}
  );
  assert.deepEqual(writes, []);
});

test('acknowledging refuses to overwrite a future recording policy schema', () => {
  const filePath = path.join('C:\\user-data', 'recording-policy.json');

  assert.throws(
    () => acknowledgeRecordingPolicy('C:\\user-data', {
      fsImpl: fakeFs({[filePath]: '{"schemaVersion":2,"acknowledged":false}'}),
      atomicWrite() {}
    }),
    error => error.code === 'unsupported-schema-version'
  );
});
