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

function createFixture(sampleCount = 1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-cli-'));
  for (const directory of ['intake', 'audio', 'review', 'frozen', 'working']) {
    fs.mkdirSync(path.join(root, directory));
  }
  const wavBytes = fs.readFileSync(syntheticWav);
  const samples = Array.from({ length: sampleCount }, (_, index) => {
    const number = index + 1;
    const fileName = `sample-${number}.wav`;
    fs.writeFileSync(path.join(root, 'audio', fileName), wavBytes);
    return {
      id: `fleurs-cmn-hans-cn-dev-sample-${number}`,
      audioFile: `audio/${fileName}`,
      sha256: sha256(wavBytes),
      sampleRateHz: 16000,
      channels: 1,
      durationMs: 1000,
      locale: 'zh-CN',
      observedStrata: ['mandarin'],
      transcript: `第 ${number} 条上游草稿`,
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
  fs.writeFileSync(path.join(root, 'intake', 'inventory.json'), `${JSON.stringify(intake)}\n`, 'utf8');
  return { root, intake };
}

function commandArgs(root, command, extra = []) {
  return [command, '--dataset-root', root, '--intake', 'intake/inventory.json', ...extra];
}

test('parseInternalDatasetArgs rejects ambiguous flags and non-portable evidence paths', () => {
  const { parseInternalDatasetArgs } = require('../benchmark/scripts/internal-benchmark-dataset');
  const fixture = createFixture();
  try {
    const parsed = parseInternalDatasetArgs(commandArgs(fixture.root, 'record-transcript', [
      '--review-root', 'review',
      '--candidate-id', fixture.intake.samples[0].id,
      '--transcript-file', 'working/transcript.txt',
      '--reviewer-alias', 'maintainer-1',
    ]));
    assert.equal(parsed.command, 'record-transcript');
    assert.equal(parsed.reviewRoot, 'review');
    assert.throws(() => parseInternalDatasetArgs([...commandArgs(fixture.root, 'validate-intake'), '--unknown', 'x']), /unknown|invalid/i);
    assert.throws(() => parseInternalDatasetArgs([...commandArgs(fixture.root, 'validate-intake'), '--intake', 'other.json']), /duplicate/i);
    assert.throws(() => parseInternalDatasetArgs(commandArgs(fixture.root, 'review-status', ['--review-root', path.join(fixture.root, 'review')])), /relative/i);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('validate-intake checks every current audio binding and requires explicit external opt-in', () => {
  const { parseInternalDatasetArgs, runInternalDatasetCommand } = require('../benchmark/scripts/internal-benchmark-dataset');
  const fixture = createFixture(3);
  try {
    const parsed = parseInternalDatasetArgs(commandArgs(fixture.root, 'validate-intake'));
    assert.throws(() => runInternalDatasetCommand(parsed, { allowExternal: false }), /ASSISTED_REVIEW_ALLOW_EXTERNAL/i);
    assert.deepEqual(runInternalDatasetCommand(parsed, { allowExternal: true }), {
      command: 'validate-intake',
      totalCount: 3,
      validCount: 3,
      failures: [],
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('record-transcript reads text from a file and review-status reports the current binding only', () => {
  const { parseInternalDatasetArgs, runInternalDatasetCommand } = require('../benchmark/scripts/internal-benchmark-dataset');
  const fixture = createFixture();
  try {
    fs.writeFileSync(path.join(fixture.root, 'working', 'transcript.txt'), '人工确认终稿\n', 'utf8');
    const statusArgs = commandArgs(fixture.root, 'review-status', ['--review-root', 'review']);
    assert.deepEqual(runInternalDatasetCommand(parseInternalDatasetArgs(statusArgs), { allowExternal: true }), {
      command: 'review-status', confirmedCount: 0, pendingCount: 1, invalidCount: 0, staleCount: 0,
      confirmed: [], pending: [fixture.intake.samples[0].id], invalid: [], stale: [],
    });

    const recordArgs = commandArgs(fixture.root, 'record-transcript', [
      '--review-root', 'review',
      '--candidate-id', fixture.intake.samples[0].id,
      '--transcript-file', 'working/transcript.txt',
      '--reviewer-alias', 'maintainer-1',
    ]);
    const recorded = runInternalDatasetCommand(parseInternalDatasetArgs(recordArgs), {
      allowExternal: true,
      now: () => '2026-08-26T09:00:00.000Z',
    });
    assert.equal(recorded.command, 'record-transcript');
    assert.equal(Object.hasOwn(recorded, 'transcriptText'), false);
    assert.match(recorded.recordSha256, /^[a-f0-9]{64}$/);

    const status = runInternalDatasetCommand(parseInternalDatasetArgs(statusArgs), { allowExternal: true });
    assert.equal(status.confirmedCount, 1);
    assert.deepEqual(status.confirmed, [fixture.intake.samples[0].id]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('freeze command selects the complete 100-sample intake without exposing selection flags', () => {
  const { readBoundPcmCandidate } = require('../benchmark/lib/assisted-review-storage');
  const { writeFinalTranscriptRecord } = require('../benchmark/lib/benchmark-dataset-freeze');
  const { parseInternalDatasetArgs, runInternalDatasetCommand } = require('../benchmark/scripts/internal-benchmark-dataset');
  const fixture = createFixture(100);
  const reviewContextSha256 = 'e'.repeat(64);
  try {
    for (const sample of fixture.intake.samples) {
      const { binding } = readBoundPcmCandidate({ datasetRoot: fixture.root, intakePath: 'intake/inventory.json', candidateId: sample.id });
      writeFinalTranscriptRecord({
        reviewRoot: path.join(fixture.root, 'review'),
        binding,
        transcriptText: `人工终稿 ${sample.id}`,
        reviewerAlias: 'maintainer-1',
        confirmedAt: '2026-08-26T09:00:00.000Z',
        reviewContextSha256,
      });
    }
    const parsed = parseInternalDatasetArgs(commandArgs(fixture.root, 'freeze', [
      '--review-root', 'review',
      '--review-pack', 'review-packs/run-a/review-pack.json',
      '--freeze-root', 'frozen',
      '--dataset-id', 'expression-zh-fleurs',
      '--dataset-version', 'v1',
    ]));
    const result = runInternalDatasetCommand(parsed, { allowExternal: true, createStore() { return {
      getSummary: () => ({ totalCount: 100, confirmedCount: 100, pendingCount: 0, invalidCount: 0, staleCount: 0 }),
      getReviewContexts: () => new Map(fixture.intake.samples.map(({ id }) => [id, reviewContextSha256])),
    }; } });
    assert.equal(result.command, 'freeze');
    assert.equal(result.selectedCount, 100);
    assert.equal(fs.existsSync(path.join(fixture.root, 'frozen', 'expression-zh-fleurs', 'v1', 'manifest.json')), true);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('freeze command rejects legacy transcripts that are not confirmed against the current prediction pack', () => {
  const { parseInternalDatasetArgs, runInternalDatasetCommand } = require('../benchmark/scripts/internal-benchmark-dataset');
  const fixture = createFixture(100);
  try {
    const parsed = parseInternalDatasetArgs(commandArgs(fixture.root, 'freeze', [
      '--review-root', 'review', '--review-pack', 'review-packs/run-a/review-pack.json', '--freeze-root', 'frozen',
      '--dataset-id', 'expression-zh-fleurs', '--dataset-version', 'v1',
    ]));
    assert.throws(() => runInternalDatasetCommand(parsed, { allowExternal: true, createStore() { return {
      getSummary: () => ({ totalCount: 100, confirmedCount: 0, pendingCount: 0, invalidCount: 0, staleCount: 100 }),
    }; } }), /100 current explicit human confirmations/i);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
