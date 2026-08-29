const test = require('node:test');
const assert = require('node:assert/strict');

test('variable render quanta cross exact 320-frame boundaries', async () => {
  const { MonoChunkCollector } = await import('../src/audio-chunk-collector.mjs');
  const chunks = [];
  const collector = new MonoChunkCollector({ onChunk: chunk => chunks.push(chunk) });
  collector.push([new Float32Array(128).fill(0.25)]);
  collector.push([new Float32Array(96).fill(0.5)]);
  collector.push([new Float32Array(160).fill(0.75)]);
  assert.deepEqual(chunks.map(chunk => chunk.length), [320]);
  assert.equal(collector.flush(), true);
  assert.deepEqual(chunks.map(chunk => chunk.length), [320, 64]);
  assert.equal(collector.flush(), false);
});

test('available channels are averaged to mono before chunking', async () => {
  const { MonoChunkCollector } = await import('../src/audio-chunk-collector.mjs');
  const chunks = [];
  const collector = new MonoChunkCollector({ onChunk: chunk => chunks.push(chunk) });
  collector.push([
    new Float32Array([1, -1, 0.5]),
    new Float32Array([-1, 1, -0.5])
  ]);
  assert.equal(collector.flush(), true);
  assert.deepEqual(chunks, [new Float32Array([0, 0, 0])]);
});

test('an exact 320 frames has no empty flush tail', async () => {
  const { MonoChunkCollector } = await import('../src/audio-chunk-collector.mjs');
  const chunks = [];
  const collector = new MonoChunkCollector({ onChunk: chunk => chunks.push(chunk) });
  collector.push([new Float32Array(320).fill(0.5)]);
  assert.deepEqual(chunks.map(chunk => chunk.length), [320]);
  assert.equal(collector.flush(), false);
  assert.equal(collector.flush(), false);
});

test('reset discards a partial quantum without emitting it', async () => {
  const { MonoChunkCollector } = await import('../src/audio-chunk-collector.mjs');
  const chunks = [];
  const collector = new MonoChunkCollector({ onChunk: chunk => chunks.push(chunk) });
  collector.push([new Float32Array(128).fill(0.25)]);
  collector.reset();
  collector.push([new Float32Array(320).fill(0.75)]);
  assert.equal(collector.flush(), false);
  assert.deepEqual(chunks.map(chunk => [...chunk]), [
    [...new Float32Array(320).fill(0.75)]
  ]);
});

test('empty input and unavailable input buses emit nothing', async () => {
  const { MonoChunkCollector } = await import('../src/audio-chunk-collector.mjs');
  const chunks = [];
  const collector = new MonoChunkCollector({ onChunk: chunk => chunks.push(chunk) });
  collector.push([]);
  collector.push(undefined);
  collector.push([new Float32Array(0)]);
  assert.equal(collector.flush(), false);
  assert.deepEqual(chunks, []);
});

test('collector validates its fixed boundary and callback', async () => {
  const { MonoChunkCollector } = await import('../src/audio-chunk-collector.mjs');
  assert.throws(() => new MonoChunkCollector({ chunkFrames: 0, onChunk() {} }), /chunkFrames/);
  assert.throws(() => new MonoChunkCollector({ chunkFrames: 320 }), /onChunk/);
});
