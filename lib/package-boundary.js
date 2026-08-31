'use strict';

const fs = require('node:fs');
const path = require('node:path');

function assertOrdinaryPackageModelFree(resourcesPath) {
  if (fs.existsSync(path.join(resourcesPath, 'asr-models'))) {
    throw new Error('Ordinary package must not contain bundled ASR models');
  }
}

module.exports = {assertOrdinaryPackageModelFree};
