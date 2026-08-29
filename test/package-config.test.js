'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const forgeConfig = require('../forge.config');

test('Windows package keeps the complete Sherpa native bundle outside ASAR', () => {
  assert.deepEqual(forgeConfig.packagerConfig.asar, {
    unpackDir: path.join('node_modules', 'sherpa-onnx-win-x64')
  });
});

test('package payload excludes development-only trees but keeps runtime assets', () => {
  const {ignore} = forgeConfig.packagerConfig;
  assert.equal(ignore('/docs/architecture.md'), true);
  assert.equal(ignore('/benchmark/run.js'), true);
  assert.equal(ignore('/test/asr-ipc.test.js'), true);
  assert.equal(ignore('/lib/asr-utility-process.js'), false);
  assert.equal(ignore('/models/registry.json'), false);
  assert.equal(ignore('/smoke/electron-smoke-runner.js'), false);
  assert.equal(ignore('/src/index.html'), false);
});

test('first packaging closure targets only Windows x64 Squirrel', () => {
  assert.equal(forgeConfig.packagerConfig.arch, 'x64');
  assert.equal(forgeConfig.makers.length, 1);
  assert.equal(forgeConfig.makers[0].name, '@electron-forge/maker-squirrel');
  assert.deepEqual(forgeConfig.makers[0].platforms, ['win32']);
});
