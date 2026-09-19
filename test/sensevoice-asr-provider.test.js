'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function files() {
  return {model: path.resolve('fixture-sensevoice/model.int8.onnx'), tokens: path.resolve('fixture-sensevoice/tokens.txt')};
}

function fixture({result = {text: '测试语音'}, failDecode = false, failAccept = false} = {}) {
  const {createSenseVoiceAsrProvider} = require('../lib/sensevoice-asr-provider');
  const state = {configs: [], decodes: 0, waves: [], failDecode, failAccept};
  const provider = createSenseVoiceAsrProvider({
    modelFiles: files(), fileExists: () => true,
    loadSherpa: () => ({OfflineRecognizer: class {
      constructor(config) { state.configs.push(config); }
      createStream() {
        return {acceptWaveform({samples, sampleRate}) {
          if (state.failAccept) throw new Error('native accept failed');
          assert.equal(sampleRate, 16000);
          state.waves.push(new Float32Array(samples));
        }};
      }
      decode() {
        state.decodes += 1;
        if (state.failDecode) throw new Error('native decode failed');
      }
      getResult() { return result; }
    }})
  });
  return {provider, state};
}

async function start(provider, sessionId = 'speech') {
  await provider.initialize();
  return provider.start({sessionId, sampleRateHz: 16000});
}

function feed(provider, samples, sessionId = 'speech', sequence = 0) {
  return provider.feed({sessionId, sequence, samples});
}

test('SenseVoice buffers owned PCM, emits no partial, and decodes exactly once at stop', async () => {
  const {provider, state} = fixture();
  const ready = await start(provider);
  assert.equal(ready.capabilities.recognitionMode, 'utterance');
  assert.equal(ready.capabilities.partialResults, false);
  assert.equal(ready.capabilities.tokenTimestamps, false);
  assert.equal(ready.capabilities.timingSource, 'unavailable');
  const samples = new Float32Array([0.25, -0.5]);
  assert.equal(feed(provider, samples), null);
  samples.fill(1);
  assert.equal(feed(provider, new Float32Array([0.75]), 'speech', 1), null);
  assert.equal(state.decodes, 0);
  assert.equal(state.waves.length, 0);
  const events = provider.stop({sessionId: 'speech'});
  assert.deepEqual(events.map(event => event.type), ['final', 'stopped']);
  assert.equal(events[0].text, '测试语音');
  assert.equal(events[0].timingSource, 'unavailable');
  assert.equal(events[1].finalAcceptedSampleCursor, 3);
  assert.deepEqual(Array.from(state.waves[0]), [0.25, -0.5, 0.75]);
  assert.equal(state.decodes, 1);
  assert.deepEqual(provider.stop({sessionId: 'speech'}), []);
  assert.equal(state.decodes, 1);
});

test('SenseVoice uses the verified offline CPU configuration and validates runtime files', async () => {
  const {provider, state} = fixture();
  await provider.initialize();
  await provider.initialize();
  assert.deepEqual(state.configs, [{
    featConfig: {sampleRate: 16000, featureDim: 80},
    modelConfig: {
      senseVoice: {model: files().model, language: 'auto', useInverseTextNormalization: true},
      tokens: files().tokens, numThreads: 2, provider: 'cpu', debug: false
    }
  }]);
  const {createSenseVoiceAsrProvider} = require('../lib/sensevoice-asr-provider');
  const missing = createSenseVoiceAsrProvider({modelFiles: files(), fileExists: value => !value.endsWith('tokens.txt'), loadSherpa() { assert.fail('must validate before native loading'); }});
  await assert.rejects(missing.initialize(), /tokens\.txt/);
  await assert.rejects(missing.start({sessionId: 'bad', sampleRateHz: 16000}), /initialized/);
});

test('SenseVoice accepts exactly five minutes and rejects the next sample without decoding truncated audio', async () => {
  const {provider, state} = fixture();
  await start(provider);
  assert.equal(feed(provider, new Float32Array(4_800_000)), null);
  const overflow = feed(provider, new Float32Array([1]), 'speech', 1);
  assert.equal(overflow.type, 'error');
  assert.equal(overflow.code, 'asr-buffer-limit-exceeded');
  assert.deepEqual(provider.stop({sessionId: 'speech'}).map(event => event.type), ['error', 'stopped']);
  assert.equal(state.decodes, 0);
  await start(provider, 'retry');
  feed(provider, new Float32Array([0.5]), 'retry');
  assert.equal(provider.stop({sessionId: 'retry'})[0].text, '测试语音');
  assert.deepEqual(Array.from(state.waves[0]), [0.5]);
  await start(provider, 'boundary');
  feed(provider, new Float32Array(4_800_000), 'boundary');
  assert.equal(provider.stop({sessionId: 'boundary'})[0].type, 'final');
  assert.equal(state.waves[1].length, 4_800_000);
});

