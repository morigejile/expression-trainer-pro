'use strict';

const path = require('node:path');
const {assertAsrProvider} = require('./asr-provider');
const {createParaformerAsrProvider} = require('./asr');
const {createZipformerCtcAsrProvider} = require('./zipformer-ctc-asr-provider');

const STREAMING_CAPABILITIES = Object.freeze({
  mode: 'streaming',
  emitsPartial: true,
  sampleRateHz: 16000
});

const PROVIDERS = Object.freeze({
  'sherpa.online-paraformer': Object.freeze({
    requiredRoles: Object.freeze(['encoder', 'decoder', 'tokens']),
    create: createParaformerAsrProvider,
    capabilities: STREAMING_CAPABILITIES
  }),
  'sherpa.online-ctc': Object.freeze({
    requiredRoles: Object.freeze(['model', 'tokens']),
    create: createZipformerCtcAsrProvider,
    capabilities: STREAMING_CAPABILITIES
  })
});

function createAsrProvider({catalogEntry, modelFiles} = {}) {
  const providerType = catalogEntry?.providerType;
  const definition = PROVIDERS[providerType];
  if (!definition) throw new Error(`Unsupported ASR provider type: ${providerType}`);

  const trustedFiles = {};
  for (const role of definition.requiredRoles) {
    const filePath = modelFiles?.[role];
    if (typeof filePath !== 'string') throw new Error(`ASR model is missing ${role}`);
    if (!path.isAbsolute(filePath)) throw new Error(`ASR model ${role} must be an absolute path`);
    trustedFiles[role] = filePath;
  }

  const provider = assertAsrProvider(definition.create({modelFiles: Object.freeze(trustedFiles)}));
  return Object.freeze({provider, capabilities: definition.capabilities});
}

module.exports = {createAsrProvider};
