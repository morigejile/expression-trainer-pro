'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {createAsrSessionProvider} = require('./asr-session');

function createZipformerCtcAsrProvider({
  modelFiles,
  fileExists = fs.existsSync,
  loadSherpa = () => require('sherpa-onnx-node')
} = {}) {
  let recognizer = null;
  let stream = null;
  let running = false;

  async function initialize() {
    if (recognizer) return;
    for (const role of ['model', 'tokens']) {
      const value = modelFiles?.[role];
      if (typeof value !== 'string' || !path.isAbsolute(value) || !fileExists(value)) {
        throw new Error(`模型文件未找到: ${typeof value === 'string' ? path.basename(value) : role}`);
      }
    }
    const sherpa = loadSherpa();
    recognizer = new sherpa.OnlineRecognizer({
      featConfig: {sampleRate: 16000, featureDim: 80},
      modelConfig: {
        zipformer2Ctc: {model: modelFiles.model},
        tokens: modelFiles.tokens,
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
  }

  function start() {
    if (!recognizer) throw new Error('ASR provider has not been initialized');
    stream = recognizer.createStream();
    running = true;
  }

  function feed(samples) {
    if (!running || !stream || !recognizer) return null;
    stream.acceptWaveform({samples, sampleRate: 16000});
    while (recognizer.isReady(stream)) recognizer.decode(stream);
    const text = (recognizer.getResult(stream)?.text || '').trim();
    const endpoint = recognizer.isEndpoint(stream);
    if (endpoint && text) {
      recognizer.reset(stream);
      return {text, isFinal: true};
    }
    return text ? {text, isFinal: false} : null;
  }

  function stop() {
    running = false;
    let finalText = '';
    if (stream && recognizer) {
      try {
        stream.inputFinished();
        while (recognizer.isReady(stream)) recognizer.decode(stream);
        finalText = (recognizer.getResult(stream)?.text || '').trim();
      } finally {
        stream = null;
      }
    }
    return finalText;
  }

  function cancel() {
    running = false;
    stream = null;
  }

  function dispose() {
    running = false;
    stream = null;
    recognizer = null;
  }

  return createAsrSessionProvider({adapter: {initialize, start, feed, stop, cancel, dispose}});
}

module.exports = {createZipformerCtcAsrProvider};
