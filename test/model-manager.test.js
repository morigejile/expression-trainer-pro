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
    modelId: 'paraformer-bilingual-zh-en',
    version: '2024-03-10',
    displayName: 'Fixture Paraformer',
    description: 'Streaming fixture model',
    providerType: 'sherpa.online-paraformer',
    minAppVersion: '1.0.0',
    downloadBytes: archive.length,
    sources: [{
      type: 'archive',
      url: 'https://example.test/paraformer.tar.bz2',
      sha256: sha256(archive),
      bytes: archive.length,
      format: 'tar.bz2',
      rootDirectory: 'archive-root',
      builtIn: false
    }],
    files: Object.entries(runtimeFiles).map(([relativePath, bytes]) => ({
      relativePath,
      sha256: sha256(bytes),
      bytes: bytes.length,
      role: relativePath.split('.')[0]
    })),
    license: {
      sourceUrl: 'https://example.test/license',
      notice: 'Fixture only',
      redistribution: 'not-approved'
    }
  };
  const registry = {schemaVersion: 2, defaultModelId: model.modelId, models: [model]};
  const extractArchive = async ({destination}) => {
    const root = path.join(destination, model.sources[0].rootDirectory);
    fs.mkdirSync(root, {recursive: true});
    for (const [relativePath, bytes] of Object.entries(runtimeFiles)) {
      fs.writeFileSync(path.join(root, relativePath), bytes);
    }
  };
  const fetchImpl = async () => new Response(archive, {
    status: 200,
    headers: {'content-length': String(archive.length)}
  });
  return {
    archive,
    extractArchive,
    fetchImpl,
    model: {...model, id: model.modelId, archive: model.sources[0]},
    registry,
    runtimeFiles,
    userDataPath,
    ...overrides
  };
}

test('ModelManager accepts one validated fixed archive source', (t) => {
  const {loadModelCatalog} = require('../lib/model-catalog');
  const {registry} = fixture(t);
  assert.equal(loadModelCatalog(registry).models[0].sources[0].type, 'archive');
});

test('ModelManager rejects source layouts outside the current single-archive streaming path', async (t) => {
  const {createModelManager} = require('../lib/model-manager');
  const data = fixture(t);
  const fileRegistry = structuredClone(data.registry);
  const runtimeFile = fileRegistry.models[0].files[0];
  fileRegistry.models[0].downloadBytes = runtimeFile.bytes;
  fileRegistry.models[0].sources = [{
    type: 'file',
    url: 'https://example.test/encoder.int8.onnx',
    sha256: runtimeFile.sha256,
    bytes: runtimeFile.bytes,
    relativePath: runtimeFile.relativePath,
    builtIn: false
  }];
  const manager = createModelManager({...data, registry: fileRegistry, appVersion: '1.0.0'});
  await assert.rejects(manager.install(data.model.id), /unsupported source layout/);
});

test('committed product registry pins the accepted Paraformer artifact and runtime files', () => {
  const {loadModelCatalog} = require('../lib/model-catalog');
  const registry = loadModelCatalog(require('../models/registry.json'));
  const paraformer = registry.models.find(model => model.modelId === 'paraformer-bilingual-zh-en');
  assert.equal(registry.defaultModelId, 'zipformer-large-ctc-zh-int8-2025-06-30');
  assert.deepEqual(
    paraformer.files.map(({role}) => role),
    ['encoder', 'decoder', 'tokens']
  );
  assert.equal(paraformer.license.redistribution, 'not-approved');
});

test('archive entry validation rejects absolute and traversal extraction targets', () => {
  const {validateArchiveEntry} = require('../lib/model-manager');
  assert.doesNotThrow(() => validateArchiveEntry('model/tokens.txt'));
  assert.throws(() => validateArchiveEntry('../outside.txt'), /unsafe path/);
  assert.throws(() => validateArchiveEntry('model/../../outside.txt'), /unsafe path/);
  assert.throws(() => validateArchiveEntry('C:\\outside.txt'), /unsafe path/);
  assert.throws(() => validateArchiveEntry('/outside.txt'), /unsafe path/);
});

