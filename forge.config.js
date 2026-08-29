'use strict';

const path = require('node:path');

const DEVELOPMENT_ONLY_ROOTS = new Set([
  '.agents',
  '.codex',
  '.github',
  '.superpowers',
  '.worktrees',
  'benchmark',
  'docs',
  'test'
]);

function ignoreDevelopmentOnly(filePath) {
  const root = filePath.replaceAll('\\', '/').split('/').filter(Boolean)[0];
  return DEVELOPMENT_ONLY_ROOTS.has(root);
}

module.exports = {
  packagerConfig: {
    arch: 'x64',
    executableName: 'ExpressionTrainer',
    asar: {
      unpackDir: path.join('node_modules', 'sherpa-onnx-win-x64')
    },
    ignore: ignoreDevelopmentOnly
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'ExpressionTrainer',
        setupExe: 'ExpressionTrainerSetup.exe'
      }
    }
  ]
};
