'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const syntheticWav = path.join(repositoryRoot, 'benchmark', 'datasets', 'example', 'audio', 'synthetic-1khz-16k.wav');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createFixture(sampleCount = 3) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-freeze-'));
  const intakeDirectory = path.join(root, 'intake');
  const audioDirectory = path.join(root, 'audio');
  const reviewRoot = path.join(root, 'review');
  const freezeRoot = path.join(root, 'frozen');
  fs.mkdirSync(intakeDirectory);
  fs.mkdirSync(audioDirectory);
  fs.mkdirSync(reviewRoot);
  fs.mkdirSync(freezeRoot);
  const wavBytes = fs.readFileSync(syntheticWav);
  const samples = Array.from({ length: sampleCount }, (_, index) => {
    const number = index + 1;
    const fileName = `sample-${number}.wav`;
    fs.writeFileSync(path.join(audioDirectory, fileName), wavBytes);
    return {
      id: `fleurs-cmn-hans-cn-dev-sample-${number}`,
      audioFile: `audio/${fileName}`,
      sha256: sha256(wavBytes),
      sampleRateHz: 16000,
      channels: 1,
      durationMs: 1000,
      locale: 'zh-CN',
      observedStrata: ['mandarin'],
      transcript: `第 ${number} 条 上游 草稿`,
      transcriptStatus: 'upstream-draft',
      reviewStatus: 'pending',
    };
  });
  const intake = {
    schemaVersion: 1,
    source: {
      publisher: 'Google FLEURS',
      dataset: 'google/fleurs',
      locale: 'cmn_hans_cn',
      license: 'CC-BY-4.0',
      attribution: 'FLEURS test fixture',
      archiveUrl: 'https://example.invalid/fleurs.tar.gz',
      sourceRevision: 'fixture-revision-1',
      archiveSha256: 'a'.repeat(64),
      archiveBytes: 123,
    },
    samples,
  };
  const intakePath = path.join(intakeDirectory, 'inventory.json');
  fs.writeFileSync(intakePath, `${JSON.stringify(intake)}\n`, 'utf8');
  return { root, reviewRoot, freezeRoot, intake, intakeRelativePath: 'intake/inventory.json' };
}

function loadBinding(fixture, candidateId) {
  const { readBoundPcmCandidate } = require('../benchmark/lib/assisted-review-storage');
  return readBoundPcmCandidate({
    datasetRoot: fixture.root,
    intakePath: fixture.intakeRelativePath,
    candidateId,
  }).binding;
}

