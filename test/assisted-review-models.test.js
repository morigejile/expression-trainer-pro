const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildReviewSherpaConfig,
  decodePcm16ToFloat32,
  runPredictionBundle,
  runSherpaTranscription,
  sealPredictionAttempt,
  validateModelLock,
  verifyModelRole,
} = require('../benchmark/lib/assisted-review-models');
const { canonicalJson, readBoundPcmCandidate } = require('../benchmark/lib/assisted-review-storage');
const { parseRunPredictionArgs } = require('../benchmark/scripts/run-assisted-predictions');

const repositoryRoot = path.resolve(__dirname, '..');
const syntheticWav = path.join(repositoryRoot, 'benchmark', 'datasets', 'example', 'audio', 'synthetic-1khz-16k.wav');
const ROLES = ['baseline-paraformer', 'candidate-zipformer', 'candidate-sensevoice-small'];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeModelFile(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  const bytes = fs.readFileSync(filePath);
  return { role: path.basename(relativePath, path.extname(relativePath)), relativePath, sha256: sha256(bytes), bytes: bytes.length };
}

function file(root, role, relativePath, content) {
  const descriptor = writeModelFile(root, relativePath, content);
  return { ...descriptor, role };
}

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assisted-review-models-'));
  const datasetRoot = path.join(root, 'dataset');
  const modelRoot = path.join(root, 'models');
  fs.mkdirSync(path.join(datasetRoot, 'audio'), { recursive: true });
  fs.mkdirSync(path.join(datasetRoot, 'intake'), { recursive: true });
  fs.mkdirSync(path.join(datasetRoot, 'assisted-review'), { recursive: true });
  fs.mkdirSync(modelRoot, { recursive: true });
  const audioPath = path.join(datasetRoot, 'audio', 'candidate.wav');
  fs.copyFileSync(syntheticWav, audioPath);
  const audioBytes = fs.readFileSync(audioPath);
  const intake = {
    schemaVersion: 1,
    source: { sourceRevision: 'fleurs-test-revision' },
    samples: [{
      id: 'fleurs-cmn-hans-cn-dev-synthetic',
      audioFile: 'audio/candidate.wav',
      sha256: sha256(audioBytes),
      sampleRateHz: 16000,
      channels: 1,
      durationMs: 1000,
      transcript: '上游草稿',
      transcriptStatus: 'upstream-draft',
      reviewStatus: 'pending',
    }],
  };
  fs.writeFileSync(path.join(datasetRoot, 'intake', 'inventory.json'), JSON.stringify(intake), 'utf8');
  const roles = [
    {
      role: 'baseline-paraformer', modelId: 'paraformer-fixture', modelVersion: 'v1', family: 'paraformer', mode: 'streaming', sampleRateHz: 16000, channels: 1, numThreads: 1, provider: 'cpu',
      decoder: { method: 'greedy_search' }, language: { value: 'zh' },
      files: [file(modelRoot, 'tokens', 'para/tokens.txt', 'para tokens'), file(modelRoot, 'encoder', 'para/encoder.onnx', 'para encoder'), file(modelRoot, 'decoder', 'para/decoder.onnx', 'para decoder')],
    },
    {
      role: 'candidate-zipformer', modelId: 'zipformer-fixture', modelVersion: 'v1', family: 'zipformer-ctc', mode: 'streaming', sampleRateHz: 16000, channels: 1, numThreads: 1, provider: 'cpu',
      decoder: { method: 'greedy_search' }, language: { value: 'zh' },
      files: [file(modelRoot, 'tokens', 'zip/tokens.txt', 'zip tokens'), file(modelRoot, 'model', 'zip/model.onnx', 'zip model')],
    },
    {
      role: 'candidate-sensevoice-small', modelId: 'sensevoice-fixture', modelVersion: 'v1', family: 'sensevoice', mode: 'utterance', sampleRateHz: 16000, channels: 1, numThreads: 1, provider: 'cpu',
      decoder: { method: 'greedy_search' }, language: { value: 'auto' },
      files: [file(modelRoot, 'tokens', 'sense/tokens.txt', 'sense tokens'), file(modelRoot, 'model', 'sense/model.onnx', 'sense model')],
    },
  ];
  const modelLock = { schemaVersion: 1, sherpaVersion: '1.13.3', roles };
  const { binding } = readBoundPcmCandidate({
    datasetRoot,
    intakePath: 'intake/inventory.json',
    candidateId: 'fleurs-cmn-hans-cn-dev-synthetic',
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, datasetRoot, modelRoot, modelLock, binding, audioPath };
}

