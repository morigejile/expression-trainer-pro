const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function fixture(t, overrides = {}) {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-model-manager-'));
  t.after(() => fs.rmSync(userDataPath, {recursive: true, force: true}));
  const archive = Buffer.from('fixture-archive-v1');
  const runtimeFiles = {
    'encoder.int8.onnx': Buffer.from('encoder-v1'),
    'decoder.int8.onnx': Buffer.from('decoder-v1'),
    'tokens.txt': Buffer.from('tokens-v1')
  };
  const model = {
    id: 'paraformer-bilingual-zh-en',
    version: '2024-03-10',
    engine: 'sherpa-onnx',
    architecture: 'paraformer',
    languages: ['zh', 'en'],
    mode: 'streaming',
    sampleRateHz: 16000,
    minAppVersion: '1.0.0',
    archive: {
      url: 'https://example.test/paraformer.tar.bz2',
      sha256: sha256(archive),
      bytes: archive.length,
      format: 'tar.bz2',
      rootDirectory: 'archive-root'
    },
    files: Object.entries(runtimeFiles).map(([relativePath, bytes]) => ({
      relativePath,
      sha256: sha256(bytes),
      bytes: bytes.length,
      role: relativePath.split('.')[0]
    })),
    license: {redistribution: 'not-approved'}
  };
  const registry = {schemaVersion: 1, defaultModelId: model.id, models: [model]};
  const extractArchive = async ({destination}) => {
    const root = path.join(destination, model.archive.rootDirectory);
    fs.mkdirSync(root, {recursive: true});
    for (const [relativePath, bytes] of Object.entries(runtimeFiles)) {
      fs.writeFileSync(path.join(root, relativePath), bytes);
    }
  };
  const fetchImpl = async () => new Response(archive, {
    status: 200,
    headers: {'content-length': String(archive.length)}
  });
  return {archive, extractArchive, fetchImpl, model, registry, runtimeFiles, userDataPath, ...overrides};
}

test('model registry accepts one exact versioned HTTPS model and rejects unsafe input', (t) => {
  const {validateModelRegistry} = require('../lib/model-manager');
  const {registry} = fixture(t);
  assert.equal(validateModelRegistry(registry), registry);

  const insecure = structuredClone(registry);
  insecure.models[0].archive.url = 'http://example.test/model.tar.bz2';
  assert.throws(() => validateModelRegistry(insecure), /HTTPS/);

  const traversal = structuredClone(registry);
  traversal.models[0].files[0].relativePath = '../encoder.onnx';
  assert.throws(() => validateModelRegistry(traversal), /relative path/);

  const duplicate = structuredClone(registry);
  duplicate.models.push(structuredClone(duplicate.models[0]));
  assert.throws(() => validateModelRegistry(duplicate), /duplicate/);
});

test('committed product registry pins the accepted Paraformer artifact and runtime files', () => {
  const {validateModelRegistry} = require('../lib/model-manager');
  const registry = require('../models/registry.json');
  validateModelRegistry(registry);
  assert.equal(registry.defaultModelId, 'paraformer-bilingual-zh-en');
  assert.deepEqual(
    registry.models[0].files.map(({role}) => role),
    ['encoder', 'decoder', 'tokens']
  );
  assert.equal(registry.models[0].license.redistribution, 'not-approved');
});

test('archive entry validation rejects absolute and traversal extraction targets', () => {
  const {validateArchiveEntry} = require('../lib/model-manager');
  assert.doesNotThrow(() => validateArchiveEntry('model/tokens.txt'));
  assert.throws(() => validateArchiveEntry('../outside.txt'), /unsafe path/);
  assert.throws(() => validateArchiveEntry('model/../../outside.txt'), /unsafe path/);
  assert.throws(() => validateArchiveEntry('C:\\outside.txt'), /unsafe path/);
  assert.throws(() => validateArchiveEntry('/outside.txt'), /unsafe path/);
});

test('install verifies staged bytes, atomically publishes a version, and activates it', async (t) => {
  const {createModelManager} = require('../lib/model-manager');
  const data = fixture(t);
  const manager = createModelManager({...data, appVersion: '1.0.0'});

  const installed = await manager.install(data.model.id, {activate: true});
  const active = await manager.getActive(data.model.id);

  assert.equal(installed.reused, false);
  assert.equal(installed.modelPath, path.join(data.userDataPath, 'models', data.model.id, data.model.version));
  assert.equal(active.modelPath, installed.modelPath);
  assert.equal(active.version, data.model.version);
  assert.equal(fs.readFileSync(path.join(active.modelPath, 'tokens.txt'), 'utf8'), 'tokens-v1');
  assert.deepEqual(fs.readdirSync(path.join(data.userDataPath, 'models', '.staging')), []);
});

