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
