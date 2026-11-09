'use strict';

const path = require('node:path');
const {assertAsrProvider} = require('./asr-provider');

const STREAMING_CAPABILITIES = Object.freeze({
  mode: 'streaming',
  emitsPartial: true,
  sampleRateHz: 16000
});

const PROVIDERS = Object.freeze({
  'sherpa.online-paraformer': Object.freeze({
    requiredRoles: Object.freeze(['encoder', 'decoder', 'tokens']),
    create: options => require('./asr').createParaformerAsrProvider(options),
    capabilities: STREAMING_CAPABILITIES
  }),
  'sherpa.online-ctc': Object.freeze({
    requiredRoles: Object.freeze(['model', 'tokens']),
    create: options => require('./zipformer-ctc-asr-provider').createZipformerCtcAsrProvider(options),
    capabilities: STREAMING_CAPABILITIES
  }),
  'sherpa.offline-sensevoice': Object.freeze({
    requiredRoles: Object.freeze(['model', 'tokens']),
    create: options => require('./sensevoice-asr-provider').createSenseVoiceAsrProvider(options),
    capabilities: Object.freeze({mode: 'utterance', emitsPartial: false, sampleRateHz: 16000, maxDurationMs: 300000})
  })
});

function getAsrProviderCapabilities(providerType) {
  if (!Object.hasOwn(PROVIDERS, providerType)) throw new Error(`Unsupported ASR provider type: ${providerType}`);
  return PROVIDERS[providerType].capabilities;
}

function createAsrProvider({catalogEntry, modelFiles} = {}) {
  const providerType = catalogEntry?.providerType;
  const capabilities = getAsrProviderCapabilities(providerType);
  const definition = PROVIDERS[providerType];

  const trustedFiles = {};
  for (const role of definition.requiredRoles) {
    const filePath = modelFiles?.[role];
    if (typeof filePath !== 'string') throw new Error(`ASR model is missing ${role}`);
    if (!path.isAbsolute(filePath)) throw new Error(`ASR model ${role} must be an absolute path`);
    trustedFiles[role] = filePath;
  }

  const provider = assertAsrProvider(definition.create({modelFiles: Object.freeze(trustedFiles)}));
  return Object.freeze({provider, capabilities});
}

module.exports = {createAsrProvider, getAsrProviderCapabilities};
