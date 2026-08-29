'use strict';

const CURRENT_CUSTOM_PROMPT_SCHEMA_VERSION = 1;
const CUSTOM_PROMPT_FIELDS = ['goals', 'customRules', 'styleRef', 'customWords'];

function createDefaultCustomPrompt() {
  return {
    schemaVersion: CURRENT_CUSTOM_PROMPT_SCHEMA_VERSION,
    goals: '',
    customRules: '',
    styleRef: '',
    customWords: ''
  };
}

function normalizeCustomPrompt(raw) {
  const prompt = createDefaultCustomPrompt();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return prompt;
  for (const field of CUSTOM_PROMPT_FIELDS) {
    if (typeof raw[field] === 'string') prompt[field] = raw[field];
  }
  return prompt;
}

function customWordsToFillers(customWords) {
  if (typeof customWords !== 'string') return [];
  const fillers = [];
  const seen = new Set();
  for (const word of customWords.split(/[\s,，、;；]+/u)) {
    const normalized = word.trim();
    if (!normalized || normalized.length > 32 || seen.has(normalized)) continue;
    seen.add(normalized);
    fillers.push(normalized);
    if (fillers.length === 64) break;
  }
  return fillers;
}

function parseCustomPromptJson(json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    return {prompt: createDefaultCustomPrompt(), shouldPersist: false, error: 'invalid-json'};
  }
  const prompt = normalizeCustomPrompt(raw);
  const futureSchema = Number.isInteger(raw?.schemaVersion) && raw.schemaVersion > CURRENT_CUSTOM_PROMPT_SCHEMA_VERSION;
  const shouldPersist = !futureSchema && (raw?.schemaVersion !== CURRENT_CUSTOM_PROMPT_SCHEMA_VERSION
    || CUSTOM_PROMPT_FIELDS.some((field) => typeof raw?.[field] !== 'string')
    || Object.keys(raw || {}).some((field) => field !== 'schemaVersion' && !CUSTOM_PROMPT_FIELDS.includes(field)));
  return {prompt, shouldPersist, error: null};
}

module.exports = {
  CURRENT_CUSTOM_PROMPT_SCHEMA_VERSION,
  createDefaultCustomPrompt,
  customWordsToFillers,
  normalizeCustomPrompt,
  parseCustomPromptJson
};
