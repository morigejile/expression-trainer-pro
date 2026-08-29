'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {runManagedModelSmoke} = require('../lib/managed-model-smoke');

test('managed model smoke initializes and exercises one silent session', async () => {
  const calls = [];
  const sessionId = '123e4567-e89b-42d3-a456-426614174003';
  const provider = {
    async initialize() { calls.push(['initialize']); },
    async start(command) {
      calls.push(['start', command]);
      return {type: 'ready', sessionId, sequence: 0};
    },
    async feed(command) {
      calls.push(['feed', command]);
      return [];
    },
    async stop(command) {
      calls.push(['stop', command]);
      return [{type: 'stopped', sessionId, sequence: 1}];
    },
    async dispose() { calls.push(['dispose']); }
  };

  const result = await runManagedModelSmoke(provider, {sessionId});

  assert.deepEqual(result, {sampleFrames: 320, stopped: true});
  assert.deepEqual(calls.map(([name]) => name), ['initialize', 'start', 'feed', 'stop', 'dispose']);
  assert.equal(calls[2][1].samples instanceof Float32Array, true);
  assert.equal(calls[2][1].samples.length, 320);
});

test('managed model smoke always disposes after a failed initialization', async () => {
  let disposed = false;
  const provider = {
    async initialize() { throw new Error('model failed'); },
    async dispose() { disposed = true; }
  };
  await assert.rejects(runManagedModelSmoke(provider), /model failed/);
  assert.equal(disposed, true);
});
