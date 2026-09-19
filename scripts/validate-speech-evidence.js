'use strict';

// Finite engineering probe; this corpus has transcript labels, not VAD boundaries.
// node --expose-gc scripts/validate-speech-evidence.js --model <onnx> --dataset-root <frozen corpus> [--output <json>]
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {performance} = require('node:perf_hooks');
const {analyzeSpeechEvidence} = require('../lib/speech-evidence-engine');

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => args[args.indexOf(name) + 1];
  if (!args.includes('--model') || !args.includes('--dataset-root')) {
    throw new Error('Required: --model <onnx> --dataset-root <frozen corpus>');
  }
  const modelPath = path.resolve(option('--model'));
  const datasetRoot = path.resolve(option('--dataset-root'));
  const manifest = JSON.parse(fs.readFileSync(path.join(datasetRoot, 'manifest.json'), 'utf8'));
  const sorted = [...manifest.samples].sort((a, b) => a.durationMs - b.durationMs || a.id.localeCompare(b.id));
  if (sorted.length < 12) throw new Error('Need at least twelve existing recordings');
  const selected = Array.from({length: 12}, (_, i) => sorted[Math.round(i * (sorted.length - 1) / 11)]);
  const sherpa = require('sherpa-onnx-node');
  const results = [];
  let provenance;
  async function probe(id, samples, kind, expectedSilence) {
    global.gc?.();
    const cpuBefore = process.cpuUsage();
    const start = performance.now();
    const result = await analyzeSpeechEvidence({samples, sampleRateHz: 16000, modelPath});
    const elapsedMs = performance.now() - start;
    const cpu = process.cpuUsage(cpuBefore);
    assert.equal(result.status, 'completed', `${id}: ${result.quality.vad.reasons}`);
    let previousEnd = 0;
    for (const segment of result.segments) {
      assert.ok(segment.startSample >= previousEnd && segment.endSample > segment.startSample);
      assert.ok(segment.endSample <= samples.length);
      previousEnd = segment.endSample;
    }
    if (kind === 'digital-silence-control') assert.deepEqual(result.segments, []);
    const silenceOverlapSamples = expectedSilence ? result.segments.reduce((total, segment) => total
      + Math.max(0, Math.min(segment.endSample, expectedSilence.endSample)
        - Math.max(segment.startSample, expectedSilence.startSample)), 0) : null;
    const speechSamples = result.segments.reduce((sum, segment) => sum + segment.endSample - segment.startSample, 0);
    results.push({id, kind, durationMs: samples.length / 16, elapsedMs: Math.round(elapsedMs * 100) / 100,
      realTimeFactor: elapsedMs / (samples.length / 16), cpuMs: (cpu.user + cpu.system) / 1000,
      rssBytes: process.memoryUsage().rss, speechSegments: result.segments.length, speechSamples,
      expectedSilence, silenceOverlapSamples, segments: result.segments});
    provenance = result.provenance;
  }
  for (const item of selected) {
    const filename = path.resolve(datasetRoot, item.audioFile);
    assert.ok(filename.startsWith(datasetRoot + path.sep), 'Corpus path must stay inside dataset root');
    const wave = sherpa.readWave(filename);
    assert.equal(wave.sampleRate, 16000);
    await probe(item.id, wave.samples, 'existing-real-mandarin-read-speech');
  }
  const reference = sherpa.readWave(path.join(datasetRoot, selected[3].audioFile)).samples;
  await probe('digital-silence-2s', new Float32Array(32000), 'digital-silence-control');
  for (const silenceSamples of [2400, 24000]) {
    const audio = new Float32Array(reference.length * 2 + silenceSamples);
    audio.set(reference); audio.set(reference, reference.length + silenceSamples);
    await probe(`repeated-real-speech-gap-${silenceSamples / 16}ms`, audio, 'constructed-gap-control',
      {startSample: reference.length, endSample: reference.length + silenceSamples});
  }
  const noisy = new Float32Array(reference.length);
  let seed = 1729;
  for (let i = 0; i < reference.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    noisy[i] = Math.max(-1, Math.min(1, reference[i] + (seed / 0xffffffff * 2 - 1) * 0.005));
  }
  await probe('real-speech-low-amplitude-synthetic-noise', noisy, 'constructed-noise-control');
  const report = {schemaVersion: 1, nodeVersion: process.version, platform: process.platform, arch: process.arch,
    corpus: {datasetId: manifest.datasetId, datasetVersion: manifest.datasetVersion, existingRecordings: 12},
    provenance, limits: ['No manually labelled VAD ground truth: no precision, recall or boundary-accuracy claim.',
      'Read speech and constructed controls do not establish natural expression or real background-noise coverage.',
      'One Windows host; CPU time and process RSS include native loading. Packaging/device acceptance remains separate.'],
    peakProcessRssBytes: process.resourceUsage().maxRSS * 1024,
    summary: {cases: results.length, audioMs: results.reduce((sum, row) => sum + row.durationMs, 0),
      elapsedMs: results.reduce((sum, row) => sum + row.elapsedMs, 0),
      cpuMs: results.reduce((sum, row) => sum + row.cpuMs, 0)}, results};
  if (args.includes('--output')) fs.writeFileSync(path.resolve(option('--output')), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({...report, results: report.results.map(({segments, ...row}) => row)}, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