test('model lock accepts only the three stable roles and safe hash-pinned relative files', (t) => {
  const fixture = createFixture(t);
  const schema = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'benchmark', 'assisted-review', 'model-lock.schema.json'), 'utf8'));

  assert.deepEqual(schema.required, ['schemaVersion', 'sherpaVersion', 'roles']);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.sherpaVersion.maxLength, 128);
  assert.equal(new RegExp(schema.properties.sherpaVersion.pattern).test('C:\\private\\version'), false);
  const roleSchema = schema.properties.roles.items;
  assert.equal(roleSchema.properties.modelId.maxLength, 128);
  assert.equal(new RegExp(roleSchema.properties.modelId.pattern).test('/private/model'), false);
  assert.equal(new RegExp(roleSchema.properties.modelVersion.pattern).test('..\\private'), false);
  const fileSchema = roleSchema.properties.files.items;
  assert.deepEqual(fileSchema.properties.role.enum, ['tokens', 'encoder', 'decoder', 'model']);
  assert.equal(new RegExp(fileSchema.properties.relativePath.pattern).test('nested/model.onnx'), true);
  assert.equal(new RegExp(fileSchema.properties.relativePath.pattern).test('..\\model.onnx'), false);
  assert.equal(new RegExp(fileSchema.properties.relativePath.pattern).test('nested/../model.onnx'), false);
  assert.equal(validateModelLock(fixture.modelLock), fixture.modelLock);
  assert.throws(
    () => validateModelLock({ ...fixture.modelLock, unknown: true }),
    /unknown|unsupported/i,
  );
  assert.throws(
    () => validateModelLock({ ...fixture.modelLock, roles: fixture.modelLock.roles.slice(0, 2) }),
    /three|roles/i,
  );
  assert.throws(
    () => validateModelLock({ ...fixture.modelLock, roles: [{ ...fixture.modelLock.roles[0], extra: true }, ...fixture.modelLock.roles.slice(1)] }),
    /unsupported/i,
  );
  assert.throws(
    () => validateModelLock({ ...fixture.modelLock, sherpaVersion: 'C:\\private\\version' }),
    /safe|version/i,
  );
  assert.throws(
    () => validateModelLock({ ...fixture.modelLock, roles: [{ ...fixture.modelLock.roles[0], modelId: '/private/model' }, ...fixture.modelLock.roles.slice(1)] }),
    /safe|modelId/i,
  );

  const verified = verifyModelRole({ modelRoot: fixture.modelRoot, role: fixture.modelLock.roles[0] });
  assert.equal(verified.role, 'baseline-paraformer');
  assert.deepEqual(verified.files.map((entry) => entry.relativePath), ['para/tokens.txt', 'para/encoder.onnx', 'para/decoder.onnx']);
  const [paraformerConfig, zipformerConfig, sensevoiceConfig] = fixture.modelLock.roles.map((role) => buildReviewSherpaConfig(role, fixture.modelRoot));
  assert.equal(paraformerConfig.recognizerKind, 'online');
  assert.equal(paraformerConfig.decodingMethod, 'greedy_search');
  assert.equal(paraformerConfig.modelConfig.paraformer.encoder, path.join(fixture.modelRoot, 'para', 'encoder.onnx'));
  assert.equal(zipformerConfig.recognizerKind, 'online');
  assert.equal(zipformerConfig.modelConfig.zipformer2Ctc.model, path.join(fixture.modelRoot, 'zip', 'model.onnx'));
  assert.equal(sensevoiceConfig.recognizerKind, 'offline');
  assert.equal(sensevoiceConfig.modelConfig.senseVoice.model, path.join(fixture.modelRoot, 'sense', 'model.onnx'));
  assert.equal(sensevoiceConfig.modelConfig.tokens, path.join(fixture.modelRoot, 'sense', 'tokens.txt'));
  assert.equal(sensevoiceConfig.modelConfig.senseVoice.language, 'auto');
  fs.appendFileSync(path.join(fixture.modelRoot, 'para', 'tokens.txt'), 'tamper', 'utf8');
  assert.throws(
    () => verifyModelRole({ modelRoot: fixture.modelRoot, role: fixture.modelLock.roles[0] }),
    /SHA-256|hash|byte-size/i,
  );
});