test('final transcript validation rejects a record that is not a current explicit human confirmation', () => {
  const { canonicalJson, sha256Text } = require('../benchmark/lib/assisted-review-storage');
  const { validateFinalTranscriptRecord } = require('../benchmark/lib/benchmark-dataset-freeze');
  const fixture = createFixture(1);
  try {
    const binding = loadBinding(fixture, fixture.intake.samples[0].id);
    const base = {
      schemaVersion: 1,
      candidateId: binding.candidateId,
      bindingSha256: binding.bindingSha256,
      transcriptText: '人工确认终稿',
      transcriptSha256: sha256Text('人工确认终稿'),
      transcriptLength: 6,
      humanConfirmed: true,
      reviewerAlias: 'maintainer-1',
      confirmedAt: '2026-08-26T09:00:00.000Z',
    };
    const valid = { ...base, recordSha256: sha256Text(canonicalJson(base)) };
    assert.deepEqual(validateFinalTranscriptRecord(valid, { binding }), valid);

    const cases = [
      [{ ...valid, transcriptText: '' }, /transcript/i],
      [{ ...valid, humanConfirmed: false }, /humanConfirmed/i],
      [{ ...valid, candidateId: 'different-candidate' }, /candidate/i],
      [{ ...valid, bindingSha256: 'b'.repeat(64) }, /binding/i],
      [{ ...valid, transcriptLength: 99 }, /length/i],
      [{ ...valid, transcriptSha256: 'c'.repeat(64) }, /transcript.*SHA-256/i],
      [{ ...valid, reviewerAlias: '../reviewer' }, /reviewerAlias/i],
      [{ ...valid, recordSha256: 'd'.repeat(64) }, /record.*SHA-256/i],
    ];
    for (const [record, pattern] of cases) {
      assert.throws(() => validateFinalTranscriptRecord(record, { binding }), pattern);
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('writeFinalTranscriptRecord creates one immutable record under the review root', () => {
  const { writeFinalTranscriptRecord } = require('../benchmark/lib/benchmark-dataset-freeze');
  const fixture = createFixture(1);
  try {
    const binding = loadBinding(fixture, fixture.intake.samples[0].id);
    const request = {
      reviewRoot: fixture.reviewRoot,
      binding,
      transcriptText: '人工确认终稿',
      reviewerAlias: 'maintainer-1',
      confirmedAt: '2026-08-26T09:00:00.000Z',
    };
    const result = writeFinalTranscriptRecord(request);
    assert.equal(result.relativePath, `final-transcripts/${binding.candidateId}/${binding.bindingSha256}.json`);
    assert.match(result.recordSha256, /^[a-f0-9]{64}$/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.reviewRoot, ...result.relativePath.split('/')), 'utf8')).transcriptText, '人工确认终稿');
    assert.throws(() => writeFinalTranscriptRecord(request), /exist|EEXIST/i);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('freezeReviewedDataset publishes a deterministic create-new dataset that passes the production validator', () => {
  const { loadDatasetManifest } = require('../benchmark/lib/dataset-manifest');
  const { freezeReviewedDataset, writeFinalTranscriptRecord } = require('../benchmark/lib/benchmark-dataset-freeze');
  const fixture = createFixture(3);
  try {
    for (const sample of fixture.intake.samples) {
      writeFinalTranscriptRecord({
        reviewRoot: fixture.reviewRoot,
        binding: loadBinding(fixture, sample.id),
        transcriptText: `人工终稿 ${sample.id.at(-1)}`,
        reviewerAlias: 'maintainer-1',
        confirmedAt: '2026-08-26T09:00:00.000Z',
      });
    }
    const request = {
      datasetRoot: fixture.root,
      intakePath: fixture.intakeRelativePath,
      reviewRoot: fixture.reviewRoot,
      freezeRoot: fixture.freezeRoot,
      candidateIds: fixture.intake.samples.map(({ id }) => id).reverse(),
      datasetId: 'expression-zh-fleurs',
      datasetVersion: 'v1',
      testMode: true,
      expectedSampleCount: 3,
    };
    const result = freezeReviewedDataset(request);
    assert.equal(result.selectedCount, 3);
    assert.equal(result.omittedCount, 0);
    assert.match(result.manifestSha256, /^[a-f0-9]{64}$/);
    assert.match(result.datasetSha256, /^[a-f0-9]{64}$/);
    assert.equal(path.isAbsolute(result.freezeDirectory), true);

    const manifest = loadDatasetManifest(path.join(result.freezeDirectory, 'manifest.json'), { datasetRoot: result.freezeDirectory });
    assert.deepEqual(manifest.samples.map(({ id }) => id), [...fixture.intake.samples.map(({ id }) => id)].sort());
    assert.equal(manifest.samples[0].source.license, 'CC-BY-4.0');
    assert.equal(manifest.samples[0].transcript.startsWith('人工终稿'), true);
    const reportText = fs.readFileSync(path.join(result.freezeDirectory, 'freeze-report.json'), 'utf8');
    assert.equal(reportText.includes(fixture.root), false);
    const report = JSON.parse(reportText);
    assert.equal(report.source.license, 'CC-BY-4.0');
    assert.equal(report.source.attribution, 'FLEURS test fixture');
    assert.equal(report.durationMs, 3000);
    assert.deepEqual(report.tagCoverage, { mandarin: 3 });
    assert.throws(() => freezeReviewedDataset(request), /exist|overwrite/i);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('formal freeze requires all 100 candidates and rejects a transcript bound to stale audio', () => {
  const { freezeReviewedDataset, writeFinalTranscriptRecord } = require('../benchmark/lib/benchmark-dataset-freeze');
  const fixture = createFixture(1);
  try {
    const sample = fixture.intake.samples[0];
    writeFinalTranscriptRecord({
      reviewRoot: fixture.reviewRoot,
      binding: loadBinding(fixture, sample.id),
      transcriptText: '人工终稿',
      reviewerAlias: 'maintainer-1',
      confirmedAt: '2026-08-26T09:00:00.000Z',
    });
    assert.throws(() => freezeReviewedDataset({
      datasetRoot: fixture.root,
      intakePath: fixture.intakeRelativePath,
      reviewRoot: fixture.reviewRoot,
      freezeRoot: fixture.freezeRoot,
      candidateIds: [sample.id],
      datasetId: 'expression-zh-fleurs',
      datasetVersion: 'v1',
    }), /exactly 100/i);

    fs.appendFileSync(path.join(fixture.root, ...sample.audioFile.split('/')), Buffer.from([0]));
    assert.throws(() => freezeReviewedDataset({
      datasetRoot: fixture.root,
      intakePath: fixture.intakeRelativePath,
      reviewRoot: fixture.reviewRoot,
      freezeRoot: fixture.freezeRoot,
      candidateIds: [sample.id],
      datasetId: 'expression-zh-fleurs',
      datasetVersion: 'v2',
      testMode: true,
      expectedSampleCount: 1,
    }), /SHA-256|binding|audio/i);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
