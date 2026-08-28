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
  const stream = {};

  const provider = createParaformerAsrProvider({
    modelRoot,
    fileExists: () => true,
    loadSherpa: () => ({
      OnlineRecognizer: class {
        constructor(config) {
          receivedConfig = config;
        }

        createStream() {
          return stream;
        }
      }
    })
  });

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
  const result = provider.feed(samples);

  assert.deepEqual(acceptedWaveform, { samples, sampleRate: 16000 });
  assert.deepEqual(result, { text: 'partial text', isFinal: false });
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
  const result = provider.feed(new Float32Array([0.1]));

  assert.equal(resetStream, stream);
  assert.deepEqual(result, { text: 'endpoint text', isFinal: true });
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
  const finalText = provider.stop();

  assert.equal(inputFinished, true);
  assert.equal(finalText, 'tail text');
});

test('Paraformer provider reuses its recognizer when initialized again', async () => {
  const { createParaformerAsrProvider } = require('../lib/asr');
  let recognizerCount = 0;
  let streamCount = 0;
  const provider = createParaformerAsrProvider({
    fileExists: () => true,
    loadSherpa: () => ({
      OnlineRecognizer: class {
        constructor() {
          recognizerCount += 1;
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

  assert.equal(recognizerCount, 1);
  assert.equal(streamCount, 2);
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

  assert.equal(provider.feed(new Float32Array([0.1])), null);
});