test('SenseVoice empty audio completes without native decode', async () => {
  const {provider, state} = fixture();
  await start(provider);
  feed(provider, new Float32Array());
  assert.deepEqual(provider.stop({sessionId: 'speech'}).map(event => event.type), ['stopped']);
  assert.equal(state.decodes, 0);
  assert.equal(state.waves.length, 0);
});

test('SenseVoice cancel and replacement discard PCM instead of carrying it into the next session', async () => {
  const {provider, state} = fixture();
  await start(provider);
  feed(provider, new Float32Array([0.75]));
  assert.deepEqual(provider.cancel({sessionId: 'speech'}).map(event => event.type), ['stopped']);
  assert.deepEqual(provider.stop({sessionId: 'speech'}), []);
  await start(provider, 'replacement');
  feed(provider, new Float32Array([0.5]), 'replacement');
  await start(provider, 'fresh');
  feed(provider, new Float32Array([0.25]), 'fresh');
  provider.stop({sessionId: 'fresh'});
  assert.equal(state.decodes, 1);
  assert.deepEqual(Array.from(state.waves[0]), [0.25]);
  await start(provider, 'dispose');
  feed(provider, new Float32Array([1]), 'dispose');
  await provider.dispose();
  await provider.dispose();
  assert.deepEqual(provider.stop({sessionId: 'dispose'}), []);
  await assert.rejects(start(provider, 'disposed'), /disposed/);
  assert.equal(state.decodes, 1);
});

for (const failure of ['failAccept', 'failDecode']) {
  test(`SenseVoice ${failure} is explicit and a new session contains only new audio`, async () => {
    const {provider, state} = fixture({[failure]: true});
    await start(provider);
    feed(provider, new Float32Array([1]));
    const failed = provider.stop({sessionId: 'speech'});
    assert.deepEqual(failed.map(event => event.type), ['error', 'stopped']);
    assert.equal(failed[0].code, 'asr-recognition-failed');
    state[failure] = false;
    await start(provider, 'retry');
    feed(provider, new Float32Array([-0.25]), 'retry');
    assert.equal(provider.stop({sessionId: 'retry'})[0].text, '测试语音');
    assert.deepEqual(Array.from(state.waves.at(-1)), [-0.25]);
  });
}

test('SenseVoice load failure can be retried after the native dependency becomes available', async () => {
  const {createSenseVoiceAsrProvider} = require('../lib/sensevoice-asr-provider');
  let fail = true;
  const provider = createSenseVoiceAsrProvider({modelFiles: files(), fileExists: () => true, loadSherpa: () => ({OfflineRecognizer: class {
    constructor() { if (fail) throw new Error('native load failed'); }
  }})});
  await assert.rejects(provider.initialize(), /native load failed/);
  fail = false;
  await provider.initialize();
  assert.equal((await provider.start({sessionId: 'retry', sampleRateHz: 16000})).type, 'ready');
  assert.deepEqual(provider.stop({sessionId: 'retry'}).map(event => event.type), ['stopped']);
});

test('SenseVoice labels and timestamps never become expression scores or primary transcript metadata', async () => {
  const {provider} = fixture({result: {
    text: '<|zh|><|HAPPY|><|Speech|><|withitn|> 这是原始转写。 ',
    lang: 'zh', emotion: 'HAPPY', event: 'Speech', tokens: ['测试'], timestamps: [0.2], score: 0.99
  }});
  await start(provider);
  feed(provider, new Float32Array([0.25]));
  const final = provider.stop({sessionId: 'speech'})[0];
  assert.equal(final.text, '这是原始转写。');
  assert.deepEqual(Object.keys(final).sort(), ['sequence', 'sessionId', 'text', 'timingSource', 'type']);
});

test('SenseVoice malformed native output fails explicitly instead of masquerading as empty speech', async () => {
  const {provider} = fixture({result: {text: null}});
  await start(provider);
  feed(provider, new Float32Array([0.25]));
  const events = provider.stop({sessionId: 'speech'});
  assert.deepEqual(events.map(event => event.type), ['error', 'stopped']);
  assert.equal(events[0].code, 'asr-recognition-failed');
});
