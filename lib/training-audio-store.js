'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {MAX_DURATION_MS, sessionError, requireId} = require('./training-session-data');

const STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_AUDIO_BYTES = 44 + MAX_DURATION_MS * 32;

function validateAudio(audio) {
  if (!(audio instanceof Uint8Array)) throw sessionError('INVALID_SESSION', 'Expected PCM WAV audio');
  const bytes = Buffer.from(audio);
  if (bytes.length < 44 || bytes.length > MAX_AUDIO_BYTES || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 16) !== 'WAVEfmt ' || bytes.readUInt32LE(4) !== bytes.length - 8 ||
      bytes.readUInt32LE(16) !== 16 || bytes.readUInt16LE(20) !== 1 || bytes.readUInt16LE(22) !== 1 ||
      bytes.readUInt32LE(24) !== 16000 || bytes.readUInt32LE(28) !== 32000 ||
      bytes.readUInt16LE(32) !== 2 || bytes.readUInt16LE(34) !== 16 ||
      bytes.toString('ascii', 36, 40) !== 'data' || bytes.readUInt32LE(40) !== bytes.length - 44 ||
      (bytes.length - 44) % 2 !== 0) {
    throw sessionError('INVALID_SESSION', 'Expected bounded mono 16 kHz PCM WAV audio');
  }
  return bytes;
}

async function createTrainingAudioStore(root) {
  root = await fs.realpath(root);
  const audioRoot = path.join(root, 'audio');
  const stagingRoot = path.join(root, 'staging');
  for (const dir of [audioRoot, stagingRoot]) {
    await fs.mkdir(dir, {recursive: true});
    await assertDirectory(dir);
  }

  async function assertDirectory(dir) {
    const info = await fs.lstat(dir);
    if (info.isSymbolicLink() || !info.isDirectory() || await fs.realpath(dir) !== dir) {
      throw sessionError('INVALID_STORAGE_PATH', 'Audio storage must be a managed directory');
    }
  }

  function locations(id) {
    requireId(id);
    return {staging: path.join(stagingRoot, `${id}.part`), final: path.join(audioRoot, `${id}.wav`)};
  }

  async function publish(id, bytes) {
    await assertDirectory(audioRoot);
    await assertDirectory(stagingRoot);
    const files = locations(id);
    // A retry owns these deterministic names. Unlink never follows a leaf symlink.
    await fs.rm(files.staging, {force: true});
    const handle = await fs.open(files.staging, 'wx');
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally { await handle.close(); }
    const metadata = {byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
    await fs.rename(files.staging, files.final);
    return metadata;
  }

  async function inspect(artifact, includeBytes = false) {
    if (artifact.relativePath !== `audio/${artifact.sessionId}.wav`) return {state: 'corrupt'};
    const file = locations(artifact.sessionId).final;
    try {
      await assertDirectory(audioRoot);
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_AUDIO_BYTES ||
          stat.size !== artifact.byteLength) return {state: 'corrupt'};
      const bytes = await fs.readFile(file);
      if (bytes.length !== artifact.byteLength || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) {
        return {state: 'corrupt'};
      }
      return includeBytes ? {state: 'available', bytes} : {state: 'available'};
    } catch (error) {
      return {state: error.code === 'ENOENT' ? 'missing' : 'corrupt'};
    }
  }

  async function remove(id) {
    await assertDirectory(audioRoot);
    await assertDirectory(stagingRoot);
    const files = locations(id);
    await fs.rm(files.final, {force: true});
    await fs.rm(files.staging, {force: true});
  }

  async function reclaimStaging(referencedIds) {
    await assertDirectory(stagingRoot);
    const threshold = Date.now() - STAGING_MAX_AGE_MS;
    for (const entry of await fs.readdir(stagingRoot, {withFileTypes: true})) {
      if (!entry.isFile() || !/^[a-zA-Z0-9_-]{1,80}\.part$/.test(entry.name)) continue;
      if (referencedIds.has(entry.name.slice(0, -5))) continue;
      const file = path.join(stagingRoot, entry.name);
      if ((await fs.lstat(file)).mtimeMs < threshold) await fs.unlink(file);
    }
  }

  return {publish, inspect, remove, reclaimStaging};
}

module.exports = {createTrainingAudioStore, validateAudio};
