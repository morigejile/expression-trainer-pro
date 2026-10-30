'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const assets = path.join(__dirname, '../src/assets');

test('Windows icon contains small 32-bit frames and a 256px PNG with intact boundaries', () => {
  const ico = fs.readFileSync(path.join(assets, 'app-icon.ico'));
  assert.equal(ico.readUInt16LE(0), 0); assert.equal(ico.readUInt16LE(2), 1);
  const count = ico.readUInt16LE(4), dimensions = [];
  let nextOffset = 6 + count * 16;
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16, size = ico[entry] || 256;
    assert.equal(ico[entry + 1] || 256, size);
    assert.equal(ico.readUInt16LE(entry + 4), 1); assert.equal(ico.readUInt16LE(entry + 6), 32);
    const length = ico.readUInt32LE(entry + 8), offset = ico.readUInt32LE(entry + 12);
    assert.equal(offset, nextOffset); assert.ok(length > 0 && offset + length <= ico.length);
    const frame = ico.subarray(offset, offset + length);
    if (size === 256) {
      assert.equal(frame.subarray(1, 4).toString(), 'PNG');
      assert.equal(frame.readUInt32BE(16), size); assert.equal(frame.readUInt32BE(20), size);
      assert.deepEqual(frame, fs.readFileSync(path.join(assets, 'app-icon.png')));
    } else {
      assert.equal(frame.readUInt32LE(0), 40); assert.equal(frame.readInt32LE(4), size);
      assert.equal(frame.readInt32LE(8), size * 2); assert.equal(frame.readUInt16LE(14), 32);
      assert.equal(length, 40 + size * size * 4 + Math.ceil(size / 32) * 4 * size);
      const alpha = Array.from({length:size * size}, (_, p) => frame[40 + p * 4 + 3]);
      assert.ok(Math.min(...alpha) < 32 && alpha.includes(255), 'Transparent antialiased corners and opaque artwork remain');
    }
    nextOffset += length; dimensions.push(size);
  }
  assert.deepEqual(dimensions, [16, 24, 32, 48, 64, 128, 256]); assert.equal(nextOffset, ico.length);
});

test('app icon preserves the master glyph and is wired to executable and installer without identity changes', () => {
  const svg = fs.readFileSync(path.join(assets, 'app-icon.svg'), 'utf8');
  const master = fs.readFileSync(path.join(assets, 'brand-mark.svg'), 'utf8');
  assert.equal(svg.match(/<path[^>]* d="([^"]+)"/)[1], master.match(/<path[^>]* d="([^"]+)"/)[1]);
  assert.match(svg, /viewBox="0 0 28 28"/); assert.match(svg, /stroke-width="2.05"/);
  assert.match(svg, /stroke="#6B6150"/); assert.match(master, /stroke="#6B6150"/);
  assert.match(svg, /rx="6.4"/); assert.match(svg, /fill="url\(#app-icon-surface\)"/);
  const config = require('../forge.config').createForgeConfig({environment:{}});
  assert.equal(config.packagerConfig.icon, path.join(assets, 'app-icon.ico'));
  assert.equal(config.makers[0].config.setupIcon, config.packagerConfig.icon);
  assert.equal(config.packagerConfig.executableName, 'ExpressionTrainer');
  assert.equal(config.makers[0].config.name, 'ExpressionTrainer');
  assert.equal(config.packagerConfig.extraResource, undefined);
});
