'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAsrProcessController } = require('../lib/asr-process-controller');

class FakeUtilityProcess extends EventEmitter {
  constructor(handler) {
    super();
    this.handler = handler;
    this.messages = [];
    this.killed = false;
  }

  postMessage(message) {
    this.messages.push(message);
    this.handler?.(message, response => this.emit('message', { id: message.id, ok: true, result: response }));
  }

  kill() {
    this.killed = true;
    this.emit('exit', 0);
    return true;
  }
}

test('ASR process controller routes the provider contract through one utility process', async () => {
  const processes = [];
  const controller = createAsrProcessController({
    spawn() {
      const child = new FakeUtilityProcess((message, reply) => {
        reply(message.command === 'feed' ? { type: 'partial', text: 'draft' } : null);
      });
      processes.push(child);
      return child;
    }
  });

  await Promise.all([controller.initialize(), controller.initialize()]);
  await controller.start({ sessionId: 'session-a', sampleRateHz: 16000 });
  const partial = await controller.feed({
    sessionId: 'session-a',
    sequence: 0,
    samples: new Float32Array([0.1])
  });
  await controller.stop({ sessionId: 'session-a' });

  assert.equal(processes.length, 1);
  assert.deepEqual(processes[0].messages.map(message => message.command), [
    'initialize', 'start', 'feed', 'stop'
  ]);
  assert.deepEqual(partial, { type: 'partial', text: 'draft' });
});

test('ASR process controller rejects pending work on exit and respawns on next initialize', async () => {
  const processes = [];
  const controller = createAsrProcessController({
    spawn() {
      const index = processes.length;
      const child = new FakeUtilityProcess((message, reply) => {
        if (message.command !== 'feed') reply(null);
      });
      child.index = index;
      processes.push(child);
      return child;
    }
  });

  await controller.initialize();
  const pendingFeed = controller.feed({
    sessionId: 'session-a',
    sequence: 0,
    samples: new Float32Array([0.1])
  });
  processes[0].emit('exit', 73);

  await assert.rejects(pendingFeed, error => {
    assert.equal(error.code, 'asr-process-exited');
    assert.equal(error.exitCode, 73);
    return true;
  });

  await controller.initialize();
  assert.equal(processes.length, 2);
  assert.equal(controller.snapshot().restartCount, 1);
  assert.equal(controller.snapshot().lastExitCode, 73);
});

test('ASR process controller dispose is idempotent and prevents later commands', async () => {
  let child;
  const controller = createAsrProcessController({
    spawn() {
      child = new FakeUtilityProcess((message, reply) => reply(null));
      return child;
    }
  });

  await controller.initialize();
  await controller.dispose();
  await controller.dispose();

  assert.deepEqual(child.messages.map(message => message.command), ['initialize', 'dispose']);
  assert.equal(child.killed, true);
  await assert.rejects(
    controller.start({ sessionId: 'session-a', sampleRateHz: 16000 }),
    /disposed/
  );
});

test('ASR process controller bounds shutdown wait and kills an unresponsive utility process', async () => {
  let child;
  const controller = createAsrProcessController({
    shutdownTimeoutMs: 10,
    spawn() {
      child = new FakeUtilityProcess((message, reply) => {
        if (message.command === 'initialize') reply(null);
      });
      return child;
    }
  });

  await controller.initialize();
  await assert.rejects(controller.dispose(), error => error.code === 'asr-process-timeout');

  assert.equal(child.killed, true);
  assert.equal(controller.snapshot().disposed, true);
  assert.equal(controller.snapshot().running, false);
});
