(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AppearanceConfig=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
'use strict';

const CURRENT_APPEARANCE_SCHEMA_VERSION = 1;
const THEME_OPTIONS = Object.freeze([
  Object.freeze({id:'graphite',label:'当前默认',description:'沿用当前的浅暖色外观。'}),
  Object.freeze({id:'coral-glow',label:'珊瑚霞光',description:'桃珊瑚与玫瑰色背景，轻盈的玻璃表面。'}),
  Object.freeze({id:'ink-night',label:'墨夜·沉静深色',description:'深炭灰表面，暖白文字与克制的暖色点缀。'})
]);
const THEME_IDS = Object.freeze(THEME_OPTIONS.map(option=>option.id));
// Retired palettes and layouts normalize without rewriting the saved file during reads.
const LAYOUT_IDS = Object.freeze(['coach-rail']);

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

return {
  CURRENT_APPEARANCE_SCHEMA_VERSION,
  THEME_IDS,
  THEME_OPTIONS,
  LAYOUT_IDS,
  createDefaultAppearance,
  normalizeAppearance,
  parseAppearanceJson
};
});