test('an interrupted download leaves the active version and staging area unchanged', async (t) => {
  const {createModelManager} = require('../lib/model-manager');
  const data = fixture(t);
  const manager = createModelManager({...data, appVersion: '1.0.0'});
  await manager.install(data.model.id, {activate: true});
  const before = await manager.getActive(data.model.id);
  const nextRegistry = structuredClone(data.registry);
  nextRegistry.models[0].version = '2024-03-11';
  const interrupted = createModelManager({
    ...data,
    registry: nextRegistry,
    appVersion: '1.0.0',
    fetchImpl: async () => { throw new DOMException('cancelled', 'AbortError'); }
  });

  await assert.rejects(interrupted.install(data.model.id), /cancelled|aborted/i);
  assert.deepEqual(await manager.getActive(data.model.id), before);
  assert.deepEqual(fs.readdirSync(path.join(data.userDataPath, 'models', '.staging')), []);
});

test('a successful upgrade replaces the pointer while preserving the previous version', async (t) => {
  const {createModelManager} = require('../lib/model-manager');
  const data = fixture(t);
  const first = createModelManager({...data, appVersion: '1.0.0'});
  await first.install(data.model.id, {activate: true});
  const previousPath = path.join(data.userDataPath, 'models', data.model.id, data.model.version);

  const nextRegistry = structuredClone(data.registry);
  const nextModel = structuredClone(nextRegistry.models[0]);
  nextModel.version = '2024-03-11';
  nextRegistry.models.push(nextModel);
  const next = createModelManager({...data, registry: nextRegistry, appVersion: '1.0.0'});
  const installed = await next.install(data.model.id, {activate: true});
  const active = await next.getActive(data.model.id);

  assert.equal(active.version, '2024-03-11');
  assert.equal(active.modelPath, installed.modelPath);
  assert.equal(fs.existsSync(previousPath), true);

  const rolledBack = await next.rollback(data.model.id);
  assert.equal(rolledBack.version, '2024-03-10');
  assert.equal((await next.getActive(data.model.id)).version, '2024-03-10');
});

test('download byte limit rejects an oversized body without trusting headers', async (t) => {
  const {createModelManager} = require('../lib/model-manager');
  const data = fixture(t);
  const oversized = Buffer.concat([data.archive, Buffer.from('unexpected')]);
  const manager = createModelManager({
    ...data,
    appVersion: '1.0.0',
    fetchImpl: async () => new Response(oversized, {status: 200})
  });

  await assert.rejects(manager.install(data.model.id), /exceeds registered byte size/);
  assert.deepEqual(fs.readdirSync(path.join(data.userDataPath, 'models', '.staging')), []);
});

test('a wrong archive hash or extraction failure never replaces the active version', async (t) => {
  const {createModelManager} = require('../lib/model-manager');
  const data = fixture(t);
  const manager = createModelManager({...data, appVersion: '1.0.0'});
  await manager.install(data.model.id, {activate: true});
  const activePointer = fs.readFileSync(path.join(data.userDataPath, 'models', 'active', `${data.model.id}.json`), 'utf8');

  const wrongHashRegistry = structuredClone(data.registry);
  wrongHashRegistry.models[0].version = '2024-03-11';
  wrongHashRegistry.models[0].archive.sha256 = '0'.repeat(64);
  await assert.rejects(
    createModelManager({...data, registry: wrongHashRegistry, appVersion: '1.0.0'}).install(data.model.id, {activate: true}),
    /SHA-256 mismatch/
  );

  const extractionRegistry = structuredClone(data.registry);
  extractionRegistry.models[0].version = '2024-03-12';
  await assert.rejects(
    createModelManager({...data, registry: extractionRegistry, appVersion: '1.0.0', extractArchive: async () => { throw new Error('extract failed'); }}).install(data.model.id, {activate: true}),
    /extract failed/
  );

  assert.equal(fs.readFileSync(path.join(data.userDataPath, 'models', 'active', `${data.model.id}.json`), 'utf8'), activePointer);
  assert.deepEqual(fs.readdirSync(path.join(data.userDataPath, 'models', '.staging')), []);
});

test('insufficient free space fails before download and preserves installed state', async (t) => {
  const {createModelManager} = require('../lib/model-manager');
  const data = fixture(t);
  let fetched = false;
  const manager = createModelManager({
    ...data,
    appVersion: '1.0.0',
    fetchImpl: async (...args) => { fetched = true; return data.fetchImpl(...args); },
    statfsImpl: async () => ({bavail: 0, bsize: 4096})
  });

  await assert.rejects(manager.install(data.model.id), /free space/);
  assert.equal(fetched, false);
  assert.deepEqual(fs.readdirSync(path.join(data.userDataPath, 'models', '.staging')), []);
});
