'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {atomicWriteJsonSync} = require('./atomic-json-store');
const {normalizeTrainingContext} = require('../shared/training-context');

function loadTrainingSetup(root) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, 'training-setup.json'), 'utf8'));
    if (![1,2].includes(value?.schemaVersion) || Object.keys(value).some(key =>
      !['schemaVersion','trainingMode','framework','frameworkDefinitionVersion','trainingPrompt'].includes(key))) throw new Error('Unsupported setup');
    return normalizeTrainingContext(value);
  } catch (error) {
    if (error.code === 'ENOENT') return normalizeTrainingContext();
    throw Object.assign(new Error('Training setup unavailable'), {code:'SETUP_UNAVAILABLE'});
  }
}

function saveTrainingSetup(root, context) {
  // Preserve unreadable and future files; a preference failure must not undo a session.
  loadTrainingSetup(root);
  atomicWriteJsonSync(path.join(root, 'training-setup.json'), {schemaVersion:2, ...normalizeTrainingContext(context)});
}
module.exports = {loadTrainingSetup, saveTrainingSetup};
