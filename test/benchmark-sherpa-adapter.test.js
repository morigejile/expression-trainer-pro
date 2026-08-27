const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function createPcmWav() {
  const sampleRateHz = 16000;
  const dataBytes = sampleRateHz * 2 / 5;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0, 4, 'ascii');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVE', 8, 4, 'ascii');
  wav.write('fmt ', 12, 4, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRateHz, 24);
  wav.writeUInt32LE(sampleRateHz * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 4, 'ascii');
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

function candidate({ id, family, mode, version, files }) {
  return {
    id,
    displayName: id,
    family,
    mode,
    status: 'verified',
    sourceUrl: 'https://example.invalid/model',
    upstreamVersion: version,
    license: {
      model: { status: 'unverified', reason: 'fixture', source: 'https://example.invalid/license' },
      code: { spdx: 'Apache-2.0', location: 'https://example.invalid/code' },
      redistribution: 'not-approved'
    },
    evidence: {
      source: { status: 'verified', checkedAt: '2026-08-25T00:00:00.000Z' },
      license: { status: 'unverified', checkedAt: '2026-08-25T00:00:00.000Z' },
      files: { status: 'verified', reason: 'fixture', verifiedAt: '2026-08-25T00:00:00.000Z' },
      nativeLoad: { status: 'passed', reason: 'fixture', recordedAt: '2026-08-25T00:00:00.000Z' }
    },
    sampleRateHz: 16000,
    numThreads: 2,
    provider: 'cpu',
    files
  };
}

function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-sherpa-'));
  const datasetRoot = path.join(root, 'dataset');
  const modelRoot = path.join(root, 'models');
  fs.mkdirSync(datasetRoot);
  fs.mkdirSync(modelRoot);
  fs.writeFileSync(path.join(datasetRoot, 'sample.wav'), createPcmWav());
  const makeFiles = (directory, roles) => roles.map((role) => {
    const relativePath = `${directory}/${role}.bin`;
    const bytes = Buffer.from(`${directory}-${role}`);
    const filePath = path.join(modelRoot, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, bytes);
    return {
      relativePath,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      role
    };
  });
  const registryPath = path.join(root, 'candidates.json');
  fs.writeFileSync(registryPath, JSON.stringify({
    schemaVersion: 1,
    candidates: [
      candidate({ id: 'paraformer-bilingual-zh-en-control', family: 'paraformer', mode: 'streaming', version: '2024-03-10', files: makeFiles('paraformer', ['encoder', 'decoder', 'tokens']) }),
      candidate({ id: 'zipformer-small-ctc-zh-int8-2025-04-01', family: 'zipformer-ctc', mode: 'streaming', version: '2025-04-01', files: makeFiles('zipformer', ['model', 'tokens', 'bpe-vocab']) }),
      candidate({ id: 'sensevoice-small-int8-2024-07-17', family: 'sensevoice', mode: 'utterance', version: '2024-07-17', files: makeFiles('sensevoice', ['model', 'tokens']) })
    ]
  }));
  return Promise.resolve(run({ datasetRoot, modelRoot, registryPath })).finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

function fakeSherpa() {
  const state = { onlineConfig: null, offlineConfig: null, recognizerFreed: 0, streamFreed: 0 };
  class Stream {
    constructor() { this.ready = false; this.finished = false; }
    acceptWaveform() { this.ready = true; }
    inputFinished() { this.finished = true; this.ready = true; }
    free() { state.streamFreed += 1; }
  }
  class OnlineRecognizer {
    constructor(config) { state.onlineConfig = config; }
    createStream() { return new Stream(); }
    isReady(stream) { return stream.ready; }
    decode(stream) { stream.ready = false; }
    getResult(stream) { return { text: stream.finished ? '在线终稿' : '在线部分' }; }
    free() { state.recognizerFreed += 1; }
  }
  class OfflineRecognizer {
    constructor(config) { state.offlineConfig = config; }
    createStream() { return new Stream(); }
    decode() {}
    getResult() { return { text: '离线终稿' }; }
    free() { state.recognizerFreed += 1; }
  }
  return { state, binding: { OnlineRecognizer, OfflineRecognizer } };
}

const sample = { audioFile: 'sample.wav', sampleRateHz: 16000, channels: 1 };

test('Paraformer adapter uses the online config and emits partial plus final text', async () => {
  const { createSherpaAdapter } = require('../benchmark/adapters/sherpa');
  await withFixture(async ({ datasetRoot, modelRoot, registryPath }) => {
    const sherpa = fakeSherpa();
    const adapter = createSherpaAdapter({ candidateId: 'paraformer-bilingual-zh-en-control', datasetRoot, modelRoot, registryPath, sherpa: sherpa.binding });
    const partials = [];
    let final;
    await adapter.init();
    await adapter.transcribe(sample, { onPartial: ({ text }) => partials.push(text), onFinal: ({ text }) => { final = text; } }, {});
    await adapter.dispose();

    assert.deepEqual(partials, ['在线部分']);
    assert.equal(final, '在线终稿');
    assert.match(sherpa.state.onlineConfig.modelConfig.paraformer.encoder, /encoder\.bin$/);
    assert.equal(adapter.config.threads, 2);
    assert.equal(adapter.modelFiles.length, 3);
    assert.equal(sherpa.state.streamFreed, 1);
    assert.equal(sherpa.state.recognizerFreed, 1);
  });
});

test('Zipformer adapter selects the zipformer2Ctc online model config', async () => {
  const { createSherpaAdapter } = require('../benchmark/adapters/sherpa');
  await withFixture(async ({ datasetRoot, modelRoot, registryPath }) => {
    const sherpa = fakeSherpa();
    const adapter = createSherpaAdapter({ candidateId: 'zipformer-small-ctc-zh-int8-2025-04-01', datasetRoot, modelRoot, registryPath, sherpa: sherpa.binding });
    await adapter.init();
    await adapter.dispose();

    assert.match(sherpa.state.onlineConfig.modelConfig.zipformer2Ctc.model, /model\.bin$/);
    assert.equal(adapter.version, '2025-04-01');
  });
});

test('SenseVoice adapter uses the offline config and emits final text without a partial', async () => {
  const { createSherpaAdapter } = require('../benchmark/adapters/sherpa');
  await withFixture(async ({ datasetRoot, modelRoot, registryPath }) => {
    const sherpa = fakeSherpa();
    const adapter = createSherpaAdapter({ candidateId: 'sensevoice-small-int8-2024-07-17', datasetRoot, modelRoot, registryPath, sherpa: sherpa.binding });
    const partials = [];
    let final;
    await adapter.init();
    await adapter.transcribe(sample, { onPartial: ({ text }) => partials.push(text), onFinal: ({ text }) => { final = text; } }, {});
    await adapter.dispose();

    assert.deepEqual(partials, []);
    assert.equal(final, '离线终稿');
    assert.match(sherpa.state.offlineConfig.modelConfig.senseVoice.model, /model\.bin$/);
  });
});