test('model verification rejects a symlink or junction escape from the canonical model root', (t) => {
  const fixture = createFixture(t);
  const outside = path.join(fixture.root, 'outside.onnx');
  fs.writeFileSync(outside, 'outside', 'utf8');
  const link = path.join(fixture.modelRoot, 'para', 'escape.onnx');
  const escapedRole = structuredClone(fixture.modelLock.roles[0]);
  escapedRole.files[1] = { role: 'encoder', relativePath: 'para/escape.onnx', sha256: sha256('outside'), bytes: 7 };
  try {
    fs.symlinkSync(outside, link, 'file');
  } catch (error) {
    if (error.code === 'EPERM') return t.skip('file symlink creation is unavailable on this Windows host');
    throw error;
  }
  assert.throws(() => verifyModelRole({ modelRoot: fixture.modelRoot, role: escapedRole }), /escape|contain/i);
});

test('model verification rejects a directory junction escape from the canonical model root', (t) => {
  const fixture = createFixture(t);
  const outsideDirectory = path.join(fixture.root, 'outside-models');
  fs.mkdirSync(outsideDirectory);
  fs.writeFileSync(path.join(outsideDirectory, 'encoder.onnx'), 'outside encoder', 'utf8');
  const linkedDirectory = path.join(fixture.modelRoot, 'linked-models');
  const escapedRole = structuredClone(fixture.modelLock.roles[0]);
  escapedRole.files[1] = {
    role: 'encoder', relativePath: 'linked-models/encoder.onnx', sha256: sha256('outside encoder'), bytes: 15,
  };
  try {
    fs.symlinkSync(outsideDirectory, linkedDirectory, 'junction');
  } catch (error) {
    if (error.code === 'EPERM') return t.skip('directory junction creation is unavailable on this Windows host');
    throw error;
  }
  assert.throws(() => verifyModelRole({ modelRoot: fixture.modelRoot, role: escapedRole }), /escape|contain/i);
});

test('PCM16 decoding and native Sherpa execution use the installed object waveform API and release resources', () => {
  assert.deepEqual(
    Array.from(decodePcm16ToFloat32(Buffer.from([0x00, 0x80, 0x00, 0x00, 0xff, 0x7f]))),
    [-1, 0, 32767 / 32768],
  );
  const events = [];
  const onlineStream = {
    acceptWaveform: (input) => events.push(['online.accept', input]),
    inputFinished: () => events.push(['online.finished']),
    free: () => events.push(['online.stream.free']),
  };
  const offlineStream = {
    acceptWaveform: (input) => events.push(['offline.accept', input]),
    free: () => events.push(['offline.stream.free']),
  };
  const sherpa = {
    OnlineRecognizer: class {
      createStream() { events.push(['online.create']); return onlineStream; }
      isReady() { events.push(['online.ready']); return events.filter(([name]) => name === 'online.ready').length === 1 || events.filter(([name]) => name === 'online.ready').length === 3; }
      decode() { events.push(['online.decode']); }
      getResult() { events.push(['online.result']); return { text: '在线结果' }; }
      free() { events.push(['online.recognizer.free']); }
    },
    OfflineRecognizer: class {
      createStream() { events.push(['offline.create']); return offlineStream; }
      decode() { events.push(['offline.decode']); }
      getResult() { events.push(['offline.result']); return { text: '离线结果' }; }
      free() { events.push(['offline.recognizer.free']); }
    },
  };
  const bytes = Buffer.from([0x00, 0x80, 0x00, 0x00]);
  const online = runSherpaTranscription({ role: { mode: 'streaming' }, config: { recognizerKind: 'online' }, pcmBytes: bytes, sampleRateHz: 16000, sherpa });
  const offline = runSherpaTranscription({ role: { mode: 'utterance' }, config: { recognizerKind: 'offline' }, pcmBytes: bytes, sampleRateHz: 16000, sherpa });

  assert.equal(online, '在线结果');
  assert.equal(offline, '离线结果');
  assert.deepEqual(events.map(([name]) => name), [
    'online.create', 'online.accept', 'online.ready', 'online.decode', 'online.ready', 'online.finished', 'online.ready', 'online.decode', 'online.ready', 'online.result', 'online.stream.free', 'online.recognizer.free',
    'offline.create', 'offline.accept', 'offline.decode', 'offline.result', 'offline.stream.free', 'offline.recognizer.free',
  ]);
  assert.equal(events[1][1].sampleRate, 16000);
  assert.ok(events[1][1].samples instanceof Float32Array);
  assert.equal(events[13][1].sampleRate, 16000);
  assert.ok(events[13][1].samples instanceof Float32Array);
  assert.throws(
    () => runSherpaTranscription({ role: { mode: 'streaming' }, config: { recognizerKind: 'offline' }, pcmBytes: bytes, sampleRateHz: 16000, channels: 1, sherpa }),
    /mismatch/i,
  );
  assert.throws(
    () => runSherpaTranscription({ role: { mode: 'streaming' }, config: { recognizerKind: 'online' }, pcmBytes: bytes, sampleRateHz: 16000, channels: 2, sherpa }),
    /mono/i,
  );
});

