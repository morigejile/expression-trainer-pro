'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const forgeConfig = require('../forge.config');
const {createForgeConfig} = forgeConfig;

test('Windows package keeps the complete Sherpa native bundle outside ASAR', () => {
  assert.deepEqual(forgeConfig.packagerConfig.asar, {
    unpackDir: path.join('node_modules', 'sherpa-onnx-win-x64')
  });
});

test('package payload excludes development-only trees but keeps runtime assets', () => {
  const {ignore} = forgeConfig.packagerConfig;
  assert.equal(ignore('/docs/architecture.md'), true);
  assert.equal(ignore('/benchmark/run.js'), true);
  assert.equal(ignore('/out/previous-package/resources/app.asar'), true);
  assert.equal(ignore('/test/asr-ipc.test.js'), true);
  assert.equal(ignore('/scripts/verify-packaged-app.js'), true);
  assert.equal(ignore('/data/tiered-lexicon.json'), true);
  assert.equal(ignore('/models/.gitkeep'), true);
  assert.equal(ignore('/.nvmrc'), true);
  assert.equal(ignore('/.npmrc'), true);
  assert.equal(ignore('/forge.config.js'), true);
  assert.equal(ignore('/package-lock.json'), true);
  assert.equal(ignore('/README.md'), true);
  assert.equal(ignore('/CHANGELOG.md'), true);
  assert.equal(ignore('/node_modules/electron/dist/electron.exe'), true);
  assert.equal(ignore('/node_modules/sherpa-onnx-win-x64/sherpa-onnx.node'), false);
  assert.equal(ignore('/lib/asr-utility-process.js'), false);
  assert.equal(ignore('/lib/model-install-utility-process.js'), false);
  assert.equal(ignore('/models/registry.json'), false);
  assert.equal(ignore('/smoke/electron-smoke-runner.js'), false);
  assert.equal(ignore('/src/index.html'), false);
});

test('development toolchain follows the current Node Active LTS bundle', () => {
  const manifest = require('../package.json');
  const nvmVersion = fs.readFileSync(path.join(__dirname, '..', '.nvmrc'), 'utf8').trim();

  assert.equal(nvmVersion, '24.20.0');
  assert.equal(manifest.packageManager, 'npm@11.19.0');
  assert.deepEqual(manifest.engines, {
    node: '>=24.20.0 <25',
    npm: '>=11.19.0 <12'
  });
});

test('first packaging closure targets only Windows x64 Squirrel', () => {
  assert.equal(forgeConfig.packagerConfig.arch, 'x64');
  assert.equal(forgeConfig.makers.length, 1);
  assert.equal(forgeConfig.makers[0].name, '@electron-forge/maker-squirrel');
  assert.deepEqual(forgeConfig.makers[0].platforms, ['win32']);
});

test('ordinary packages remain model-free', () => {
  const config = createForgeConfig({environment: {}});
  assert.equal(config.packagerConfig.extraResource, undefined);
});

test('internal model resources require an explicit mode and absolute staging root', () => {
  assert.throws(
    () => createForgeConfig({environment: {EXPRESSION_TRAINER_INTERNAL_MODEL_RESOURCE_ROOT: 'relative'}}),
    /requires EXPRESSION_TRAINER_INTERNAL_BUILD=1/
  );
  assert.throws(
    () => createForgeConfig({environment: {
      EXPRESSION_TRAINER_INTERNAL_BUILD: '1',
      EXPRESSION_TRAINER_INTERNAL_MODEL_RESOURCE_ROOT: 'relative'
    }}),
    /resource root must be absolute/
  );

  const resourceRoot = path.resolve('out', 'internal-model-resource');
  const config = createForgeConfig({environment: {
    EXPRESSION_TRAINER_INTERNAL_BUILD: '1',
    EXPRESSION_TRAINER_INTERNAL_MODEL_RESOURCE_ROOT: resourceRoot
  }});
  assert.deepEqual(config.packagerConfig.extraResource, [path.join(resourceRoot, 'asr-models')]);
});

test('first-install smoke remains an explicit non-default command', () => {
  const manifest = require('../package.json');
  assert.equal(manifest.scripts['smoke:first-install'], 'node scripts/verify-first-install.js');
  assert.doesNotMatch(manifest.scripts.test, /first-install/);
});

test('bundled-default qualification remains an explicit non-default command', () => {
  const manifest = require('../package.json');
  assert.equal(manifest.scripts['smoke:bundled-default'], 'node scripts/verify-bundled-default.js');
  assert.doesNotMatch(manifest.scripts.test, /bundled-default/);
});

test('first-install smoke follows the current package version', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'verify-first-install.js'), 'utf8');
  assert.match(source, /require\('\.\.\/package\.json'\)\.version/);
  assert.doesNotMatch(source, /app-1\.0\.0/);
});
