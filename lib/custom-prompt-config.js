'use strict';

const CURRENT_CUSTOM_PROMPT_SCHEMA_VERSION = 2;
const CUSTOM_PROMPT_FIELDS = ['goals', 'styleRef'];
const CUSTOM_PROMPT_LIMITS = {goals:40002,styleRef:20000};

function createDefaultCustomPrompt() {
  return {
    schemaVersion: CURRENT_CUSTOM_PROMPT_SCHEMA_VERSION,
    goals: '',
    styleRef: ''
  };
}

function normalizeCustomPrompt(raw) {
  const prompt = createDefaultCustomPrompt();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return prompt;
  for (const field of CUSTOM_PROMPT_FIELDS) {
    if (typeof raw[field] === 'string') prompt[field] = raw[field];
  }
  // Only legacy preferences merge the retired instruction field, once.
  if ((!Number.isInteger(raw.schemaVersion) || raw.schemaVersion < 2) &&
      typeof raw.customRules === 'string' && raw.customRules.trim() && raw.customRules !== prompt.goals) {
    prompt.goals = prompt.goals.trim() ? `${prompt.goals}\n\n${raw.customRules}` : raw.customRules;
  }
  return prompt;
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
  CUSTOM_PROMPT_LIMITS,
  createDefaultCustomPrompt,
  normalizeCustomPrompt,
  parseCustomPromptJson
};
