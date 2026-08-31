'use strict';

const {createAsrModelService} = require('./asr-model-service');
const {loadModelCatalog} = require('./model-catalog');

function parseAsrModelOverride(argv, catalogInput) {
  if (!Array.isArray(argv)) throw new TypeError('Application arguments must be an array');
  const catalog = loadModelCatalog(catalogInput);
  if (argv.includes('--asr-model')) throw new Error('ASR model override must use --asr-model=<modelId>');
  const values = argv
    .filter(argument => typeof argument === 'string' && argument.startsWith('--asr-model='))
    .map(argument => argument.slice('--asr-model='.length));
  if (values.length === 0) return null;
  if (values.length !== 1 || values[0] === '') throw new Error('ASR model override must be provided exactly once');
  if (!catalog.models.some(({modelId}) => modelId === values[0])) {
    throw new Error('ASR model override is not in the trusted Catalog');
  }
  return values[0];
}

function createAsrUtilityArgs({userDataPath, appVersion, modelId, installedOnly = false, offline = false} = {}) {
  const args = [
    '--user-data-path', userDataPath,
    '--app-version', appVersion,
    '--model-id', modelId
  ];
  if (installedOnly) args.push('--installed-only');
  if (offline) args.push('--offline-model-smoke');
  return args;
}

function createMainAsrProvider({
  argv,
  catalog,
  selectionStore,
  modelManager,
  createController
} = {}) {
  return createAsrModelService({
    catalog,
    selectionStore,
    modelManager,
    createController,
    overrideModelId: parseAsrModelOverride(argv, catalog)
  });
}

module.exports = {createAsrUtilityArgs, createMainAsrProvider, parseAsrModelOverride};