test('read-only active lookup does not create managed model roots', async (t) => {
  const {createModelManager} = require('../lib/model-manager');
  const data = fixture(t);
  const manager = createModelManager({...data, appVersion: '1.0.0'});
  const modelsRoot = path.join(data.userDataPath, 'models');

  assert.equal(await manager.getActive(data.model.id), null);
  assert.equal(fs.existsSync(modelsRoot), false);
});

test('an explicit model root keeps native model files outside Unicode userData', async (t) => {
  const {createModelManager} = require('../lib/model-manager');
  const data = fixture(t);
  const unicodeUserDataPath = path.join(data.userDataPath, '宇宙无敌表达训练');
  const modelRoot = path.join(data.userDataPath, 'expression-trainer-pro-models');
  fs.mkdirSync(unicodeUserDataPath);
  const manager = createModelManager({...data, userDataPath: unicodeUserDataPath, modelRoot, appVersion: '1.0.0'});

  const installed = await manager.install(data.model.id, {activate: true});

  assert.equal(installed.modelPath, path.join(modelRoot, data.model.id, data.model.version));
  assert.equal(fs.existsSync(path.join(unicodeUserDataPath, 'models')), false);
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

test('a matching bundled archive uses the existing install transaction without network access', async (t) => {
  const {createModelManager} = require('../lib/model-manager');
  const data = fixture(t);
  const archivePath = path.join(data.userDataPath, 'packaged-model.tar.bz2');
  fs.writeFileSync(archivePath, data.archive);
  let extractedArchive;
  const progress = [];
  const manager = createModelManager({
    ...data,
    appVersion: '1.0.0',
    bundledArchive: {modelId: data.model.id, version: data.model.version, archivePath},
    fetchImpl: async () => { assert.fail('bundled install must not access the network'); },
    extractArchive: async (options) => {
      extractedArchive = fs.readFileSync(options.archivePath);
      await data.extractArchive(options);
    }
  });

  const installed = await manager.install(data.model.id, {
    activate: true,
    onProgress(value) { progress.push(value); }
  });

  assert.deepEqual(extractedArchive, data.archive);
  assert.equal(installed.reused, false);
  assert.equal((await manager.getActive(data.model.id)).version, data.model.version);
  assert.deepEqual(fs.readFileSync(archivePath), data.archive);
  assert.deepEqual(fs.readdirSync(path.join(data.userDataPath, 'models', '.staging')), []);
  assert.equal(progress[0].phase, 'downloading');
  assert.equal(progress[0].receivedBytes, 0);
  assert.ok(progress.some(value => value.phase === 'downloading' && value.receivedBytes === data.archive.length));
  assert.ok(progress.some(value => value.phase === 'verifying'));
  assert.ok(progress.some(value => value.phase === 'installing'));
});

test('a corrupt bundled archive leaves no version, pointer, or staging operation', async (t) => {
  const {createModelManager} = require('../lib/model-manager');
  const data = fixture(t);
  const archivePath = path.join(data.userDataPath, 'corrupt-packaged-model.tar.bz2');
  fs.writeFileSync(archivePath, Buffer.from('fixture-archive-v0'));
  const manager = createModelManager({
    ...data,
    appVersion: '1.0.0',
    bundledArchive: {modelId: data.model.id, version: data.model.version, archivePath},
    fetchImpl: async () => { assert.fail('corrupt bundled install must not access the network'); }
  });

  await assert.rejects(manager.install(data.model.id, {activate: true}), /SHA-256 mismatch/);

  assert.equal(fs.existsSync(path.join(data.userDataPath, 'models', data.model.id, data.model.version)), false);
  assert.equal(fs.existsSync(path.join(data.userDataPath, 'models', 'active', `${data.model.id}.json`)), false);
  assert.deepEqual(fs.readdirSync(path.join(data.userDataPath, 'models', '.staging')), []);
});

test('ModelManager rejects a bundled archive that does not identify the Catalog default version', (t) => {
  const {createModelManager} = require('../lib/model-manager');
  const data = fixture(t);
  const archivePath = path.join(data.userDataPath, 'packaged-model.tar.bz2');
  fs.writeFileSync(archivePath, data.archive);

  assert.throws(() => createModelManager({
    ...data,
    appVersion: '1.0.0',
    bundledArchive: {modelId: 'other-model', version: data.model.version, archivePath}
  }), /must match the Catalog default model and version/);
  assert.throws(() => createModelManager({
    ...data,
    appVersion: '1.0.0',
    bundledArchive: {modelId: data.model.id, version: '2025-01-01', archivePath}
  }), /must match the Catalog default model and version/);
});

test('install reports bounded monotonic download and verification phases', async (t) => {
  const {createModelManager} = require('../lib/model-manager');
  const data = fixture(t);
  const progress = [];
  const manager = createModelManager({...data, appVersion: '1.0.0'});
  await manager.install(data.model.id, {onProgress(value) { progress.push(value); }});
  assert.equal(progress[0].phase, 'downloading');
  assert.equal(progress[0].receivedBytes, 0);
  assert.ok(progress.some(value => value.phase === 'downloading' && value.receivedBytes === data.archive.length));
  assert.ok(progress.some(value => value.phase === 'verifying'));
  assert.ok(progress.some(value => value.phase === 'installing'));
  for (const value of progress) {
    assert.deepEqual(Object.keys(value).sort(), ['phase', 'receivedBytes', 'totalBytes']);
    assert.ok(value.receivedBytes >= 0 && value.receivedBytes <= value.totalBytes);
  }
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

  await next.activate(data.model.id, '2024-03-11');
  assert.equal((await next.getActive(data.model.id)).previousVersion, '2024-03-10');
  const rolledBack = await next.rollback(data.model.id);
  assert.equal(rolledBack.version, '2024-03-10');
  assert.equal((await next.getActive(data.model.id)).version, '2024-03-10');
});

test('rollback can recover the previous version when the active files are corrupt', async (t) => {
  const {createModelManager} = require('../lib/model-manager');
  const data = fixture(t);
  const first = createModelManager({...data, appVersion: '1.0.0'});
  await first.install(data.model.id, {activate: true});

  const registry = structuredClone(data.registry);
  const nextModel = structuredClone(registry.models[0]);
  nextModel.version = '2024-03-11';
  registry.models.push(nextModel);
  const manager = createModelManager({...data, registry, appVersion: '1.0.0'});
  await manager.install(data.model.id, {activate: true});
  fs.writeFileSync(path.join(data.userDataPath, 'models', data.model.id, '2024-03-11', 'encoder.int8.onnx'), 'corrupt');

  await assert.rejects(
    manager.getActive(data.model.id),
    error => error.code === 'asr-model-corrupt' && /Byte-size mismatch|SHA-256 mismatch/.test(error.message)
  );
  assert.equal((await manager.rollback(data.model.id)).version, '2024-03-10');
  assert.equal((await manager.getActive(data.model.id)).version, '2024-03-10');
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

test('an interrupted archive response resumes from the verified partial byte count', async (t) => {
  const {createModelManager} = require('../lib/model-manager');
  const data = fixture(t);
  const splitAt = 7;
  let requestCount = 0;
  const fetchImpl = async (url, options = {}) => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(data.archive.subarray(0, splitAt));
          setTimeout(() => controller.error(new Error('simulated connection reset')), 20);
        }
      }), {
        status: 200,
        headers: {'content-length': String(data.archive.length)}
      });
    }
    assert.equal(options.headers?.Range, `bytes=${splitAt}-`);
    return new Response(data.archive.subarray(splitAt), {
      status: 206,
      headers: {
        'content-length': String(data.archive.length - splitAt),
        'content-range': `bytes ${splitAt}-${data.archive.length - 1}/${data.archive.length}`
      }
    });
  };
  const extractArchive = async (options) => {
    assert.deepEqual(fs.readFileSync(options.archivePath), data.archive);
    await data.extractArchive(options);
  };
  const manager = createModelManager({...data, fetchImpl, extractArchive, appVersion: '1.0.0'});

  const installed = await manager.install(data.model.id);

  assert.equal(installed.reused, false);
  assert.equal(requestCount, 2);
});

