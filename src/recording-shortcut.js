(function initRecordingShortcut(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RecordingShortcut = api;
})(typeof window !== 'undefined' ? window : globalThis, function createRecordingShortcut() {
  const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

  function resolveRecordingShortcutAction({
    key,
    repeat,
    targetTagName,
    editable,
    blocked,
    isRecording,
    isPaused
  } = {}) {
    if (key !== ' ' || repeat || blocked || editable || EDITABLE_TAGS.has(targetTagName)) return null;
    if (!isRecording) return 'start';
    return isPaused ? 'resume' : 'pause';
  }

  return Object.freeze({resolveRecordingShortcutAction});
});
