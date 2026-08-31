'use strict';

const {spawn} = require('node:child_process');
const path = require('node:path');
const {stageInternalModelArchive} = require('../lib/internal-model-build');
const catalog = require('../models/registry.json');

async function main() {
  const archivePath = process.env.EXPRESSION_TRAINER_INTERNAL_MODEL_ARCHIVE;
  if (!archivePath || !path.isAbsolute(archivePath)) {
    throw new Error('EXPRESSION_TRAINER_INTERNAL_MODEL_ARCHIVE must be an absolute path');
  }
  const outputRoot = path.resolve('out', 'internal-model-resource');
  const staged = await stageInternalModelArchive({archivePath, outputRoot, catalog});
  const cli = path.join(path.dirname(require.resolve('@electron-forge/cli/package.json')), 'dist', 'electron-forge.js');
  const child = spawn(process.execPath, [cli, 'make', '--platform=win32', '--arch=x64'], {
    env: {
      ...process.env,
      EXPRESSION_TRAINER_INTERNAL_BUILD: '1',
      EXPRESSION_TRAINER_INTERNAL_MODEL_RESOURCE_ROOT: staged.resourceRoot
    },
    stdio: 'inherit',
    windowsHide: true
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) throw new Error(`Internal model Forge make failed with code ${code}`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
