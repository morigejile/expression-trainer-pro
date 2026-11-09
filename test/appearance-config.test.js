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
  for (const theme of ['graphite', 'ink-night', 'coral-glow', 'frosted-mist']) {
    assert.deepEqual(normalizeAppearance({schemaVersion: 1, theme, layout: 'coach-rail'}), {
      schemaVersion: 1,
      theme,
      layout: 'coach-rail'
    });
  }
});

test('appearance maps retired layouts to the accepted layout', () => {
  assert.equal(normalizeAppearance({theme: 'ink-night', layout: 'focus-hud'}).layout, 'coach-rail');
  assert.equal(normalizeAppearance({theme: 'ink-night', layout: 'coach-rail'}).layout, 'coach-rail');
});

test('appearance rejects unknown values independently', () => {
  assert.deepEqual(normalizeAppearance({theme: 'neon', layout: 'coach-rail'}), {
    schemaVersion: 1,
    theme: 'graphite',
    layout: 'coach-rail'
  });
  assert.deepEqual(normalizeAppearance({theme: 'coral-glow', layout: 'freeform'}), {
    schemaVersion: 1,
    theme: 'coral-glow',
    layout: 'coach-rail'
  });
});

test('appearance rejects non-object input', () => {
  for (const value of [null, undefined, [], 'coral-glow', 1]) {
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
    theme: 'coral-glow',
    layout: 'coach-rail',
    futureField: true
  })), {
    appearance: {schemaVersion: 1, theme: 'coral-glow', layout: 'coach-rail'},
    isFutureSchema: true,
    error: null
  });
});
