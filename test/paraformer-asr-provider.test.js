const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('Paraformer provider preserves the current model and decoding configuration', async () => {
  const { createParaformerAsrProvider } = require('../lib/asr');
  const modelRoot = path.join('C:', 'fixture-models');
  const modelDir = path.join(
    modelRoot,
    'sherpa-onnx-streaming-paraformer-bilingual-zh-en'
  );
  let receivedConfig;
  let recognizerCount = 0;
  let streamCount = 0;

  const provider = createParaformerAsrProvider({
    modelRoot,
    fileExists: () => true,
    loadSherpa: () => ({
      OnlineRecognizer: class {
        constructor(config) {
          recognizerCount += 1;
          receivedConfig = config;
        }

        createStream() {
          streamCount += 1;
          return {};
        }
      }
    })
  });

  await provider.initialize();
  await provider.initialize();

  assert.deepEqual(receivedConfig, {
    featConfig: {
      sampleRate: 16000,
      featureDim: 80
    },
    modelConfig: {
      paraformer: {
        encoder: path.join(modelDir, 'encoder.int8.onnx'),
        decoder: path.join(modelDir, 'decoder.int8.onnx')
      },
      tokens: path.join(modelDir, 'tokens.txt'),
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
  assert.equal(recognizerCount, 1);
  assert.equal(streamCount, 0);

  assert.deepEqual(await provider.start({
    sessionId: 'session-a',
    sampleRateHz: 16000
  }), {
    type: 'ready',
    sessionId: 'session-a',
    sequence: 0
  });
  assert.equal(streamCount, 1);

  assert.deepEqual(await provider.start({
    sessionId: 'session-b',
    sampleRateHz: 16000
  }), {
    type: 'ready',
    sessionId: 'session-b',
    sequence: 0
  });
  assert.equal(streamCount, 2);
});

test('Paraformer provider feeds 16 kHz samples and returns trimmed partial text', async () => {
  const { createParaformerAsrProvider } = require('../lib/asr');
  const samples = new Float32Array([0.1, 0.2]);
  let acceptedWaveform;
  let readyChecks = 0;
  const stream = {
    acceptWaveform(waveform) {
      acceptedWaveform = waveform;
    }
  };
  const recognizer = {
    createStream: () => stream,
    isReady: () => readyChecks++ === 0,
    decode() {},
    getResult: () => ({ text: '  partial text  ' }),
    isEndpoint: () => false
  };
  const provider = createParaformerAsrProvider({
    fileExists: () => true,
    loadSherpa: () => ({
      OnlineRecognizer: class {
        constructor() {
          return recognizer;
        }
      }
    })
  });

  await provider.initialize();
  await provider.start({ sessionId: 'partial-session', sampleRateHz: 16000 });
  const result = provider.feed({
    sessionId: 'partial-session',
    sequence: 0,
    samples
  });

  assert.deepEqual(acceptedWaveform, { samples, sampleRate: 16000 });
  assert.deepEqual(result, {
    type: 'partial',
    sessionId: 'partial-session',
    sequence: 1,
    text: 'partial text'
  });
});

test('Paraformer provider finalizes and resets a non-empty endpoint result', async () => {
  const { createParaformerAsrProvider } = require('../lib/asr');
  const stream = { acceptWaveform() {} };
  let resetStream;
  const recognizer = {
    createStream: () => stream,
    isReady: () => false,
    decode() {},
    getResult: () => ({ text: ' endpoint text ' }),
    isEndpoint: () => true,
    reset(value) {
      resetStream = value;
    }
  };
  const provider = createParaformerAsrProvider({
    fileExists: () => true,
    loadSherpa: () => ({
      OnlineRecognizer: class {
        constructor() {
          return recognizer;
        }
      }
    })
  });

  await provider.initialize();
  await provider.start({ sessionId: 'endpoint-session', sampleRateHz: 16000 });
  const result = provider.feed({
    sessionId: 'endpoint-session',
    sequence: 0,
    samples: new Float32Array([0.1])
  });

  assert.equal(resetStream, stream);
  assert.deepEqual(result, {
    type: 'final',
    sessionId: 'endpoint-session',
    sequence: 1,
    text: 'endpoint text'
  });
});

test('Paraformer provider flushes and returns trimmed final text when stopped', async () => {
  const { createParaformerAsrProvider } = require('../lib/asr');
  let inputFinished = false;
  let readyChecks = 0;
  const stream = {
    inputFinished() {
      inputFinished = true;
    }
  };
  const recognizer = {
    createStream: () => stream,
    isReady: () => readyChecks++ === 0,
    decode() {},
    getResult: () => ({ text: '  tail text  ' })
  };
  const provider = createParaformerAsrProvider({
    fileExists: () => true,
    loadSherpa: () => ({
      OnlineRecognizer: class {
        constructor() {
          return recognizer;
        }
      }
    })
  });

  await provider.initialize();
  await provider.start({ sessionId: 'stop-session', sampleRateHz: 16000 });
  const stopped = provider.stop({ sessionId: 'stop-session' });

  assert.equal(inputFinished, true);
  assert.deepEqual(stopped, [
    {
      type: 'final',
      sessionId: 'stop-session',
      sequence: 1,
      text: 'tail text'
    },
    {
      type: 'stopped',
      sessionId: 'stop-session',
      sequence: 2
    }
  ]);
  assert.deepEqual(provider.stop({ sessionId: 'stop-session' }), []);
});

test('Paraformer provider cancels without flushing and disposes repeatably', async () => {
  const { createParaformerAsrProvider } = require('../lib/asr');
  const streams = [];
  let inputFinishedCount = 0;
  const recognizer = {
    createStream() {
      const stream = {
        acceptWaveform() {},
        inputFinished() {
          inputFinishedCount += 1;
        }
      };
      streams.push(stream);
      return stream;
    },
    isReady: () => false,
    decode() {},
    getResult: () => ({ text: 'tail that must be discarded' }),
    isEndpoint: () => false
  };
  const provider = createParaformerAsrProvider({
    fileExists: () => true,
    loadSherpa: () => ({
      OnlineRecognizer: class {
        constructor() {
          return recognizer;
        }
      }
    })
  });

  await provider.initialize();
  await provider.start({ sessionId: 'cancel-session', sampleRateHz: 16000 });

  assert.deepEqual(provider.cancel({ sessionId: 'cancel-session' }), [
    {
      type: 'stopped',
      sessionId: 'cancel-session',
      sequence: 1
    }
  ]);
  assert.equal(inputFinishedCount, 0);
  assert.equal(provider.feed({
    sessionId: 'cancel-session',
    sequence: 0,
    samples: new Float32Array([0.1])
  }), null);
  assert.deepEqual(provider.cancel({ sessionId: 'cancel-session' }), []);

  await provider.start({ sessionId: 'next-session', sampleRateHz: 16000 });
  assert.equal(streams.length, 2);

  await provider.dispose();
  await provider.dispose();
  await assert.rejects(
    provider.start({ sessionId: 'disposed-session', sampleRateHz: 16000 }),
    /ASR provider has been disposed/
  );
  assert.equal(streams.length, 2);
});

test('Paraformer provider reports the first missing model file before loading Sherpa', async () => {
  const { createParaformerAsrProvider } = require('../lib/asr');
  const provider = createParaformerAsrProvider({
    fileExists: file => !file.endsWith('decoder.int8.onnx'),
    loadSherpa: () => {
      throw new Error('Sherpa should not load when a model file is missing');
    }
  });

  await assert.rejects(
    provider.initialize(),
    /模型文件未找到: decoder\.int8\.onnx/
  );
});

test('Paraformer provider returns null for an empty recognition result', async () => {
  const { createParaformerAsrProvider } = require('../lib/asr');
  const stream = { acceptWaveform() {} };
  const recognizer = {
    createStream: () => stream,
    isReady: () => false,
    decode() {},
    getResult: () => ({ text: ' \n\t ' }),
    isEndpoint: () => false
  };
  const provider = createParaformerAsrProvider({
    fileExists: () => true,
    loadSherpa: () => ({
      OnlineRecognizer: class {
        constructor() {
          return recognizer;
        }
      }
    })
  });

  await provider.initialize();
  await provider.start({ sessionId: 'empty-session', sampleRateHz: 16000 });

  assert.equal(provider.feed({
    sessionId: 'empty-session',
    sequence: 0,
    samples: new Float32Array([0.1])
  }), null);
});
