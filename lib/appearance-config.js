'use strict';

const CURRENT_APPEARANCE_SCHEMA_VERSION = 1;
const THEME_IDS = Object.freeze(['graphite', 'midnight', 'paper', 'mist']);
const LAYOUT_IDS = Object.freeze(['coach-rail', 'focus-hud']);

function createDefaultAppearance() {
  return {
    schemaVersion: CURRENT_APPEARANCE_SCHEMA_VERSION,
    theme: 'graphite',
    layout: 'coach-rail'
  };
}

function normalizeAppearance(raw) {
  const defaults = createDefaultAppearance();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults;

  return {
    schemaVersion: CURRENT_APPEARANCE_SCHEMA_VERSION,
    theme: THEME_IDS.includes(raw.theme) ? raw.theme : defaults.theme,
    layout: LAYOUT_IDS.includes(raw.layout) ? raw.layout : defaults.layout
  };
}

function parseAppearanceJson(json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    return {
      appearance: createDefaultAppearance(),
      isFutureSchema: false,
      error: 'invalid-json'
    };
  }

  return {
    appearance: normalizeAppearance(raw),
    isFutureSchema: Number.isInteger(raw?.schemaVersion)
      && raw.schemaVersion > CURRENT_APPEARANCE_SCHEMA_VERSION,
    error: null
  };
}

module.exports = {
  CURRENT_APPEARANCE_SCHEMA_VERSION,
  THEME_IDS,
  LAYOUT_IDS,
  createDefaultAppearance,
  normalizeAppearance,
  parseAppearanceJson
};
