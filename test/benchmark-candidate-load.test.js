const test = require('node:test');
const assert = require('node:assert/strict');

test('SenseVoice is configured as utterance without fabricated partial events', () => {
  const { buildSherpaConfig } = require('../benchmark/models/load-candidate');
  const senseVoiceCandidate = {
    id: 'sensevoice-small-int8',
    family: 'sensevoice',
    mode: 'utterance',
    sampleRateHz: 16000,
    numThreads: 2,
    provider: 'cpu',
    files: [
      { relativePath: 'sensevoice/model.int8.onnx', role: 'model' },
      { relativePath: 'sensevoice/tokens.txt', role: 'tokens' }
    ]
  };

  const config = buildSherpaConfig(senseVoiceCandidate, 'C:\\model-root');

  assert.equal(senseVoiceCandidate.mode, 'utterance');
  assert.equal(config.recognizerKind, 'offline');
  assert.equal(config.modelConfig.senseVoice.useInverseTextNormalization, true);
  assert.equal(config.modelConfig.senseVoice.model, 'C:\\model-root\\sensevoice\\model.int8.onnx');
});
