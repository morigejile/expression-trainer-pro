'use strict';

const {loadModelCatalog} = require('./model-catalog');

function valuesFor(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name) values.push(argv[index + 1]);
  }
  return values;
}

function oneValue(argv, name, label) {
  const values = valuesFor(argv, name);
  if (values.length !== 1 || typeof values[0] !== 'string' || values[0] === '' || values[0].startsWith('--')) {
    throw new Error(`Managed ASR utility requires exactly one ${label}`);
  }
  return values[0];
}

function resolveManagedAsrOptions(argv, catalogInput) {
  if (!Array.isArray(argv)) throw new TypeError('Managed ASR utility arguments must be an array');
  const catalog = loadModelCatalog(catalogInput);
  const modelId = oneValue(argv, '--model-id', 'model ID');
  const catalogEntry = catalog.models.find(model => model.modelId === modelId);
  if (!catalogEntry) throw new Error(`Managed ASR utility model is not trusted: ${modelId}`);
  return Object.freeze({
    userDataPath: oneValue(argv, '--user-data-path', 'userData path'),
    appVersion: oneValue(argv, '--app-version', 'app version'),
    modelId,
    catalogEntry,
    installedOnly: argv.includes('--installed-only')
  });
}

module.exports = {resolveManagedAsrOptions};