test('a rejected resume response cancels its unconsumed body', async (t) => {
  const {createModelManager} = require('../lib/model-manager');
  const data = fixture(t);
  let requestCount = 0;
  let resumeBodyCancelled = false;
  const fetchImpl = async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(data.archive.subarray(0, 7));
          setTimeout(() => controller.error(new Error('simulated connection reset')), 20);
        }
      }), {
        status: 200,
        headers: {'content-length': String(data.archive.length)}
      });
    }
    return new Response(new ReadableStream({
      cancel() { resumeBodyCancelled = true; }
    }), {
      status: 200,
      headers: {'content-length': String(data.archive.length)}
    });
  };
  const manager = createModelManager({...data, fetchImpl, appVersion: '1.0.0'});

  await assert.rejects(manager.install(data.model.id), /resume failed: HTTP 200/);

  assert.equal(requestCount, 2);
  assert.equal(resumeBodyCancelled, true);
});

test('a wrong archive hash or extraction failure never replaces the active version', async (t) => {
  const {createModelManager} = require('../lib/model-manager');
  const data = fixture(t);
  const manager = createModelManager({...data, appVersion: '1.0.0'});
  await manager.install(data.model.id, {activate: true});
  const activePointer = fs.readFileSync(path.join(data.userDataPath, 'models', 'active', `${data.model.id}.json`), 'utf8');

  const wrongHashRegistry = structuredClone(data.registry);
  wrongHashRegistry.models[0].version = '2024-03-11';
  wrongHashRegistry.models[0].sources[0].sha256 = '0'.repeat(64);
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

test('a new manager removes stale staging left by a killed utility before installing', async (t) => {
  const {createModelManager} = require('../lib/model-manager');
  const data = fixture(t);
  const stale = path.join(data.userDataPath, 'models', '.staging', 'stale-operation');
  fs.mkdirSync(stale, {recursive: true});
  fs.writeFileSync(path.join(stale, 'partial.tar.bz2'), 'partial');
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60_000);
  fs.utimesSync(stale, twoDaysAgo, twoDaysAgo);

  const manager = createModelManager({...data, appVersion: '1.0.0'});
  await manager.install(data.model.id);

  assert.equal(fs.existsSync(stale), false);
  assert.deepEqual(fs.readdirSync(path.join(data.userDataPath, 'models', '.staging')), []);
});

test('fresh staging from another utility is preserved', async (t) => {
  const {createModelManager} = require('../lib/model-manager');
  const data = fixture(t);
  const fresh = path.join(data.userDataPath, 'models', '.staging', 'active-operation');
  fs.mkdirSync(fresh, {recursive: true});
  fs.writeFileSync(path.join(fresh, 'partial.tar.bz2'), 'partial');

  const manager = createModelManager({...data, appVersion: '1.0.0'});
  await manager.install(data.model.id);

  assert.equal(fs.existsSync(fresh), true);
});

test('a live cross-process installation lock rejects a second installer', async (t) => {
  const {createModelManager} = require('../lib/model-manager');
  const data = fixture(t);
  const lockPath = path.join(data.userDataPath, 'models', '.install-lock');
  fs.mkdirSync(lockPath, {recursive: true});
  fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({pid: process.pid}));
  let fetched = false;

  const manager = createModelManager({...data, appVersion: '1.0.0', fetchImpl: async () => { fetched = true; }});
  await assert.rejects(manager.install(data.model.id), /Another model installation is already running/);
  assert.equal(fetched, false);
  assert.equal(fs.existsSync(lockPath), true);
});
