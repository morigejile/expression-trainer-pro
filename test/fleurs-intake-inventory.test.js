const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const syntheticWav = path.join(repositoryRoot, 'benchmark', 'datasets', 'example', 'audio', 'synthetic-1khz-16k.wav');

test('FLEURS intake inventory preserves relative paths and pending upstream-draft review state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-fleurs-intake-'));
  try {
    const audioDirectory = 'fleurs-cmn-hans-cn-dev/audio';
    const destination = path.join(root, ...audioDirectory.split('/'));
    fs.mkdirSync(destination, { recursive: true });
    const rows = Array.from({ length: 50 }, (_, index) => {
      const number = index + 1;
      const fileName = `sample-${number}.wav`;
      fs.copyFileSync(syntheticWav, path.join(destination, fileName));
      return `shared-sentence\t${fileName}\t第${number}条上游原文。\t第${number}条规范文本。\tignored\t16000\tfemale`;
    });

    const { createFleursIntakeInventory } = require('../benchmark/scripts/generate-fleurs-intake-inventory');
    const inventory = createFleursIntakeInventory({
      tsvText: rows.join('\n'),
      datasetRoot: root,
      audioDirectory,
      maxSamples: 50,
      source: {
        publisher: 'Google FLEURS',
        dataset: 'google/fleurs',
        locale: 'cmn_hans_cn',
        license: 'CC-BY-4.0',
        archiveGeneration: '1650974174867084',
        archiveSha256: 'a'.repeat(64),
        archiveBytes: 2522990658
      }
    });

    const expectedSha256 = crypto.createHash('sha256').update(fs.readFileSync(syntheticWav)).digest('hex');
    assert.equal(inventory.samples.length, 50);
    assert.equal(inventory.samples[0].id, 'fleurs-cmn-hans-cn-dev-sample-1');
    assert.equal(inventory.samples[0].audioFile, 'fleurs-cmn-hans-cn-dev/audio/sample-1.wav');
    assert.equal(inventory.samples[0].sha256, expectedSha256);
    assert.equal(inventory.samples[0].transcript, '第1条规范文本。');
    assert.equal(inventory.samples[0].transcriptStatus, 'upstream-draft');
    assert.equal(inventory.samples[0].reviewStatus, 'pending');
    assert.deepEqual(inventory.samples[0].observedStrata, ['mandarin']);
    assert.deepEqual(inventory.selection.unobservedRequiredStrata, [
      'code-switch', 'fast', 'light-accent', 'light-noise', 'numbers-names', 'slow'
    ]);
    assert.equal(inventory.samples[0].sampleRateHz, 16000);
    assert.equal(inventory.samples[0].channels, 1);
    assert.equal(inventory.samples[0].durationMs, 1000);
    assert.equal(JSON.stringify(inventory).includes(root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
