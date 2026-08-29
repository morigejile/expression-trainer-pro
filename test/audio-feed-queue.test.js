'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAudioFeedQueue } = require('../src/audio-feed-queue');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

test('audio feed queue sends serially, preserves order, and drains accepted chunks', async () => {
  const sends = [];
  const gates = [deferred(), deferred(), deferred()];
  const queue = createAudioFeedQueue({
    maxChunks: 10,
    send(chunk) {
      sends.push(chunk.sequence);
      return gates[chunk.sequence].promise;
    }
  });

  assert.equal(queue.enqueue({ sequence: 0 }), true);
  assert.equal(queue.enqueue({ sequence: 1 }), true);
  assert.equal(queue.enqueue({ sequence: 2 }), true);
  assert.deepEqual(sends, [0]);
  assert.equal(queue.snapshot().peakDepth, 3);

  gates[0].resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sends, [0, 1]);
  gates[1].resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sends, [0, 1, 2]);
  gates[2].resolve();

  queue.close();
  await queue.drain();
  assert.deepEqual(queue.snapshot(), {
    accepting: false,
    maxChunks: 10,
    depth: 0,
    peakDepth: 3,
    accepted: 3,
    completed: 3,
    rejected: 0,
    discarded: 0,
    overruns: 0,
    failureCode: null
  });
});

test('audio feed queue fails closed when ten accepted chunks are still pending', async () => {
  const gate = deferred();
  const failures = [];
  const queue = createAudioFeedQueue({
    maxChunks: 10,
    send: () => gate.promise,
    onFailure: error => failures.push(error)
  });

  for (let sequence = 0; sequence < 10; sequence += 1) {
    assert.equal(queue.enqueue({ sequence }), true);
  }
  assert.equal(queue.enqueue({ sequence: 10 }), false);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, 'audio-overrun');
  assert.equal(queue.snapshot().peakDepth, 10);
  assert.equal(queue.snapshot().rejected, 1);
  assert.equal(queue.snapshot().discarded, 9);
  assert.equal(queue.snapshot().overruns, 1);
  await assert.rejects(queue.drain(), error => error.code === 'audio-overrun');
  gate.resolve();
});

test('audio feed queue reports one sender failure and discards queued work', async () => {
  const failures = [];
  const queue = createAudioFeedQueue({
    send: async chunk => {
      if (chunk.sequence === 0) throw new Error('IPC unavailable');
    },
    onFailure: error => failures.push(error)
  });

  queue.enqueue({ sequence: 0 });
  queue.enqueue({ sequence: 1 });
  await assert.rejects(queue.drain(), /IPC unavailable/);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(failures.length, 1);
  assert.equal(queue.snapshot().completed, 0);
  assert.equal(queue.snapshot().depth, 0);
  assert.equal(queue.enqueue({ sequence: 2 }), false);
});

test('audio feed queue close rejects new input but lets accepted work finish', async () => {
  const gate = deferred();
  const queue = createAudioFeedQueue({ send: () => gate.promise });

  assert.equal(queue.enqueue({ sequence: 0 }), true);
  queue.close();
  assert.equal(queue.enqueue({ sequence: 1 }), false);
  gate.resolve();
  await queue.drain();

  assert.equal(queue.snapshot().completed, 1);
  assert.equal(queue.snapshot().rejected, 1);
});
