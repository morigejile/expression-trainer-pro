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

