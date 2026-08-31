'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {assertOrdinaryPackageModelFree} = require('../lib/package-boundary');

test('ordinary package boundary rejects bundled ASR model resources', (t) => {
  const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ordinary-package-boundary-'));
  t.after(() => fs.rmSync(resourcesPath, {recursive: true, force: true}));

  assert.doesNotThrow(() => assertOrdinaryPackageModelFree(resourcesPath));
  fs.mkdirSync(path.join(resourcesPath, 'asr-models'), {recursive: true});
  assert.throws(
    () => assertOrdinaryPackageModelFree(resourcesPath),
    /must not contain bundled ASR models/
  );
});

test('ordinary package boundary rejects model weights hidden inside ASAR', (t) => {
  const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ordinary-asar-boundary-'));
  t.after(() => fs.rmSync(resourcesPath, {recursive: true, force: true}));
  fs.writeFileSync(path.join(resourcesPath, 'app.asar'), 'fixture');

  assert.throws(
    () => assertOrdinaryPackageModelFree(resourcesPath, {
      listPackage: () => ['/models/registry.json', '/local-models/default.onnx']
    }),
    /ASAR must not contain model weights or archives/
  );
});
