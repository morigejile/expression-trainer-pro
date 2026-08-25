'use strict';

(function reviewUi(global) {
  function renderText(node, text) {
    node.textContent = String(text);
  }

  function appendTextItem(list, text) {
    const item = document.createElement('li');
    renderText(item, text);
    list.append(item);
  }

  function buildTransition(action, transcriptText, expectedRevision) {
    if (action !== 'record-primary-transcript' || !Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error('invalid review transition');
    return { action, payload: { transcriptText }, expectedRevision };
  }

  async function fetchCandidate(candidateId) {
    const response = await fetch(`/api/candidates/${encodeURIComponent(candidateId)}`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('candidate unavailable');
    return response.json();
  }

  function showCandidate(candidate) {
    renderText(document.getElementById('candidate-id'), candidate.candidateId || '');
    renderText(document.getElementById('upstream-transcript'), candidate.transcript || '');
    renderText(document.getElementById('primary-transcript'), candidate.primaryTranscriptText || '');
    const predictions = document.getElementById('predictions');
    predictions.replaceChildren();
    for (const prediction of Array.isArray(candidate.predictions) ? candidate.predictions : []) appendTextItem(predictions, prediction.rawText || '');
  }

  function initializeReviewUi() {
    const form = document.getElementById('candidate-form');
    if (!form) return;
    const status = document.getElementById('status');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const candidate = await fetchCandidate(document.getElementById('candidate-input').value);
        showCandidate(candidate);
        renderText(status, 'Loaded');
      } catch {
        renderText(status, 'Candidate unavailable');
      }
    });
    const transitionForm = document.getElementById('transition-form');
    transitionForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const candidateId = document.getElementById('candidate-id').textContent;
        const body = buildTransition('record-primary-transcript', document.getElementById('transcript-input').value, Number(document.getElementById('expected-revision').value));
        const response = await fetch(`/api/candidates/${encodeURIComponent(candidateId)}/transitions`, {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.body.dataset.csrf }, body: JSON.stringify(body)
        });
        if (!response.ok) throw new Error('transition unavailable');
        renderText(status, 'Transcript recorded');
      } catch {
        renderText(status, 'Transcript was not recorded');
      }
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { buildTransition, renderText, initializeReviewUi, showCandidate };
  if (global.document) global.document.addEventListener('DOMContentLoaded', initializeReviewUi, { once: true });
}(globalThis));
