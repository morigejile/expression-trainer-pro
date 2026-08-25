const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const committedExampleRoot = path.join(repositoryRoot, 'benchmark', 'datasets', 'example');
const committedExampleManifestPath = path.join(committedExampleRoot, 'manifest.json');
const committedExampleAudioPath = path.join(committedExampleRoot, 'audio', 'synthetic-1khz-16k.wav');
const committedExampleManifest = JSON.parse(fs.readFileSync(committedExampleManifestPath, 'utf8'));
const fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-benchmark-'));

function createDatasetRoot(name = 'dataset') {
  const root = path.join(fixtureParent, name);
  const audioPath = path.join(root, 'audio', 'synthetic.wav');
  fs.mkdirSync(path.dirname(audioPath), { recursive: true });
  fs.copyFileSync(committedExampleAudioPath, audioPath);
  return { root, audioPath };
}

function createValidManifest(audioFile = 'audio/synthetic.wav') {
  const manifest = structuredClone(committedExampleManifest);
  manifest.datasetId = 'synthetic-test-dataset';
  manifest.samples[0].audioFile = audioFile;
  manifest.samples[0].sha256 = crypto.createHash('sha256').update(fs.readFileSync(committedExampleAudioPath)).digest('hex');
  return manifest;
}

function assertInvalid(manifest, root, expectedMessage) {
  const { validateDatasetManifest } = require('../benchmark/lib/dataset-manifest');
  assert.throws(() => validateDatasetManifest(manifest, { datasetRoot: root }), expectedMessage);
}

test.after(() => fs.rmSync(fixtureParent, { recursive: true, force: true }));

test('committed synthetic example is a valid 16 kHz mono PCM dataset sample', () => {
  const { loadDatasetManifest } = require('../benchmark/lib/dataset-manifest');
  const result = loadDatasetManifest(committedExampleManifestPath, { datasetRoot: committedExampleRoot });
  assert.equal(result.samples[0].id, 'synthetic-1khz-16k');
  assert.equal(fs.statSync(committedExampleAudioPath).size, 32044);
});

test('dataset manifest accepts a valid relative audio reference backed by PCM WAV bytes', () => {
  const { root } = createDatasetRoot('valid');
  const { validateDatasetManifest } = require('../benchmark/lib/dataset-manifest');
  assert.equal(validateDatasetManifest(createValidManifest(), { datasetRoot: root }).samples[0].id, 'synthetic-1khz-16k');
});

test('dataset manifest rejects an absolute audio path', () => {
  const { root } = createDatasetRoot('absolute');
  assertInvalid(createValidManifest('C:\\recordings\\person.wav'), root, /audioFile must be relative/);
});

test('dataset manifest rejects a source without consent', () => {
  const { root } = createDatasetRoot('consent');
  const invalid = createValidManifest();
  delete invalid.samples[0].source.consent;
  assertInvalid(invalid, root, /source\.consent/);
});

test('dataset manifest rejects a wrong lowercase digest and a modified audio file', () => {
  const first = createDatasetRoot('wrong-digest');
  const wrongDigest = createValidManifest();
  wrongDigest.samples[0].sha256 = '0'.repeat(64);
  assertInvalid(wrongDigest, first.root, /sha256 does not match audioFile/);
  const second = createDatasetRoot('modified-audio');
  fs.appendFileSync(second.audioPath, Buffer.from([0]));
  assertInvalid(createValidManifest(), second.root, /sha256 does not match audioFile/);
});

test('dataset manifest rejects unknown keys at every schema object boundary', () => {
  const { root } = createDatasetRoot('unknown-keys');
  const topLevel = createValidManifest();
  topLevel.unexpected = true;
  assertInvalid(topLevel, root, /manifest contains unsupported key: unexpected/);
  const sample = createValidManifest();
  sample.samples[0].unexpected = true;
  assertInvalid(sample, root, /samples\[0\] contains unsupported key: unexpected/);
  const source = createValidManifest();
  source.samples[0].source.unexpected = true;
  assertInvalid(source, root, /source contains unsupported key: unexpected/);
});

test('dataset manifest rejects whitespace-only strings and invalid source declarations', () => {
  const { root } = createDatasetRoot('source-rules');
  const blankTranscript = createValidManifest();
  blankTranscript.samples[0].transcript = '   ';
  assertInvalid(blankTranscript, root, /transcript/);
  const wrongConsent = createValidManifest();
  wrongConsent.samples[0].source.consent = 'recorded';
  assertInvalid(wrongConsent, root, /synthetic source requires source\.consent to be not-required/);
  const invalidLicense = createValidManifest();
  invalidLicense.samples[0].source.license = 'unreviewed-license';
  assertInvalid(invalidLicense, root, /source\.license must be a supported SPDX identifier or project-local label/);
});