test('sealed attempts record success or redacted failure without absolute model paths', (t) => {
  const fixture = createFixture(t);
  const role = fixture.modelLock.roles[0];
  const success = sealPredictionAttempt({
    datasetRoot: fixture.datasetRoot,
    binding: fixture.binding,
    role,
    modelLock: fixture.modelLock,
    modelRoot: fixture.modelRoot,
    runId: 'run-001',
    transcribe: () => 'Ａ　好！',
  });
  const failed = sealPredictionAttempt({
    datasetRoot: fixture.datasetRoot,
    binding: fixture.binding,
    role: fixture.modelLock.roles[1],
    modelLock: fixture.modelLock,
    modelRoot: fixture.modelRoot,
    runId: 'run-002',
    transcribe: () => { throw new Error(`missing ${fixture.modelRoot}`); },
  });

  assert.equal(success.status, 'succeeded');
  assert.equal(success.rawText, 'Ａ　好！');
  assert.equal(success.normalizedText, 'a好');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.rawText, '');
  assert.equal(failed.normalizedText, '');
  assert.equal(failed.errorCode, 'TRANSCRIPTION_FAILED');
  assert.match(success.recordSha256, /^[a-f0-9]{64}$/);
  const successWithoutRecordHash = { ...success };
  delete successWithoutRecordHash.recordSha256;
  assert.equal(success.recordSha256, sha256(canonicalJson(successWithoutRecordHash)));
  assert.equal(JSON.stringify({ success, failed }).includes(fixture.modelRoot), false);
  assert.equal(fs.existsSync(path.join(fixture.datasetRoot, 'assisted-review', 'runs', 'run-001', 'candidates', fixture.binding.candidateId, fixture.binding.bindingSha256, 'predictions', 'baseline-paraformer.json')), true);
});

