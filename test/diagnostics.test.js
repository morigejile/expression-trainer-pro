'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {createDiagnosticSnapshot} = require('../lib/diagnostics');

function modelRootFixture(t, pointer, modelId = 'paraformer-bilingual-zh-en') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-diagnostics-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const active = path.join(root, 'active');
  fs.mkdirSync(active, {recursive: true});
  fs.writeFileSync(path.join(active, `${modelId}.json`), JSON.stringify(pointer));
  return root;
}

test('diagnostic snapshot exports only the bounded support baseline', (t) => {
  const modelRoot = modelRootFixture(t, {
    schemaVersion: 1,
    modelId: 'paraformer-bilingual-zh-en',
    version: '2024-03-10',
    previousVersion: null,
    activatedAt: '2026-08-29T00:00:00.000Z'
  });
  const snapshot = createDiagnosticSnapshot({
    appVersion: '1.0.1',
    modelRoot,
    modelId: 'paraformer-bilingual-zh-en',
    platform: 'win32',
    arch: 'x64',
    osRelease: '10.0.26200',
    generatedAt: '2026-08-29T12:00:00.000Z',
    audioRates: {
      requestedSampleRateHz: 16000,
      contextSampleRateHz: 16000,
      trackSampleRateHz: 48000
    },
    asr: {
      initializationElapsedMs: 563664,
      lastErrorCategory: null
    }
  });

  assert.deepEqual(snapshot, {
    schemaVersion: 1,
    generatedAt: '2026-08-29T12:00:00.000Z',
    application: {version: '1.0.1'},
    system: {platform: 'win32', arch: 'x64', release: '10.0.26200'},
    asr: {
      model: {id: 'paraformer-bilingual-zh-en', version: '2024-03-10', status: 'active'},
      sampleRatesHz: {requested: 16000, context: 16000, track: 48000},
      initializationElapsedMs: 563664,
      lastErrorCategory: null
    }
  });
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(modelRoot.replaceAll('\\', '\\\\')));
});

test('diagnostic snapshot reports the effective Zipformer model from the external model root', (t) => {
  const modelId = 'zipformer-large-ctc-zh-int8-2025-06-30';
  const modelRoot = modelRootFixture(t, {schemaVersion: 1, modelId, version: '2025-06-30'}, modelId);
  const snapshot = createDiagnosticSnapshot({
    appVersion: '1.0.1', modelRoot, modelId, platform: 'win32', arch: 'x64',
    osRelease: 'fixture', generatedAt: '2026-08-31T12:00:00.000Z'
  });
  assert.deepEqual(snapshot.asr.model, {id: modelId, version: '2025-06-30', status: 'active'});
});

test('diagnostic snapshot contains corrupt model state without paths or raw errors', (t) => {
  const modelRoot = modelRootFixture(t, {schemaVersion: 99, path: 'C:\\secret\\model'});
  const snapshot = createDiagnosticSnapshot({
    appVersion: '1.0.1',
    modelRoot,
    modelId: 'paraformer-bilingual-zh-en',
    platform: 'win32',
    arch: 'x64',
    osRelease: 'fixture',
    generatedAt: '2026-08-29T12:00:00.000Z'
  });

  assert.deepEqual(snapshot.asr.model, {
    id: 'paraformer-bilingual-zh-en',
    version: null,
    status: 'unavailable'
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /secret|modelPath|C:\\/i);
});

test('diagnostic snapshot rejects renderer-controlled extra fields and unsafe error categories', (t) => {
  const modelRoot = modelRootFixture(t, {
    schemaVersion: 1,
    modelId: 'paraformer-bilingual-zh-en',
    version: '2024-03-10'
  });
  assert.throws(() => createDiagnosticSnapshot({
    appVersion: '1.0.1',
    modelRoot,
    modelId: 'paraformer-bilingual-zh-en',
    audioRates: {requestedSampleRateHz: 16000, transcript: 'private'}
  }), /diagnostic/i);
  assert.throws(() => createDiagnosticSnapshot({
    appVersion: '1.0.1',
    modelRoot,
    modelId: 'paraformer-bilingual-zh-en',
    asr: {initializationElapsedMs: 1, lastErrorCategory: 'C:\\private\\stack'}
  }), /invalid/i);
});
