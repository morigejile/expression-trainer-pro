'use strict';

const {openTrainingSessionRepository} = require('./training-session-repository');
const {createTrainingAudioStore, validateAudio} = require('./training-audio-store');
const {normalizeCompletion, requireId, sessionError} = require('./training-session-data');

// One owner per application data root; Main will own this store at the Application boundary.
async function openTrainingSessionStore({root}) {
  const repository = openTrainingSessionRepository(root);
  let audio;
  try {
    audio = await createTrainingAudioStore(root);
    repository.recover();
    const artifacts = repository.allArtifacts();
    for (const artifact of artifacts) {
      const {state} = await audio.inspect(artifact);
      repository.setArtifactState(artifact.sessionId, state);
    }
    await audio.reclaimStaging(new Set(artifacts.map(artifact => artifact.sessionId)));
  } catch (error) {
    repository.close();
    throw error;
  }
  const pending = new Map();

  async function get(id) {
    const record = repository.get(id);
    if (!record || !record.artifact) return record;
    if (record.deletionPending) record.artifact.state = 'deleted';
    else if (record.status !== 'finalizing') {
      const {state} = await audio.inspect(record.artifact);
      const current = repository.get(id);
      if (!current || current.deletionPending) return null;
      repository.setArtifactState(id, state);
      record.artifact.state = state;
    }
    // Paths are repository details, never playback capabilities.
    const {relativePath, ...artifact} = record.artifact;
    return {...record, artifact};
  }

  async function finalize(id, input) {
    requireId(id);
    if (pending.has(id)) {
      const operation = pending.get(id);
      if (operation.kind !== 'finalize') throw sessionError('SESSION_BUSY', 'Session deletion is in progress');
      return operation.promise;
    }
    const record = repository.get(id);
    if (!record) throw sessionError('SESSION_NOT_FOUND', 'Training session no longer exists');
    if (record.deletionPending) throw sessionError('SESSION_BUSY', 'Session deletion is pending');
    if (record.status === 'completed') return get(id);
    const bytes = validateAudio(input?.audio);
    const facts = normalizeCompletion(input, record, (bytes.length - 44) / 2);
    repository.beginFinalization(id);
    const promise = (async () => {
      try {
        const metadata = await audio.publish(id, bytes);
        repository.complete(id, facts, metadata);
        return await get(id);
      } catch {
        repository.markIncomplete(id);
        throw sessionError('FINALIZATION_FAILED', 'Training could not be saved. Retry while this recording is available.');
      } finally { pending.delete(id); }
    })();
    pending.set(id, {kind: 'finalize', promise});
    return promise;
  }

  async function remove(id) {
    requireId(id);
    if (pending.has(id)) throw sessionError('SESSION_BUSY', 'A session operation is in progress');
    if (!repository.get(id)) return;
    repository.markDeleting(id);
    const promise = (async () => {
      try {
        await audio.remove(id);
        repository.remove(id);
      } catch {
        throw sessionError('DELETION_FAILED', 'Training deletion is incomplete. Retry deleting this session.');
      } finally { pending.delete(id); }
    })();
    pending.set(id, {kind: 'delete', promise});
    return promise;
  }

  async function readAudio(id) {
    const record = repository.get(id);
    if (!record || record.status !== 'completed' || record.deletionPending || !record.artifact) {
      throw sessionError('AUDIO_UNAVAILABLE', 'Recording is not available for playback');
    }
    const result = await audio.inspect(record.artifact, true);
    repository.setArtifactState(id, result.state);
    const current = repository.get(id);
    if (result.state !== 'available' || pending.has(id) || !current ||
        current.status !== 'completed' || current.deletionPending) {
      throw sessionError('AUDIO_UNAVAILABLE', 'Recording is missing or damaged');
    }
    return result.bytes;
  }

  return {
    create: repository.create, list: repository.list, get, finalize, delete: remove, readAudio,
    async appendResult(id, input) { return repository.appendResult(id, input); },
    interrupt: repository.interrupt,
    close() {
      if (pending.size) throw sessionError('SESSION_BUSY', 'Wait for pending session writes before closing');
      repository.close();
    }
  };
}

module.exports = {openTrainingSessionStore};
