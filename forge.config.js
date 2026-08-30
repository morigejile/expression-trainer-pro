'use strict';

const path = require('node:path');

const DEVELOPMENT_ONLY_ROOTS = new Set([
  '.agents',
  '.codex',
  '.git',
  '.github',
  '.superpowers',
  '.worktrees',
  'benchmark',
  'dist',
  'docs',
  'out',
  'scripts',
  'test'
]);

const NON_RUNTIME_FILES = new Set([
  '.gitattributes',
  '.gitignore',
  '.npmrc',
  '.nvmrc',
  'CHANGELOG.md',
  'README.md',
  'data/tiered-lexicon.json',
  'forge.config.js',
  'models/.gitkeep',
  'package-lock.json'
]);

function ignoreDevelopmentOnly(filePath) {
  const normalizedPath = filePath.replaceAll('\\', '/').replace(/^\/+/, '');
  const parts = normalizedPath.split('/').filter(Boolean);
  const root = parts[0];
  if (DEVELOPMENT_ONLY_ROOTS.has(root)) return true;
  if (NON_RUNTIME_FILES.has(normalizedPath)) return true;
  return root === 'node_modules' && ['.bin', 'electron', 'electron-nightly'].includes(parts[1]);
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
