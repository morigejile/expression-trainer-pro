'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {atomicWriteJsonSync} = require('./atomic-json-store');
const {
  createDefaultAppearance,
  normalizeAppearance,
  parseAppearanceJson
} = require('./appearance-config');

const APPEARANCE_FILENAME = 'appearance.json';

function getAppearancePath(userDataPath) {
  return path.join(userDataPath, APPEARANCE_FILENAME);
}

function loadAppearance(userDataPath, {fsImpl = fs, logger = console} = {}) {
  const filePath = getAppearancePath(userDataPath);
  if (!fsImpl.existsSync(filePath)) return createDefaultAppearance();

  try {
    const parsed = parseAppearanceJson(fsImpl.readFileSync(filePath, 'utf8'));
    if (parsed.error) {
      logger.warn('[外观] appearance.json 无法解析，使用默认外观并保留原文件');
      return createDefaultAppearance();
    }
    return parsed.appearance;
  } catch {
    logger.warn('[外观] appearance.json 无法读取，使用默认外观');
    return createDefaultAppearance();
  }
}

function saveAppearance(userDataPath, appearance, {
  fsImpl = fs,
  atomicWrite = atomicWriteJsonSync
} = {}) {
  const filePath = getAppearancePath(userDataPath);
  if (fsImpl.existsSync(filePath)) {
    const parsed = parseAppearanceJson(fsImpl.readFileSync(filePath, 'utf8'));
    if (parsed.isFutureSchema) {
      const error = new Error('Current application cannot save a future appearance schema');
      error.code = 'unsupported-schema-version';
      throw error;
    }
  }

  const normalized = normalizeAppearance(appearance);
  atomicWrite(filePath, normalized, {fsImpl});
  return normalized;
}

module.exports = {
  APPEARANCE_FILENAME,
  getAppearancePath,
  loadAppearance,
  saveAppearance
};
