const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function files() {
  const root = path.resolve('fixture-zipformer');
  return {model: path.join(root, 'model.int8.onnx'), tokens: path.join(root, 'tokens.txt')};
}

test('Zipformer CTC provider uses the fixed online CTC configuration', async () => {
  const {createZipformerCtcAsrProvider} = require('../lib/zipformer-ctc-asr-provider');
  let config;
  const provider = createZipformerCtcAsrProvider({
    modelFiles: files(),
    fileExists: () => true,
    loadSherpa: () => ({OnlineRecognizer: class { constructor(value) { config = value; } }})
  });
  await provider.initialize();
  assert.deepEqual(config, {
    featConfig: {sampleRate: 16000, featureDim: 80},
    modelConfig: {
      zipformer2Ctc: {model: files().model},
      tokens: files().tokens,
      numThreads: 2,
      provider: 'cpu',
      debug: false
    },
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20
  });
});

test('Zipformer CTC provider emits partial, endpoint final, and stop final events', async () => {
  const {createZipformerCtcAsrProvider} = require('../lib/zipformer-ctc-asr-provider');
  const stream = {acceptWaveform() {}, inputFinished() {}};
  let text = 'partial';
  let endpoint = false;
  let resets = 0;
  const recognizer = {
    createStream: () => stream,
    isReady: () => false,
    decode() {},
    getResult: () => ({text}),
    isEndpoint: () => endpoint,
    reset() { resets += 1; }
  };
  const provider = createZipformerCtcAsrProvider({modelFiles: files(), fileExists: () => true, loadSherpa: () => ({OnlineRecognizer: class { constructor() { return recognizer; } }})});
  await provider.initialize();
  assert.equal((await provider.start({sessionId: 'zip', sampleRateHz: 16000})).type, 'ready');
  assert.equal(provider.feed({sessionId: 'zip', sequence: 0, samples: new Float32Array([0.1])}).type, 'partial');
  text = 'final'; endpoint = true;
  assert.equal(provider.feed({sessionId: 'zip', sequence: 1, samples: new Float32Array([0.2])}).type, 'final');
  assert.equal(resets, 1);
  text = 'tail'; endpoint = false;
  assert.deepEqual(provider.stop({sessionId: 'zip'}).map(event => event.type), ['final', 'stopped']);
});

test('Zipformer CTC provider cancels without returning a tail and disposes idempotently', async () => {
  const {createZipformerCtcAsrProvider} = require('../lib/zipformer-ctc-asr-provider');
  let inputFinished = 0;
  const recognizer = {createStream: () => ({acceptWaveform() {}, inputFinished() { inputFinished += 1; }}), isReady: () => false, decode() {}, getResult: () => ({text: 'tail'}), isEndpoint: () => false};
  const provider = createZipformerCtcAsrProvider({modelFiles: files(), fileExists: () => true, loadSherpa: () => ({OnlineRecognizer: class { constructor() { return recognizer; } }})});
  await provider.initialize();
  await provider.start({sessionId: 'cancel', sampleRateHz: 16000});
  assert.deepEqual(provider.cancel({sessionId: 'cancel'}).map(event => event.type), ['stopped']);
  assert.equal(inputFinished, 0);
  await provider.dispose();
  await provider.dispose();
  await assert.rejects(provider.start({sessionId: 'later', sampleRateHz: 16000}), /disposed/);
});

test('Zipformer CTC provider rejects missing required files before loading Sherpa', async () => {
  const {createZipformerCtcAsrProvider} = require('../lib/zipformer-ctc-asr-provider');
  const provider = createZipformerCtcAsrProvider({modelFiles: files(), fileExists: file => !file.endsWith('tokens.txt'), loadSherpa: () => { throw new Error('must not load'); }});
  await assert.rejects(provider.initialize(), /tokens\.txt/);
});
