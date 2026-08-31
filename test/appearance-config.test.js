const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDefaultAppearance,
  normalizeAppearance,
  parseAppearanceJson
} = require('../lib/appearance-config');

test('appearance defaults to graphite coach-rail schema 1', () => {
  assert.deepEqual(createDefaultAppearance(), {
    schemaVersion: 1,
    theme: 'graphite',
    layout: 'coach-rail'
  });
});

test('appearance accepts every supported theme without changing layout', () => {
  for (const theme of ['graphite', 'midnight', 'paper', 'mist']) {
    assert.deepEqual(normalizeAppearance({schemaVersion: 1, theme, layout: 'focus-hud'}), {
      schemaVersion: 1,
      theme,
      layout: 'focus-hud'
    });
  }
});

test('appearance accepts both supported layouts', () => {
  assert.equal(normalizeAppearance({theme: 'midnight', layout: 'coach-rail'}).layout, 'coach-rail');
  assert.equal(normalizeAppearance({theme: 'midnight', layout: 'focus-hud'}).layout, 'focus-hud');
});

test('appearance rejects unknown values independently', () => {
  assert.deepEqual(normalizeAppearance({theme: 'neon', layout: 'focus-hud'}), {
    schemaVersion: 1,
    theme: 'graphite',
    layout: 'focus-hud'
  });
  assert.deepEqual(normalizeAppearance({theme: 'paper', layout: 'freeform'}), {
    schemaVersion: 1,
    theme: 'paper',
    layout: 'coach-rail'
  });
});

test('appearance rejects non-object input', () => {
  for (const value of [null, undefined, [], 'paper', 1]) {
    assert.deepEqual(normalizeAppearance(value), {
      schemaVersion: 1,
      theme: 'graphite',
      layout: 'coach-rail'
    });
  }
});

test('invalid appearance JSON returns defaults without requesting a downgrade', () => {
  assert.deepEqual(parseAppearanceJson('{"theme":'), {
    appearance: {schemaVersion: 1, theme: 'graphite', layout: 'coach-rail'},
    isFutureSchema: false,
    error: 'invalid-json'
  });
});

test('future appearance schema remains readable and is marked read-only', () => {
  assert.deepEqual(parseAppearanceJson(JSON.stringify({
    schemaVersion: 99,
    theme: 'paper',
    layout: 'focus-hud',
    futureField: true
  })), {
    appearance: {schemaVersion: 1, theme: 'paper', layout: 'focus-hud'},
    isFutureSchema: true,
    error: null
  });
});
