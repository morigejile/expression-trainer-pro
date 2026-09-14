'use strict';

// Prints a coarse RMS envelope of a 16 kHz WAV so silence gaps (and therefore
// token-timestamp anchors) can be located by eye.

const fs = require('node:fs');
const sherpa = require('sherpa-onnx-node');

const wav = process.argv[2];
if (!wav) throw new Error('usage: node wav-envelope.js <file.wav> [windowMs]');
const windowMs = Number(process.argv[3] || 100);
const wave = sherpa.readWave(wav);
const samples = wave.samples instanceof Float32Array ? wave.samples : Float32Array.from(wave.samples);
const rate = wave.sampleRate;
const windowFrames = Math.round((windowMs / 1000) * rate);

console.log(`${wav} | ${rate} Hz | ${(samples.length / rate).toFixed(3)}s | ${samples.length} frames`);
const bars = [];
for (let start = 0; start < samples.length; start += windowFrames) {
  const end = Math.min(start + windowFrames, samples.length);
  let sum = 0;
  for (let i = start; i < end; i += 1) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / (end - start));
  const t = (start / rate).toFixed(2).padStart(6);
  const level = '#'.repeat(Math.min(60, Math.round(rms * 400)));
  bars.push(`${t}s rms=${rms.toFixed(4)} ${level}${rms < 0.002 ? '  <-- silence' : ''}`);
}
console.log(bars.join('\n'));
