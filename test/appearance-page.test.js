const test = require('node:test');
const assert = require('node:assert/strict');

const {applyAppearance, initializeAppearance} = require('../src/appearance');

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

test('appearance initializes from visible HTML defaults before async load resolves', async () => {
  const deferred = createDeferred();
  const root = {dataset: {theme: 'graphite', layout: 'coach-rail'}};
  const initializing = initializeAppearance({
    root,
    api: {
      getAppearance: () => deferred.promise,
      onAppearanceChanged: () => () => {}
    }
  });

  assert.deepEqual(root.dataset, {theme: 'graphite', layout: 'coach-rail'});
  deferred.resolve({schemaVersion: 1, theme: 'paper', layout: 'focus-hud'});
  await initializing;
  assert.deepEqual(root.dataset, {theme: 'paper', layout: 'focus-hud'});
});

test('appearance read failure preserves visible defaults and still accepts broadcasts', async () => {
  let listener;
  const root = {dataset: {theme: 'graphite', layout: 'coach-rail'}};

  const state = await initializeAppearance({
    root,
    api: {
      getAppearance: async () => { throw new Error('read failed'); },
      onAppearanceChanged: callback => {
        listener = callback;
        return () => {};
      }
    }
  });

  assert.deepEqual(root.dataset, {theme: 'graphite', layout: 'coach-rail'});
  assert.equal(typeof state.unsubscribe, 'function');
  listener({theme: 'mist', layout: 'coach-rail'});
  assert.equal(root.dataset.theme, 'mist');
});

test('appearance normalizes untrusted renderer payloads', () => {
  const root = {dataset: {}};

  assert.deepEqual(applyAppearance(root, {theme: 'neon', layout: 'freeform'}), {
    schemaVersion: 1,
    theme: 'graphite',
    layout: 'coach-rail'
  });
  assert.deepEqual(root.dataset, {theme: 'graphite', layout: 'coach-rail'});
});

test('applying appearance changes attributes without replacing root children', () => {
  const children = [{id: 'transcript'}, {id: 'feedback'}];
  const root = {dataset: {}, children};

  applyAppearance(root, {theme: 'midnight', layout: 'focus-hud'});

  assert.equal(root.children, children);
  assert.deepEqual(root.dataset, {theme: 'midnight', layout: 'focus-hud'});
});

test('a newer broadcast is not overwritten by an older initial read', async () => {
  const deferred = createDeferred();
  let listener;
  const root = {dataset: {theme: 'graphite', layout: 'coach-rail'}};
  const initializing = initializeAppearance({
    root,
    api: {
      getAppearance: () => deferred.promise,
      onAppearanceChanged: callback => {
        listener = callback;
        return () => {};
      }
    }
  });

  listener({theme: 'mist', layout: 'focus-hud'});
  deferred.resolve({theme: 'paper', layout: 'coach-rail'});
  await initializing;

  assert.deepEqual(root.dataset, {theme: 'mist', layout: 'focus-hud'});
});
