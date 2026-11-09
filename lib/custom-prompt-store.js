'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {atomicWriteJsonSync} = require('./atomic-json-store');
const {
  CURRENT_CUSTOM_PROMPT_SCHEMA_VERSION,
  createDefaultCustomPrompt,
  normalizeCustomPrompt,
  parseCustomPromptJson
} = require('./custom-prompt-config');

const CUSTOM_PROMPT_FILENAME = 'custom-prompt.json';

function getCustomPromptPath(userDataPath) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('userDataPath must be an absolute path');
  }
  return path.join(userDataPath, CUSTOM_PROMPT_FILENAME);
}

/**
 * 设置和报告生成复用按 mtime+size 缓存的解析结果，保存时显式失效。
 */
function createCustomPromptStore({
  fsImpl = fs,
  logger = console,
  atomicWrite = atomicWriteJsonSync
} = {}) {
  let cache = null;

  function remember(filePath, stats, prompt) {
    cache = {filePath, mtimeMs: stats.mtimeMs, size: stats.size, prompt};
    return {...prompt};
  }

  function load(userDataPath) {
    const filePath = getCustomPromptPath(userDataPath);
    let stats;
    try {
      stats = fsImpl.statSync(filePath);
    } catch {
      cache = null;
      return createDefaultCustomPrompt();
    }

    if (cache
        && cache.filePath === filePath
        && cache.mtimeMs === stats.mtimeMs
        && cache.size === stats.size) {
      return {...cache.prompt};
    }

    const parsed = parseCustomPromptJson(fsImpl.readFileSync(filePath, 'utf8'));
    if (parsed.error) {
      logger.warn('[规则] custom-prompt.json 无法解析，使用默认规则并保留原文件');
      return remember(filePath, stats, parsed.prompt);
    }
    if (parsed.shouldPersist) {
      // 迁移写入会改变 mtime，交给下一次调用按新状态重新登记
      save(userDataPath, parsed.prompt);
      return {...parsed.prompt};
    }
    return remember(filePath, stats, parsed.prompt);
  }

  function save(userDataPath, data) {
    const filePath = getCustomPromptPath(userDataPath);
    let raw;
    try { raw = JSON.parse(fsImpl.readFileSync(filePath,'utf8')); }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    if (Number.isInteger(raw?.schemaVersion) && raw.schemaVersion > CURRENT_CUSTOM_PROMPT_SCHEMA_VERSION) {
      throw Object.assign(new Error('Unsupported preferences schema version'),{code:'unsupported-schema-version'});
    }
    cache = null;
    const normalized = normalizeCustomPrompt(data);
    atomicWrite(filePath, normalized, {fsImpl});
    return normalized;
  }

  return {load, save};
}

module.exports = {
  CUSTOM_PROMPT_FILENAME,
  getCustomPromptPath,
  createCustomPromptStore
};
