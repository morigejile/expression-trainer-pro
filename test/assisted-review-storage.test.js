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
  return { root, intakePath, audioPath, audioBytes };
}

test('readBoundPcmCandidate seals sorted, hash-bound candidate evidence', () => {
  const fixture = createExternalDataset();
  try {
    const { canonicalJson, readBoundPcmCandidate } = require('../benchmark/lib/assisted-review-storage');
    assert.equal(canonicalJson({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}');

    const result = readBoundPcmCandidate({
      datasetRoot: fixture.root,
      intakePath: fixture.intakePath,
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

test('storage rejects escaping, modified, and duplicate external evidence writes', (t) => {
  const fixture = createExternalDataset();
  try {
    const { readBoundPcmCandidate, resolveContained, writeCreateNewJson } = require('../benchmark/lib/assisted-review-storage');
    assert.throws(() => resolveContained(fixture.root, '../outside.json', { mustExist: false }), /relative|escape/i);
    assert.throws(() => resolveContained(fixture.root, fixture.intakePath, { mustExist: true }), /relative|absolute/i);

    const outputDirectory = path.join(fixture.root, 'assisted-review');
    fs.mkdirSync(outputDirectory);
    const outputPath = path.join(outputDirectory, 'binding.json');
    writeCreateNewJson(outputPath, { record: 'first' });
    assert.throws(() => writeCreateNewJson(outputPath, { record: 'second' }), /EEXIST/);

    fs.appendFileSync(fixture.audioPath, Buffer.from([0]));
    assert.throws(
      () => readBoundPcmCandidate({ datasetRoot: fixture.root, intakePath: fixture.intakePath, candidateId: 'fleurs-cmn-hans-cn-dev-synthetic' }),
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