test('prediction bundle seals all three roles, comparison, and rejects stale audio or unsafe CLI input', (t) => {
  const fixture = createFixture(t);
  let firstPcmBytes;
  const result = runPredictionBundle({
    datasetRoot: fixture.datasetRoot,
    binding: fixture.binding,
    upstreamDraft: '上游草稿',
    modelLock: fixture.modelLock,
    modelRoot: fixture.modelRoot,
    runId: 'run-bundle',
    transcribe: ({ role, pcmBytes }) => {
      firstPcmBytes ||= Buffer.from(pcmBytes);
      return role.role === 'candidate-zipformer' ? (() => { throw new Error('fixture error'); })() : '上游草稿';
    },
  });

  assert.deepEqual(result.attempts.map((attempt) => attempt.role), ROLES);
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ['succeeded', 'failed', 'succeeded']);
  assert.equal(result.comparison.bindingSha256, fixture.binding.bindingSha256);
  assert.equal(result.comparison.risk, 'high');
  assert.equal(fs.existsSync(path.join(fixture.datasetRoot, 'assisted-review', 'runs', 'run-bundle', 'candidates', fixture.binding.candidateId, fixture.binding.bindingSha256, 'comparison.json')), true);
  const run = JSON.parse(fs.readFileSync(path.join(fixture.datasetRoot, 'assisted-review', 'runs', 'run-bundle', 'run.json'), 'utf8'));
  assert.equal(run.modelLockSha256, sha256(canonicalJson(fixture.modelLock)));
  assert.deepEqual(run.roles.map((entry) => entry.role), ROLES);
  assert.equal(JSON.stringify(run).includes(fixture.modelRoot), false);
  const wavBytes = fs.readFileSync(fixture.audioPath);
  assert.equal(firstPcmBytes.length, wavBytes.length - 44);
  assert.equal(firstPcmBytes.readInt16LE(0), wavBytes.readInt16LE(44));
  assert.throws(
    () => runPredictionBundle({ ...{
      datasetRoot: fixture.datasetRoot, binding: { ...fixture.binding, audioSha256: '0'.repeat(64) }, upstreamDraft: '上游草稿', modelLock: fixture.modelLock, modelRoot: fixture.modelRoot, runId: 'run-stale', transcribe: () => '文本',
    } }),
    /SHA-256|hash|binding/i,
  );
  assert.equal(fs.existsSync(path.join(fixture.datasetRoot, 'assisted-review', 'runs', 'run-stale')), false);
  assert.throws(
    () => parseRunPredictionArgs(['--dataset-root', fixture.datasetRoot, '--model-root', fixture.modelRoot, '--model-lock', path.join(fixture.root, 'models.lock.json'), '--run-id', '../escape', '--candidate', fixture.binding.candidateId]),
    /runId|relative|safe/i,
  );
  assert.throws(
    () => parseRunPredictionArgs(['--dataset-root', fixture.datasetRoot, '--model-root', fixture.modelRoot, '--model-root', fixture.modelRoot, '--model-lock', path.join(fixture.root, 'models.lock.json'), '--run-id', 'run', '--candidate', fixture.binding.candidateId]),
    /duplicate/i,
  );
});

test('public sealing rejects model and binding preflight failures without writing an attempt', (t) => {
  const fixture = createFixture(t);
  fs.writeFileSync(path.join(fixture.modelRoot, 'para', 'tokens.txt'), 'bad tokens', 'utf8');
  assert.throws(
    () => sealPredictionAttempt({
      datasetRoot: fixture.datasetRoot, binding: fixture.binding, role: fixture.modelLock.roles[0], modelLock: fixture.modelLock, modelRoot: fixture.modelRoot, runId: 'run-model-preflight', transcribe: () => '文本',
    }),
    /SHA-256|hash|byte-size/i,
  );
  assert.equal(fs.existsSync(path.join(fixture.datasetRoot, 'assisted-review', 'runs', 'run-model-preflight')), false);
  fs.writeFileSync(path.join(fixture.modelRoot, 'para', 'tokens.txt'), 'para tokens', 'utf8');
  assert.throws(
    () => sealPredictionAttempt({
      datasetRoot: fixture.datasetRoot, binding: { ...fixture.binding, audioSha256: '0'.repeat(64) }, role: fixture.modelLock.roles[0], modelLock: fixture.modelLock, modelRoot: fixture.modelRoot, runId: 'run-audio-preflight', transcribe: () => '文本',
    }),
    /SHA-256|hash|binding/i,
  );
  assert.equal(fs.existsSync(path.join(fixture.datasetRoot, 'assisted-review', 'runs', 'run-audio-preflight')), false);
});

