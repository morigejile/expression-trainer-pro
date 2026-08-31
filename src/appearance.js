(function exposeAppearance(globalObject) {
  'use strict';

  const THEMES = new Set(['graphite', 'midnight', 'paper', 'mist']);
  const LAYOUTS = new Set(['coach-rail', 'focus-hud']);

  function applyAppearance(root, appearance) {
    const normalized = {
      schemaVersion: 1,
      theme: THEMES.has(appearance?.theme) ? appearance.theme : 'graphite',
      layout: LAYOUTS.has(appearance?.layout) ? appearance.layout : 'coach-rail'
    };
    root.dataset.theme = normalized.theme;
    root.dataset.layout = normalized.layout;
    return normalized;
  }

  async function initializeAppearance({
    root = globalObject.document.documentElement,
    api = globalObject.api
  } = {}) {
    let appearance = applyAppearance(root, root.dataset);
    let receivedBroadcast = false;
    const unsubscribe = typeof api?.onAppearanceChanged === 'function'
      ? api.onAppearanceChanged(nextAppearance => {
        receivedBroadcast = true;
        appearance = applyAppearance(root, nextAppearance);
      })
      : () => {};

    try {
      if (typeof api?.getAppearance === 'function') {
        const loaded = await api.getAppearance();
        if (!receivedBroadcast) appearance = applyAppearance(root, loaded);
      }
    } catch {}

    return {
      appearance,
      unsubscribe: typeof unsubscribe === 'function' ? unsubscribe : () => {}
    };
  }

  const appearanceApi = {applyAppearance, initializeAppearance};
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = appearanceApi;
  } else {
    globalObject.Appearance = appearanceApi;
  }
})(typeof window !== 'undefined' ? window : globalThis);
