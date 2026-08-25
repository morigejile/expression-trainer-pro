const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parsePcmWav } = require('../lib/dataset-manifest');

const REQUIRED_UNOBSERVED_STRATA = [
  'code-switch',
  'fast',
  'light-accent',
  'light-noise',
  'numbers-names',
  'slow'
];
const OFFICIAL_ARCHIVE_URL = 'https://storage.googleapis.com/xtreme_translations/FLEURS102/cmn_hans_cn.tar.gz';

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`);
  return value;
}

function requiredPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function relativeDirectory(value) {
  const directory = requiredString(value, 'audioDirectory').replace(/\\/g, '/');
  if (path.posix.isAbsolute(directory) || path.win32.isAbsolute(directory) || directory.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error('audioDirectory must be a portable relative directory');
  }
  return directory;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function parseFleursDevTsv(tsvText) {
  requiredString(tsvText, 'tsvText');
  const ids = new Set();
  const files = new Set();
  return tsvText.split(/\r?\n/).filter((line) => line.trim() !== '').map((line, index) => {
    const fields = line.split('\t');
    if (fields.length < 4) throw new Error(`TSV row ${index + 1} must contain FLEURS id, file name, and transcript fields`);
    const id = requiredString(fields[0], `TSV row ${index + 1} id`);
    const fileName = requiredString(fields[1], `TSV row ${index + 1} file name`);
    const transcript = requiredString(fields[3], `TSV row ${index + 1} transcription`);
    if (!/^[A-Za-z0-9._-]+$/.test(id) || ids.has(id)) throw new Error(`TSV row ${index + 1} has an unsafe or duplicate id`);
    if (path.basename(fileName) !== fileName || fileName.includes('/') || fileName.includes('\\') || files.has(fileName)) {
      throw new Error(`TSV row ${index + 1} has an unsafe or duplicate audio file name`);
    }
    ids.add(id);
    files.add(fileName);
    return { id, fileName, transcript };
  });
}

function sourceRecord(source) {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) throw new Error('source must be an object');
  const publisher = requiredString(source.publisher, 'source.publisher');
  const dataset = requiredString(source.dataset, 'source.dataset');
  const locale = requiredString(source.locale, 'source.locale');
  const license = requiredString(source.license, 'source.license');
  const archiveGeneration = requiredString(source.archiveGeneration, 'source.archiveGeneration');
  const archiveSha256 = requiredString(source.archiveSha256, 'source.archiveSha256');
  const archiveBytes = requiredPositiveInteger(source.archiveBytes, 'source.archiveBytes');
  if (!/^[a-f0-9]{64}$/.test(archiveSha256)) throw new Error('source.archiveSha256 must be a lowercase SHA-256 digest');
  return {
    publisher,
    dataset,
    locale,
    license,
    attribution: 'FLEURS: Few-shot Learning Evaluation of Universal Representations of Speech (Conneau et al., 2022).',
    archiveUrl: OFFICIAL_ARCHIVE_URL,
    sourceRevision: `gcs-generation-${archiveGeneration}`,
    archiveSha256,
    archiveBytes
  };
}

function createFleursIntakeInventory({ tsvText, datasetRoot, audioDirectory, maxSamples, source }) {
  const canonicalRoot = fs.realpathSync.native(requiredString(datasetRoot, 'datasetRoot'));
  const portableDirectory = relativeDirectory(audioDirectory);
  const sourceMetadata = sourceRecord(source);
  const limit = requiredPositiveInteger(maxSamples, 'maxSamples');
  if (limit > 100) throw new Error('maxSamples must not exceed BM-01 maximum 100');
  const records = parseFleursDevTsv(tsvText).slice(0, limit);
  if (records.length < 50) throw new Error('TSV must provide at least 50 candidates');

  const samples = records.map((record) => {
    const relativeAudioFile = `${portableDirectory}/${record.fileName}`;
    const lexicalPath = path.resolve(canonicalRoot, ...relativeAudioFile.split('/'));
    if (!isInside(canonicalRoot, lexicalPath) || !fs.statSync(lexicalPath).isFile()) throw new Error(`audio file is unavailable: ${relativeAudioFile}`);
    const canonicalAudioPath = fs.realpathSync.native(lexicalPath);
    if (!isInside(canonicalRoot, canonicalAudioPath)) throw new Error(`audio file escapes dataset root: ${relativeAudioFile}`);
    const bytes = fs.readFileSync(canonicalAudioPath);
    const audio = parsePcmWav(bytes);
    return {
      id: `fleurs-cmn-hans-cn-dev-${record.id}`,
      audioFile: relativeAudioFile,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      sampleRateHz: audio.sampleRateHz,
      channels: audio.channels,
      durationMs: audio.durationMs,
      locale: 'zh-CN',
      observedStrata: ['mandarin'],
      transcript: record.transcript,
      transcriptStatus: 'upstream-draft',
      reviewStatus: 'pending'
    };
  });

  return {
    schemaVersion: 1,
    intakeId: 'fleurs-cmn-hans-cn-dev-candidates-v1',
    status: 'candidate-intake-not-governed-manifest',
    source: sourceMetadata,
    selection: {
      method: `first-${samples.length}-rows-in-dev-tsv-order`,
      observedStrata: ['mandarin'],
      unobservedRequiredStrata: REQUIRED_UNOBSERVED_STRATA
    },
    samples
  };
}

function main() {
  const tsvPath = requiredString(process.env.FLEURS_TSV_PATH, 'FLEURS_TSV_PATH');
  const datasetRoot = requiredString(process.env.DATASET_ROOT, 'DATASET_ROOT');
  const audioDirectory = requiredString(process.env.AUDIO_DIRECTORY, 'AUDIO_DIRECTORY');
  const inventoryPath = requiredString(process.env.INVENTORY_PATH, 'INVENTORY_PATH');
  const inventory = createFleursIntakeInventory({
    tsvText: fs.readFileSync(tsvPath, 'utf8'),
    datasetRoot,
    audioDirectory,
    maxSamples: Number(process.env.MAX_SAMPLES || '100'),
    source: {
      publisher: 'Google FLEURS',
      dataset: 'google/fleurs',
      locale: 'cmn_hans_cn',
      license: 'CC-BY-4.0',
      archiveGeneration: requiredString(process.env.ARCHIVE_GENERATION, 'ARCHIVE_GENERATION'),
      archiveSha256: requiredString(process.env.ARCHIVE_SHA256, 'ARCHIVE_SHA256'),
      archiveBytes: Number(requiredString(process.env.ARCHIVE_BYTES, 'ARCHIVE_BYTES'))
    }
  });
  fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Unable to generate FLEURS intake inventory: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { createFleursIntakeInventory, parseFleursDevTsv, main };
