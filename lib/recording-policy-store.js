'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {atomicWriteJsonSync} = require('./atomic-json-store');

const RECORDING_POLICY_FILENAME = 'recording-policy.json';
const RECORDING_POLICY_SCHEMA_VERSION = 1;

function getRecordingPolicyPath(userDataPath) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('userDataPath must be an absolute path');
  }
  return path.join(userDataPath, RECORDING_POLICY_FILENAME);
}

function createDefaultRecordingPolicy() {
  return {schemaVersion: RECORDING_POLICY_SCHEMA_VERSION, acknowledged: false};
}

function parseRecordingPolicyJson(json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    return {policy: createDefaultRecordingPolicy(), isFutureSchema: false, error: 'invalid-json'};
  }

  return {
    policy: {
      schemaVersion: RECORDING_POLICY_SCHEMA_VERSION,
      acknowledged: raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? raw.acknowledged === true
        : false
    },
    isFutureSchema: Number.isInteger(raw?.schemaVersion)
      && raw.schemaVersion > RECORDING_POLICY_SCHEMA_VERSION,
    error: null
  };
}

function loadRecordingPolicy(userDataPath, {fsImpl = fs, logger = console} = {}) {
  const filePath = getRecordingPolicyPath(userDataPath);
  if (!fsImpl.existsSync(filePath)) return createDefaultRecordingPolicy();

  try {
    const parsed = parseRecordingPolicyJson(fsImpl.readFileSync(filePath, 'utf8'));
    if (parsed.error) {
      logger.warn('[录音政策] recording-policy.json 无法解析，使用默认政策并保留原文件');
      return createDefaultRecordingPolicy();
    }
    return parsed.policy;
  } catch {
    logger.warn('[录音政策] recording-policy.json 无法读取，使用默认政策');
    return createDefaultRecordingPolicy();
  }
}

function acknowledgeRecordingPolicy(
  userDataPath,
  {fsImpl = fs, atomicWrite = atomicWriteJsonSync} = {}
) {
  const filePath = getRecordingPolicyPath(userDataPath);
  if (fsImpl.existsSync(filePath)) {
    const parsed = parseRecordingPolicyJson(fsImpl.readFileSync(filePath, 'utf8'));
    if (parsed.isFutureSchema) {
      const error = new Error('Current application cannot save a future recording policy schema');
      error.code = 'unsupported-schema-version';
      throw error;
    }
  }

  const policy = {schemaVersion: RECORDING_POLICY_SCHEMA_VERSION, acknowledged: true};
  atomicWrite(filePath, policy, {fsImpl});
  return policy;
}

module.exports = {
  RECORDING_POLICY_FILENAME,
  RECORDING_POLICY_SCHEMA_VERSION,
  getRecordingPolicyPath,
  createDefaultRecordingPolicy,
  loadRecordingPolicy,
  acknowledgeRecordingPolicy
};
