'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {atomicWriteJsonSync} = require('./atomic-json-store');
const {
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
 * analyze-text 每句都要取一次训练规则，逐句同步读文件会阻塞主进程，
 * 损坏文件还会每句 warn 一次。按 mtime+size 缓存解析结果，保存时显式失效。
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
    cache = null;
    const normalized = normalizeCustomPrompt(data);
    atomicWrite(getCustomPromptPath(userDataPath), normalized, {fsImpl});
    return normalized;
  }

  return {load, save};
}

module.exports = {
  CUSTOM_PROMPT_FILENAME,
  getCustomPromptPath,
  createCustomPromptStore
};
