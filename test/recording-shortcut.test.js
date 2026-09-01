const test = require('node:test');
const assert = require('node:assert/strict');

const {resolveRecordingShortcutAction} = require('../src/recording-shortcut');

test('Space starts, pauses, and resumes according to recording state', () => {
  const base = {key: ' ', repeat: false, targetTagName: 'BODY', editable: false, blocked: false};
  assert.equal(resolveRecordingShortcutAction({...base, isRecording: false, isPaused: false}), 'start');
  assert.equal(resolveRecordingShortcutAction({...base, isRecording: true, isPaused: false}), 'pause');
  assert.equal(resolveRecordingShortcutAction({...base, isRecording: true, isPaused: true}), 'resume');
});

test('recording shortcut ignores repeats, editable controls, modals, and pending operations', () => {
  const base = {key: ' ', repeat: false, targetTagName: 'BODY', editable: false, blocked: false, isRecording: false, isPaused: false};
  assert.equal(resolveRecordingShortcutAction({...base, repeat: true}), null);
  assert.equal(resolveRecordingShortcutAction({...base, targetTagName: 'TEXTAREA'}), null);
  assert.equal(resolveRecordingShortcutAction({...base, editable: true}), null);
  assert.equal(resolveRecordingShortcutAction({...base, blocked: true}), null);
  assert.equal(resolveRecordingShortcutAction({...base, key: 'Enter'}), null);
});
