'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTrainingRecordStore, findSegmentAtTime, formatRecordLabel } = require('../src/training-records');

function record(number, audioUrl) {
  return { id: `r${number}`, audioUrl, createdAt: `2026-09-01T0${number}:05:00.000Z`, durationMs: 65 * 1000 };
}

test('sixth completed record evicts and revokes the oldest', () => {
  const revoked = [];
  const store = createTrainingRecordStore({ maxRecords: 5, revokeObjectURL: url => revoked.push(url) });
  for (let i = 1; i <= 6; i += 1) store.add(record(i, `blob:${i}`));
  assert.deepEqual(store.list().map(item => item.id), ['r2', 'r3', 'r4', 'r5', 'r6']);
  assert.deepEqual(revoked, ['blob:1']);
  assert.equal(store.selected().id, 'r6');
});

test('segment lookup uses half-open boundaries and retains the final segment at duration', () => {
  const segments = [{ id: 'a', startMs: 0, endMs: 1000 }, { id: 'b', startMs: 1000, endMs: 2000 }];
  assert.equal(findSegmentAtTime(segments, 999).id, 'a');
  assert.equal(findSegmentAtTime(segments, 1000).id, 'b');
  assert.equal(findSegmentAtTime(segments, 2000).id, 'b');
  assert.equal(findSegmentAtTime(segments, -1), null);
});

test('record store replaces immutably, selects records, clears, and formats labels', () => {
  const revoked = [];
  const store = createTrainingRecordStore({ revokeObjectURL: url => revoked.push(url) });
  store.add(record(1, 'blob:1'));
  assert.equal(store.replace('r1', current => ({ ...current, durationMs: 125000 })).durationMs, 125000);
  assert.equal(store.select('r1').id, 'r1');
  assert.equal(formatRecordLabel({ createdAt: '2026-09-01T13:04:05.000Z', durationMs: 125000 }), '21:04 · 02:05');
  store.clear();
  store.clear();
  assert.deepEqual(revoked, ['blob:1']);
  assert.equal(store.selected(), null);
});

test('duplicate audio URLs are revoked exactly once across eviction and clear', () => {
  const revoked = [];
  const store = createTrainingRecordStore({ maxRecords: 1, revokeObjectURL: url => revoked.push(url) });
  store.add(record(1, 'blob:shared'));
  store.add(record(2, 'blob:shared'));
  store.clear();
  assert.deepEqual(revoked, ['blob:shared']);
});

test('segment lookup returns null before the first segment and inside gaps', () => {
  const segments = [{ id: 'a', startMs: 100, endMs: 200 }, { id: 'b', startMs: 300, endMs: 400 }];
  assert.equal(findSegmentAtTime(segments, 99), null);
  assert.equal(findSegmentAtTime(segments, 250), null);
});

test('segment lookup uses logarithmic segment access on ordered timelines', () => {
  let accesses = 0;
  const segments = Array.from({ length: 4096 }, (_, index) => new Proxy({
    id: index,
    startMs: index * 10,
    endMs: index * 10 + 10
  }, { get(target, property, receiver) {
    accesses += 1;
    return Reflect.get(target, property, receiver);
  } }));
  assert.equal(findSegmentAtTime(segments, 30_000).id, 3000);
  assert.ok(accesses < 100, `expected logarithmic access count, got ${accesses}`);
});
