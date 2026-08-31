const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {loadAppearance, saveAppearance} = require('../lib/appearance-store');

function withUserData(run) {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-appearance-'));
  return Promise.resolve(run(userDataPath)).finally(() => {
    fs.rmSync(userDataPath, {recursive: true, force: true});
  });
}

test('missing appearance file returns defaults without creating a file', async () => {
  await withUserData((userDataPath) => {
    const appearance = loadAppearance(userDataPath);

    assert.deepEqual(appearance, {schemaVersion: 1, theme: 'graphite', layout: 'coach-rail'});
    assert.equal(fs.existsSync(path.join(userDataPath, 'appearance.json')), false);
  });
});

test('invalid appearance JSON returns defaults and preserves the original file', async () => {
  await withUserData((userDataPath) => {
    const appearancePath = path.join(userDataPath, 'appearance.json');
    fs.writeFileSync(appearancePath, '{"theme":', 'utf8');
    const warnings = [];

    assert.deepEqual(loadAppearance(userDataPath, {
      logger: {warn: message => warnings.push(message)}
    }), {schemaVersion: 1, theme: 'graphite', layout: 'coach-rail'});
    assert.equal(fs.readFileSync(appearancePath, 'utf8'), '{"theme":');
    assert.equal(warnings.length, 1);
  });
});

test('unreadable appearance file returns defaults and warns once', async () => {
  await withUserData((userDataPath) => {
    const warnings = [];
    const fsImpl = {
      existsSync: () => true,
      readFileSync: () => { throw new Error('injected read failure'); }
    };

    assert.deepEqual(loadAppearance(userDataPath, {
      fsImpl,
      logger: {warn: message => warnings.push(message)}
    }), {schemaVersion: 1, theme: 'graphite', layout: 'coach-rail'});
    assert.equal(warnings.length, 1);
  });
});

test('explicit save publishes normalized appearance atomically', async () => {
  await withUserData((userDataPath) => {
    const appearancePath = path.join(userDataPath, 'appearance.json');

    const saved = saveAppearance(userDataPath, {theme: 'paper', layout: 'focus-hud'});

    assert.deepEqual(saved, {schemaVersion: 1, theme: 'paper', layout: 'focus-hud'});
    assert.deepEqual(JSON.parse(fs.readFileSync(appearancePath, 'utf8')), saved);
    assert.deepEqual(fs.readdirSync(userDataPath), ['appearance.json']);
  });
});

test('explicit save refuses to overwrite a future schema', async () => {
  await withUserData((userDataPath) => {
    const appearancePath = path.join(userDataPath, 'appearance.json');
    const futureText = '{"schemaVersion":99,"theme":"mist","layout":"coach-rail","keep":true}\n';
    fs.writeFileSync(appearancePath, futureText, 'utf8');

    assert.throws(
      () => saveAppearance(userDataPath, {theme: 'graphite', layout: 'coach-rail'}),
      error => error.code === 'unsupported-schema-version'
    );
    assert.equal(fs.readFileSync(appearancePath, 'utf8'), futureText);
  });
});

test('atomic save failure preserves the previous file byte for byte', async () => {
  await withUserData((userDataPath) => {
    const appearancePath = path.join(userDataPath, 'appearance.json');
    const originalText = '{"schemaVersion":1,"theme":"graphite","layout":"coach-rail"}\n';
    fs.writeFileSync(appearancePath, originalText, 'utf8');

    assert.throws(
      () => saveAppearance(
        userDataPath,
        {theme: 'paper', layout: 'focus-hud'},
        {atomicWrite: () => { throw new Error('injected atomic failure'); }}
      ),
      /injected atomic failure/
    );
    assert.equal(fs.readFileSync(appearancePath, 'utf8'), originalText);
  });
});
