const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CUSTOM_PROMPT_FILENAME,
  getCustomPromptPath,
  createCustomPromptStore
} = require('../lib/custom-prompt-store');

const silentLogger = {warn() {}};

function withUserData(t) {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-prompt-store-'));
  t.after(() => fs.rmSync(userDataPath, {recursive: true, force: true}));
  return userDataPath;
}

function countingFs(reads = []) {
  return new Proxy(fs, {
    get(target, property) {
      if (property !== 'readFileSync') return Reflect.get(target, property);
      return (...args) => {
        reads.push(args[0]);
        return target.readFileSync(...args);
      };
    }
  });
}

test('custom prompt path must sit under an absolute user data directory', () => {
  assert.throws(() => getCustomPromptPath('relative/path'), TypeError);
  assert.equal(
    path.basename(getCustomPromptPath(path.resolve('/tmp/user-data'))),
    CUSTOM_PROMPT_FILENAME
  );
});

test('a missing custom prompt file yields defaults without caching', t => {
  const userDataPath = withUserData(t);
  const store = createCustomPromptStore({logger: silentLogger});

  assert.deepEqual(store.load(userDataPath), {
    schemaVersion: 2, goals: '', styleRef: ''
  });

  store.save(userDataPath, {schemaVersion:2, goals: '更直接', styleRef: ''});

  assert.equal(store.load(userDataPath).goals, '更直接');
});

test('repeated loads reuse the parsed prompt instead of re-reading the file', t => {
  const userDataPath = withUserData(t);
  const reads = [];
  const store = createCustomPromptStore({fsImpl: countingFs(reads), logger: silentLogger});
  store.save(userDataPath, {schemaVersion:2, goals: '更直接', styleRef: ''});

  const first = store.load(userDataPath);
  const readsAfterFirstLoad = reads.length;
  for (let index = 0; index < 20; index += 1) store.load(userDataPath);

  assert.equal(reads.length, readsAfterFirstLoad);
  assert.deepEqual(store.load(userDataPath), first);
});

test('each load returns an isolated copy callers cannot corrupt', t => {
  const userDataPath = withUserData(t);
  const store = createCustomPromptStore({logger: silentLogger});
  store.save(userDataPath, {schemaVersion:2, goals: '更直接', styleRef: ''});

  const first = store.load(userDataPath);
  first.goals = '被改坏了';

  assert.equal(store.load(userDataPath).goals, '更直接');
});

test('saving invalidates the cache so the next load sees the new rules', t => {
  const userDataPath = withUserData(t);
  const store = createCustomPromptStore({logger: silentLogger});
  store.save(userDataPath, {schemaVersion:2, goals: '第一版', styleRef: ''});
  assert.equal(store.load(userDataPath).goals, '第一版');

  store.save(userDataPath, {schemaVersion:2, goals: '第二版', styleRef: ''});

  assert.equal(store.load(userDataPath).goals, '第二版');
});

test('an external rewrite of the file is picked up by size or mtime', t => {
  const userDataPath = withUserData(t);
  const store = createCustomPromptStore({logger: silentLogger});
  const filePath = getCustomPromptPath(userDataPath);
  store.save(userDataPath, {schemaVersion:2, goals: '第一版', styleRef: ''});
  assert.equal(store.load(userDataPath).goals, '第一版');

  fs.writeFileSync(filePath, JSON.stringify({
    schemaVersion: 1, goals: '外部改写的目标', customRules: '', styleRef: '', customWords: ''
  }, null, 2) + '\n', 'utf8');

  assert.equal(store.load(userDataPath).goals, '外部改写的目标');
});

test('a corrupt file warns once and then serves defaults from cache', t => {
  const userDataPath = withUserData(t);
  const warnings = [];
  const reads = [];
  const store = createCustomPromptStore({
    fsImpl: countingFs(reads),
    logger: {warn: message => warnings.push(message)}
  });
  fs.writeFileSync(getCustomPromptPath(userDataPath), '{ not json', 'utf8');

  for (let index = 0; index < 5; index += 1) {
    assert.equal(store.load(userDataPath).goals, '');
  }

  assert.equal(warnings.length, 1);
  assert.equal(reads.length, 1);
});

test('a legacy file is normalized on disk once and then served from cache', t => {
  const userDataPath = withUserData(t);
  const reads = [];
  const store = createCustomPromptStore({fsImpl: countingFs(reads), logger: silentLogger});
  const filePath = getCustomPromptPath(userDataPath);
  fs.writeFileSync(filePath, JSON.stringify({goals: '旧结构', customRules:'旧指令',customWords:'行动',legacyField: 1}), 'utf8');

  assert.equal(store.load(userDataPath).goals, '旧结构\n\n旧指令');
  const migrated = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.deepEqual(migrated,{schemaVersion:2,goals:'旧结构\n\n旧指令',styleRef:''});
  assert.equal(migrated.legacyField, undefined);

  const readsAfterMigration = reads.length;
  store.load(userDataPath);
  store.load(userDataPath);

  assert.equal(store.load(userDataPath).goals, '旧结构\n\n旧指令');
  // 迁移后重新登记一次，之后不再读盘
  assert.equal(reads.length, readsAfterMigration + 1);
});

test('a future schema is read but never written back', t => {
  const userDataPath = withUserData(t);
  const store = createCustomPromptStore({logger: silentLogger});
  const filePath = getCustomPromptPath(userDataPath);
  const raw = JSON.stringify({
    schemaVersion: 99, goals: '未来目标', customRules: '', styleRef: '', customWords: ''
  });
  fs.writeFileSync(filePath, raw, 'utf8');

  assert.equal(store.load(userDataPath).goals, '未来目标');
  assert.throws(()=>store.save(userDataPath,{schemaVersion:2,goals:'覆盖',styleRef:''}),
    error=>error.code==='unsupported-schema-version');
  assert.equal(fs.readFileSync(filePath, 'utf8'), raw);
});

test('two stores over the same directory do not share cache state', t => {
  const userDataPath = withUserData(t);
  const writer = createCustomPromptStore({logger: silentLogger});
  const reader = createCustomPromptStore({logger: silentLogger});
  writer.save(userDataPath, {schemaVersion:2, goals: '第一版', styleRef: ''});

  assert.equal(reader.load(userDataPath).goals, '第一版');

  writer.save(userDataPath, {schemaVersion:2, goals: '第二版', styleRef: ''});

  assert.equal(reader.load(userDataPath).goals, '第二版');
});
