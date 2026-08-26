const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const syntheticWav = path.join(repositoryRoot, 'benchmark', 'datasets', 'example', 'audio', 'synthetic-1khz-16k.wav');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function createExternalDataset() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-assisted-review-'));
  const audioDirectory = path.join(root, 'audio');
  const intakeDirectory = path.join(root, 'intake');
  fs.mkdirSync(audioDirectory, { recursive: true });
  fs.mkdirSync(intakeDirectory, { recursive: true });
  const audioPath = path.join(audioDirectory, 'candidate.wav');
  fs.copyFileSync(syntheticWav, audioPath);
  const audioBytes = fs.readFileSync(audioPath);
  const intake = {
    schemaVersion: 1,
    source: { sourceRevision: 'gcs-generation-1650974174867084' },
    samples: [{
      id: 'fleurs-cmn-hans-cn-dev-synthetic',
      audioFile: 'audio/candidate.wav',
      sha256: sha256(audioBytes),
      sampleRateHz: 16000,
      channels: 1,
      durationMs: 1000,
      transcript: '上游草稿',
      transcriptStatus: 'upstream-draft',
      reviewStatus: 'pending'
    }]
  };
  const intakePath = path.join(intakeDirectory, 'inventory.json');
  fs.writeFileSync(intakePath, `${JSON.stringify(intake)}\n`, 'utf8');
  return { root, intakePath, intakeRelativePath: 'intake/inventory.json', audioPath, audioBytes };
}

test('canonicalJson rejects values that cannot form canonical JSON evidence', () => {
  const { canonicalJson } = require('../benchmark/lib/assisted-review-storage');
  const cyclic = {};
  cyclic.self = cyclic;
  for (const value of [undefined, NaN, Infinity, () => {}, Symbol('value'), 1n, new Date(), cyclic]) {
    assert.throws(() => canonicalJson(value), /canonical JSON|plain object|finite/i);
  }
});

test('readBoundPcmCandidate seals sorted, hash-bound candidate evidence', () => {
  const fixture = createExternalDataset();
  try {
    const { canonicalJson, readBoundPcmCandidate } = require('../benchmark/lib/assisted-review-storage');
    assert.equal(canonicalJson({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}');

    const result = readBoundPcmCandidate({
      datasetRoot: fixture.root,
      intakePath: fixture.intakeRelativePath,
      candidateId: 'fleurs-cmn-hans-cn-dev-synthetic'
    });

    assert.equal(result.binding.candidateId, 'fleurs-cmn-hans-cn-dev-synthetic');
    assert.equal(result.binding.audioFile, 'audio/candidate.wav');
    assert.equal(result.binding.audioSha256, sha256(fixture.audioBytes));
    assert.equal(result.binding.upstreamDraftSha256, sha256(Buffer.from('上游草稿', 'utf8')));
    assert.match(result.binding.bindingSha256, /^[a-f0-9]{64}$/);
    assert.equal(result.bytes.equals(fixture.audioBytes), true);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('storage confines relative intake and create-new evidence writes', (t) => {
  const fixture = createExternalDataset();
  try {
    const { readBoundPcmCandidate, resolveContained, writeCreateNewJson } = require('../benchmark/lib/assisted-review-storage');
    assert.throws(() => resolveContained(fixture.root, '../outside.json', { mustExist: false }), /relative|escape/i);
    assert.throws(
      () => readBoundPcmCandidate({ datasetRoot: fixture.root, intakePath: fixture.intakePath, candidateId: 'fleurs-cmn-hans-cn-dev-synthetic' }),
      /relative/i
    );

    const outputDirectory = path.join(fixture.root, 'assisted-review');
    fs.mkdirSync(outputDirectory);
    const writeRequest = { datasetRoot: fixture.root, relativePath: 'assisted-review/binding.json', value: { record: 'first' } };
    writeCreateNewJson(writeRequest);
    assert.throws(() => writeCreateNewJson(writeRequest), /EEXIST/);
    assert.throws(
      () => writeCreateNewJson({ datasetRoot: fixture.root, relativePath: path.join(outputDirectory, 'absolute.json'), value: { record: 'absolute' } }),
      /relative/i
    );
    assert.throws(
      () => writeCreateNewJson({ datasetRoot: fixture.root, relativePath: '../outside.json', value: { record: 'escape' } }),
      /relative|escape/i
    );

    const outsideOutputDirectory = path.join(path.dirname(fixture.root), 'assisted-review-output-outside');
    fs.mkdirSync(outsideOutputDirectory);
    const outputLink = path.join(fixture.root, 'linked-output');
    try {
      fs.symlinkSync(outsideOutputDirectory, outputLink, 'junction');
      assert.throws(
        () => writeCreateNewJson({ datasetRoot: fixture.root, relativePath: 'linked-output/binding.json', value: { record: 'linked' } }),
        /escape|contain/i
      );
    } catch (error) {
      if (error.code === 'EPERM') t.skip('directory junction creation is unavailable on this Windows host');
      else throw error;
    } finally {
      fs.rmSync(outsideOutputDirectory, { recursive: true, force: true });
    }

    fs.appendFileSync(fixture.audioPath, Buffer.from([0]));
    assert.throws(
      () => readBoundPcmCandidate({ datasetRoot: fixture.root, intakePath: fixture.intakeRelativePath, candidateId: 'fleurs-cmn-hans-cn-dev-synthetic' }),
      /sha-?256|hash/i
    );

    const outside = path.join(path.dirname(fixture.root), 'assisted-review-outside.wav');
    fs.copyFileSync(syntheticWav, outside);
    const linkPath = path.join(fixture.root, 'audio', 'escape.wav');
    try {
      fs.symlinkSync(outside, linkPath, 'file');
    } catch (error) {
      if (error.code === 'EPERM') t.skip('file symlink creation is unavailable on this Windows host');
      else throw error;
    }
    if (fs.existsSync(linkPath)) {
      assert.throws(() => resolveContained(fixture.root, 'audio/escape.wav', { mustExist: true }), /escape|contain/i);
    }
    fs.rmSync(outside, { force: true });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('readStableFile rejects a canonical path whose file identity changes after open', () => {
  const fixture = createExternalDataset();
  const replacement = path.join(fixture.root, 'audio', 'replacement.wav');
  fs.copyFileSync(syntheticWav, replacement);
  const originalRealpath = fs.realpathSync.native;
  try {
    const { readStableFile, sameFileIdentity } = require('../benchmark/lib/assisted-review-storage');
    assert.equal(sameFileIdentity({ dev: 1, ino: 2, size: 10, birthtimeMs: 1 }, { dev: 1, ino: 3, size: 10, birthtimeMs: 1 }), false);
    assert.equal(sameFileIdentity({ dev: 0, ino: 0, size: 10, birthtimeMs: 1 }, { dev: 0, ino: 0, size: 10, birthtimeMs: 1 }), true);
    fs.realpathSync.native = (value) => path.resolve(value) === fixture.audioPath ? replacement : originalRealpath(value);
    assert.throws(() => readStableFile(fixture.audioPath, fixture.root), /changed/i);
  } finally {
    fs.realpathSync.native = originalRealpath;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('readStableFile enforces maxBytes from the opened descriptor before allocation', () => {
  const fixture = createExternalDataset();
  try {
    const { readStableFile } = require('../benchmark/lib/assisted-review-storage');
    assert.throws(() => readStableFile(fixture.audioPath, fixture.root, { maxBytes: 1 }), /maximum size/i);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});
