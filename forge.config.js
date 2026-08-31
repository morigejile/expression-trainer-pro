'use strict';

const path = require('node:path');
const modelCatalog = require('./models/registry.json');
const {verifyInternalModelResourceTree} = require('./lib/internal-model-build');

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
  if (root === 'models' && normalizedPath !== 'models' && normalizedPath !== 'models/registry.json') return true;
  if (NON_RUNTIME_FILES.has(normalizedPath)) return true;
  return root === 'node_modules' && ['.bin', 'electron', 'electron-nightly'].includes(parts[1]);
}

function createForgeConfig({environment = process.env, catalog = modelCatalog} = {}) {
  const internalBuild = environment.EXPRESSION_TRAINER_INTERNAL_BUILD;
  const internalResourceRoot = environment.EXPRESSION_TRAINER_INTERNAL_MODEL_RESOURCE_ROOT;
  if (internalResourceRoot && internalBuild !== '1') {
    throw new Error('Internal model resource root requires EXPRESSION_TRAINER_INTERNAL_BUILD=1');
  }
  if (internalBuild === '1' && (!internalResourceRoot || !path.isAbsolute(internalResourceRoot))) {
    throw new Error('Internal model resource root must be absolute');
  }

  const packagerConfig = {
    arch: 'x64',
    executableName: 'ExpressionTrainer',
    asar: {
      unpackDir: path.join('node_modules', 'sherpa-onnx-win-x64')
    },
    ignore: ignoreDevelopmentOnly
  };
  if (internalBuild === '1') {
    verifyInternalModelResourceTree({resourceRoot: internalResourceRoot, catalog});
    packagerConfig.extraResource = [path.join(internalResourceRoot, 'asr-models')];
  }
  const makerName = internalBuild === '1' ? 'ExpressionTrainerInternalOnly' : 'ExpressionTrainer';
  return {
    packagerConfig,
    makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: makerName,
        setupExe: `${makerName}Setup.exe`
      }
    }
    ]
  };
}

const forgeConfig = createForgeConfig();
Object.defineProperty(forgeConfig, 'createForgeConfig', {value: createForgeConfig});
module.exports = forgeConfig;