test('dataset manifest accepts an explicitly namespaced project-local participant license', () => {
  const { root } = createDatasetRoot('project-license');
  const participant = createValidManifest();
  participant.samples[0].source = { kind: 'participant', license: 'project-local:participant-consent-v1', consent: 'recorded', redistribution: 'metadata-only' };
  const { validateDatasetManifest } = require('../benchmark/lib/dataset-manifest');
  assert.equal(validateDatasetManifest(participant, { datasetRoot: root }).samples.length, 1);
});

test('dataset manifest rejects malformed PCM WAV data and manifest metadata mismatches', () => {
  const malformed = createDatasetRoot('malformed-wav');
  const bytes = fs.readFileSync(malformed.audioPath);
  bytes.write('RIFX', 0);
  fs.writeFileSync(malformed.audioPath, bytes);
  const malformedManifest = createValidManifest();
  malformedManifest.samples[0].sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  assertInvalid(malformedManifest, malformed.root, /RIFF WAVE PCM/);
  const sampleRate = createDatasetRoot('sample-rate');
  const wrongSampleRate = createValidManifest();
  wrongSampleRate.samples[0].sampleRateHz = 44100;
  assertInvalid(wrongSampleRate, sampleRate.root, /sampleRateHz does not match WAV/);
  const channels = createDatasetRoot('channels');
  const wrongChannels = createValidManifest();
  wrongChannels.samples[0].channels = 2;
  assertInvalid(wrongChannels, channels.root, /channels does not match WAV/);
  const duration = createDatasetRoot('duration');
  const wrongDuration = createValidManifest();
  wrongDuration.samples[0].durationMs = 999;
  assertInvalid(wrongDuration, duration.root, /durationMs does not match WAV/);
});

test('dataset manifest rejects a file symlink that escapes the canonical dataset root', (t) => {
  const { root } = createDatasetRoot('file-symlink');
  const outsidePath = path.join(fixtureParent, 'outside-file.wav');
  fs.copyFileSync(committedExampleAudioPath, outsidePath);
  try {
    fs.symlinkSync(outsidePath, path.join(root, 'audio', 'escape.wav'), 'file');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip(`file symlink creation is unavailable on this Windows host: ${error.code}`);
      return;
    }
    throw error;
  }
  assertInvalid(createValidManifest('audio/escape.wav'), root, /canonical datasetRoot/);
});

test('dataset manifest rejects a directory junction that escapes the canonical dataset root', () => {
  const { root } = createDatasetRoot('directory-junction');
  const outsideDir = path.join(fixtureParent, 'outside-directory');
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.copyFileSync(committedExampleAudioPath, path.join(outsideDir, 'synthetic.wav'));
  fs.symlinkSync(outsideDir, path.join(root, 'audio', 'escape'), 'junction');
  assertInvalid(createValidManifest('audio/escape/synthetic.wav'), root, /canonical datasetRoot/);
});

test('manifest schema and executable contract expose the same fixed object keys', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'benchmark', 'datasets', 'manifest.schema.json'), 'utf8'));
  assert.deepEqual(Object.keys(schema.properties).sort(), ['datasetId', 'datasetVersion', 'samples', 'schemaVersion']);
  assert.deepEqual(Object.keys(schema.$defs.sample.properties).sort(), ['audioFile', 'channels', 'durationMs', 'id', 'locale', 'sampleRateHz', 'sha256', 'source', 'tags', 'transcript']);
  assert.deepEqual(Object.keys(schema.$defs.source.properties).sort(), ['consent', 'kind', 'license', 'redistribution']);
  assert.equal(schema.properties.datasetId.pattern, '\\S');
  assert.equal(schema.$defs.source.properties.license.anyOf[1].pattern, '^project-local:[a-z0-9][a-z0-9.-]*$');
  assert.equal(schema.$defs.source.allOf[0].if.properties.kind.const, 'synthetic');
});

test('loadDatasetManifest reads and validates a JSON manifest from disk', () => {
  const { root } = createDatasetRoot('load');
  const manifestPath = path.join(root, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(createValidManifest()));
  const { loadDatasetManifest } = require('../benchmark/lib/dataset-manifest');
  assert.equal(loadDatasetManifest(manifestPath, { datasetRoot: root }).datasetId, 'synthetic-test-dataset');
});
