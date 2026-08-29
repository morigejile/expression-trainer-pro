'use strict';

function inspectSherpaNative(loadAddon = () => require('sherpa-onnx-node')) {
  const sherpa = loadAddon();
  if (typeof sherpa?.OnlineRecognizer !== 'function') {
    const error = new Error('Sherpa native addon does not expose OnlineRecognizer');
    error.code = 'sherpa-native-api-missing';
    throw error;
  }
  return {onlineRecognizerAvailable: true};
}

module.exports = {inspectSherpaNative};
