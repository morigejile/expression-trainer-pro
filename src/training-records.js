(function attachTrainingRecords(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrainingRecords = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createModule() {
  'use strict';

  function findSegmentAtTime(segments, currentMs) {
    if (!Array.isArray(segments) || !Number.isFinite(currentMs)) return null;
    let low = 0;
    let high = segments.length - 1;
    let candidate = -1;
    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2);
      if (currentMs < segments[middle].startMs) high = middle - 1;
      else { candidate = middle; low = middle + 1; }
    }
    if (candidate < 0) return null;
    const segment = segments[candidate];
    if (currentMs < segment.endMs) return segment;
    const final = segments[segments.length - 1];
    return candidate === segments.length - 1 && currentMs === final.endMs ? final : null;
  }

  function createTrainingRecordStore({ maxRecords = 5, revokeObjectURL = () => {} } = {}) {
    if (!Number.isInteger(maxRecords) || maxRecords < 1) throw new RangeError('maxRecords must be a positive integer');
    if (typeof revokeObjectURL !== 'function') throw new TypeError('revokeObjectURL must be a function');
    const records = [];
    let selectedId = null;
    const revokedUrls = new Set();

    function release(record) {
      if (record && typeof record.audioUrl === 'string' && record.audioUrl !== '' && !revokedUrls.has(record.audioUrl)) {
        revokedUrls.add(record.audioUrl);
        revokeObjectURL(record.audioUrl);
      }
    }
    function add(record) {
      if (!record || typeof record !== 'object') throw new TypeError('record must be an object');
      records.push(record);
      selectedId = record.id;
      while (records.length > maxRecords) release(records.shift());
      return record;
    }
    function remove(recordId) {
      const index = records.findIndex(record => record.id === recordId);
      if (index < 0) return null;
      const [removed] = records.splice(index, 1);
      release(removed);
      if (selectedId === recordId) selectedId = records.length ? records[records.length - 1].id : null;
      return removed;
    }
    function replace(recordId, updater) {
      if (typeof updater !== 'function') throw new TypeError('updater must be a function');
      const index = records.findIndex(record => record.id === recordId);
      if (index < 0) return null;
      const next = updater(records[index]);
      if (!next || typeof next !== 'object') throw new TypeError('updater must return a record');
      records[index] = next;
      return next;
    }
    function select(recordId) {
      if (!records.some(record => record.id === recordId)) return null;
      selectedId = recordId;
      return selected();
    }
    function selected() { return records.find(record => record.id === selectedId) || null; }
    function list() { return records.slice(); }
    function clear() {
      while (records.length) release(records.shift());
      selectedId = null;
    }
    return { add, remove, replace, select, selected, list, clear };
  }

  function pad(value) { return String(value).padStart(2, '0'); }
  function formatRecordLabel(record) {
    const date = new Date(record.createdAt);
    const totalSeconds = Math.max(0, Math.floor((Number(record.durationMs) || 0) / 1000));
    return `${pad(date.getHours())}:${pad(date.getMinutes())} · ${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}`;
  }

  return { createTrainingRecordStore, findSegmentAtTime, formatRecordLabel };
});
