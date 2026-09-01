'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {atomicWriteJsonSync} = require('./atomic-json-store');
const {validateFinalReportPayload, requireBoundedText} = require('./ipc-input');

const HISTORY_FILENAME = 'training-history.json';
const HISTORY_SCHEMA_VERSION = 1;
const HISTORY_LIMIT = 50;
const SOURCES = new Set(['recording', 'paste']);

function historyPath(userDataPath) {
  return path.join(userDataPath, HISTORY_FILENAME);
}

function emptyHistory() {
  return {schemaVersion: HISTORY_SCHEMA_VERSION, entries: []};
}

function isStats(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && ['duration', 'fillers', 'hedges', 'totalWords', 'vagueWords']
      .every(field => Number.isFinite(value[field]) && value[field] >= 0);
}

function isEntry(entry) {
  return entry
    && typeof entry === 'object'
    && typeof entry.id === 'string'
    && typeof entry.createdAt === 'string'
    && typeof entry.updatedAt === 'string'
    && SOURCES.has(entry.source)
    && typeof entry.transcript === 'string'
    && isStats(entry.stats)
    && (entry.report === null || typeof entry.report === 'string');
}

function readHistory(userDataPath, {fsImpl = fs, logger = console, strict = false} = {}) {
  const filePath = historyPath(userDataPath);
  if (!fsImpl.existsSync(filePath)) return emptyHistory();
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(filePath, 'utf8'));
    if (parsed?.schemaVersion !== HISTORY_SCHEMA_VERSION
        || !Array.isArray(parsed.entries)
        || !parsed.entries.every(isEntry)) throw new Error('invalid history');
    return {schemaVersion: HISTORY_SCHEMA_VERSION, entries: parsed.entries.slice(0, HISTORY_LIMIT)};
  } catch {
    if (strict) {
      const error = new Error('Existing history file is invalid');
      error.code = 'invalid-history-file';
      throw error;
    }
    logger.warn('[历史记录] training-history.json 无法读取，保留原文件并显示空历史');
    return emptyHistory();
  }
}

function writeHistory(userDataPath, history, {fsImpl = fs, atomicWrite = atomicWriteJsonSync} = {}) {
  atomicWrite(historyPath(userDataPath), history, {fsImpl});
}

function validateSource(source) {
  if (!SOURCES.has(source)) throw new TypeError('history source is invalid');
}

function createHistoryEntry(userDataPath, payload, {
  now = () => new Date().toISOString(),
  randomUUID = crypto.randomUUID,
  fsImpl = fs,
  atomicWrite = atomicWriteJsonSync
} = {}) {
  validateSource(payload?.source);
  validateFinalReportPayload({fullText: payload?.transcript, stats: payload?.stats});
  const timestamp = now();
  const entry = {
    id: randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
    source: payload.source,
    transcript: payload.transcript,
    stats: {...payload.stats},
    report: null
  };
  const history = readHistory(userDataPath, {fsImpl, strict: true});
  history.entries.unshift(entry);
  history.entries = history.entries.slice(0, HISTORY_LIMIT);
  writeHistory(userDataPath, history, {fsImpl, atomicWrite});
  return {...entry, stats: {...entry.stats}};
}

function updateHistoryReport(userDataPath, payload, {
  now = () => new Date().toISOString(),
  fsImpl = fs,
  atomicWrite = atomicWriteJsonSync
} = {}) {
  requireBoundedText(payload?.id, {label: 'history id', maximumLength: 128});
  requireBoundedText(payload?.report, {label: 'history report', maximumLength: 2 * 1024 * 1024});
  const history = readHistory(userDataPath, {fsImpl, strict: true});
  const entry = history.entries.find(item => item.id === payload.id);
  if (!entry) return null;
  entry.report = payload.report;
  entry.updatedAt = now();
  writeHistory(userDataPath, history, {fsImpl, atomicWrite});
  return {...entry, stats: {...entry.stats}};
}

function listHistoryEntries(userDataPath, options = {}) {
  return readHistory(userDataPath, options).entries.map(entry => ({
    id: entry.id,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    source: entry.source,
    stats: {...entry.stats},
    hasReport: Boolean(entry.report),
    preview: entry.transcript.replace(/\s+/g, ' ').trim().slice(0, 80)
  }));
}

function getHistoryEntry(userDataPath, id, options = {}) {
  if (typeof id !== 'string' || !id) return null;
  const entry = readHistory(userDataPath, options).entries.find(item => item.id === id);
  return entry ? {...entry, stats: {...entry.stats}} : null;
}

module.exports = {
  HISTORY_FILENAME,
  HISTORY_LIMIT,
  createHistoryEntry,
  getHistoryEntry,
  listHistoryEntries,
  updateHistoryReport
};
