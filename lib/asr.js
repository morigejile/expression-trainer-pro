/**
 * 语音识别模块 - 基于 sherpa-onnx-node
 * 使用 streaming recognizer 实现实时中文语音识别
 * 录音通过 Electron 渲染进程的 Web Audio API 采集，音频数据通过 IPC 传入
 */

const path = require('path');
const fs = require('fs');
const { createAsrSessionProvider } = require('./asr-session');

const MODELS_DIR = path.join(__dirname, '..', 'models');
const MODEL_SUBDIR = 'sherpa-onnx-streaming-paraformer-bilingual-zh-en';

function createParaformerAsrProvider({
  modelRoot = MODELS_DIR,
  fileExists = fs.existsSync,
  loadSherpa = () => require('sherpa-onnx-node')
} = {}) {
  let providerRecognizer = null;
  let providerStream = null;
  let providerRunning = false;

  async function initialize() {
    if (providerRecognizer) {
      return;
    }

    const modelDir = path.join(modelRoot, MODEL_SUBDIR);
    for (const file of ['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt']) {
      if (!fileExists(path.join(modelDir, file))) {
        throw new Error(
          `模型文件未找到: ${file}\n` +
          `请确认 models/${MODEL_SUBDIR}/ 目录下有完整的模型文件`
        );
      }
    }

    const sherpa = loadSherpa();
    const config = {
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
    };

    providerRecognizer = new sherpa.OnlineRecognizer(config);
  }

  function start() {
    if (!providerRecognizer) {
      throw new Error('ASR provider has not been initialized');
    }
    providerStream = providerRecognizer.createStream();
    providerRunning = true;
  }

  function feed(samples) {
    if (!providerRunning || !providerStream || !providerRecognizer) return null;

    providerStream.acceptWaveform({ samples, sampleRate: 16000 });
    while (providerRecognizer.isReady(providerStream)) {
      providerRecognizer.decode(providerStream);
    }

    const result = providerRecognizer.getResult(providerStream);
    const text = (result.text || '').trim();
    const isEndpoint = providerRecognizer.isEndpoint(providerStream);

    if (isEndpoint && text) {
      providerRecognizer.reset(providerStream);
      return { text, isFinal: true };
    }
    return text ? { text, isFinal: false } : null;
  }

  function stop() {
    providerRunning = false;

    let finalText = '';
    if (providerStream && providerRecognizer) {
      providerStream.inputFinished();
      while (providerRecognizer.isReady(providerStream)) {
        providerRecognizer.decode(providerStream);
      }
      const result = providerRecognizer.getResult(providerStream);
      finalText = (result.text || '').trim();
      providerStream = null;
    }
    return finalText;
  }

  function cancel() {
    providerRunning = false;
    providerStream = null;
  }

  function dispose() {
    providerRunning = false;
    providerStream = null;
    providerRecognizer = null;
  }

  return createAsrSessionProvider({
    adapter: { initialize, start, feed, stop, cancel, dispose }
  });
}

module.exports = { createParaformerAsrProvider };