test('post-transcription audio changes abort the current bundle without a prediction or comparison', (t) => {
  const fixture = createFixture(t);
  assert.throws(
    () => runPredictionBundle({
      datasetRoot: fixture.datasetRoot, binding: fixture.binding, upstreamDraft: '上游草稿', modelLock: fixture.modelLock, modelRoot: fixture.modelRoot, runId: 'run-post-audio',
      transcribe: () => { fs.appendFileSync(fixture.audioPath, Buffer.from([0])); return '文本'; },
    }),
    /audio binding|WAV/i,
  );
  const outputRoot = path.join(fixture.datasetRoot, 'assisted-review', 'runs', 'run-post-audio', 'candidates', fixture.binding.candidateId, fixture.binding.bindingSha256);
  assert.equal(fs.existsSync(path.join(outputRoot, 'predictions', 'baseline-paraformer.json')), false);
  assert.equal(fs.existsSync(path.join(outputRoot, 'comparison.json')), false);
});

test('bundle revalidates PCM independently immediately before every model consumption', (t) => {
  const fixture = createFixture(t);
  const originalRealpath = fs.realpathSync.native;
  let audioRealpathCalls = 0;
  try {
    fs.realpathSync.native = (value) => {
      if (path.resolve(value) === fixture.audioPath) audioRealpathCalls += 1;
      return originalRealpath(value);
    };
    const result = runPredictionBundle({
      datasetRoot: fixture.datasetRoot, binding: fixture.binding, upstreamDraft: '上游草稿', modelLock: fixture.modelLock, modelRoot: fixture.modelRoot, runId: 'run-per-attempt-audio', transcribe: () => '文本',
    });
    assert.deepEqual(result.attempts.map((attempt) => attempt.status), ['succeeded', 'succeeded', 'succeeded']);
    assert.ok(audioRealpathCalls >= 16, 'each model consumption must independently revalidate canonical audio identity');
  } finally {
    fs.realpathSync.native = originalRealpath;
  }
});

test('sealed config digests cover native configuration fields after model paths are relativized', (t) => {
  const fixture = createFixture(t);
  const first = sealPredictionAttempt({
    datasetRoot: fixture.datasetRoot, binding: fixture.binding, role: fixture.modelLock.roles[0], modelLock: fixture.modelLock, modelRoot: fixture.modelRoot, runId: 'run-config-one', transcribe: () => '文本',
  });
  const changedLock = structuredClone(fixture.modelLock);
  changedLock.roles[0].numThreads = 2;
  const second = sealPredictionAttempt({
    datasetRoot: fixture.datasetRoot, binding: fixture.binding, role: changedLock.roles[0], modelLock: changedLock, modelRoot: fixture.modelRoot, runId: 'run-config-two', transcribe: () => '文本',
  });
  assert.notEqual(first.configSha256, second.configSha256);
});

test('bundle preflights every model file before audio or prediction evidence and leaves no partial attempts', (t) => {
  const fixture = createFixture(t);
  fs.writeFileSync(path.join(fixture.modelRoot, 'sense', 'model.onnx'), 'other model', 'utf8');

  assert.throws(
    () => runPredictionBundle({
      datasetRoot: fixture.datasetRoot,
      binding: fixture.binding,
      upstreamDraft: '上游草稿',
      modelLock: fixture.modelLock,
      modelRoot: fixture.modelRoot,
      runId: 'run-preflight',
      transcribe: () => '文本',
    }),
    /SHA-256|hash/i,
  );
  assert.equal(
    fs.existsSync(path.join(fixture.datasetRoot, 'assisted-review', 'runs', 'run-preflight', 'candidates', fixture.binding.candidateId, fixture.binding.bindingSha256, 'predictions')),
    false,
  );
  fs.writeFileSync(path.join(fixture.modelRoot, 'sense', 'model.onnx'), 'sense model', 'utf8');
  const versionMismatchedLock = { ...fixture.modelLock, sherpaVersion: '0.0.0' };
  assert.throws(
    () => runPredictionBundle({
      datasetRoot: fixture.datasetRoot,
      binding: fixture.binding,
      upstreamDraft: '上游草稿',
      modelLock: versionMismatchedLock,
      modelRoot: fixture.modelRoot,
      runId: 'run-version-mismatch',
      transcribe: () => '文本',
    }),
    /Sherpa|version/i,
  );
  assert.equal(fs.existsSync(path.join(fixture.datasetRoot, 'assisted-review', 'runs', 'run-version-mismatch')), false);
});
