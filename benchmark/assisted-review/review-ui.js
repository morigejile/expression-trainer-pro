'use strict';

(function reviewUi(global) {
  function renderText(node, text) {
    node.textContent = String(text);
  }

  function appendTextItem(list, text, documentRef) {
    const item = documentRef.createElement('li');
    renderText(item, text);
    list.append(item);
  }

  function buildTransition(action, values, expectedRevision) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error('invalid review transition');
    const source = typeof values === 'string' ? { transcriptText: values } : values;
    if (!source || typeof source !== 'object') throw new Error('invalid review transition');
    if (action === 'record-primary-transcript') return { action, payload: { transcriptText: source.transcriptText }, expectedRevision };
    if (action === 'approve-secondary-transcript') return { action, payload: {}, expectedRevision };
    if (action === 'approve-license') return { action, payload: { approved: true }, expectedRevision };
    if (action === 'clear-pii') return { action, payload: { cleared: true }, expectedRevision };
    if (action === 'set-final-tags') return { action, payload: { tags: source.tags, lightAccentRationale: source.lightAccentRationale || null }, expectedRevision };
    throw new Error('invalid review transition');
  }

  async function fetchCandidate(candidateId) {
    const response = await fetch(`/api/candidates/${encodeURIComponent(candidateId)}`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('candidate unavailable');
    return response.json();
  }

  function showCandidate(candidate, documentRef = document) {
    renderText(documentRef.getElementById('candidate-id'), candidate.candidateId || '');
    renderText(documentRef.getElementById('upstream-transcript'), candidate.transcript || '');
    renderText(documentRef.getElementById('primary-transcript'), candidate.primaryTranscriptText || '');
    renderText(documentRef.getElementById('comparison-risk'), candidate.comparison && candidate.comparison.risk || '');
    renderText(documentRef.getElementById('approval-state'), JSON.stringify(candidate.state || {}));
    const audio = documentRef.getElementById('review-audio');
    audio.src = `/api/candidates/${encodeURIComponent(candidate.candidateId || '')}/audio`;
    const predictions = documentRef.getElementById('predictions');
    predictions.replaceChildren();
    for (const prediction of Array.isArray(candidate.predictions) ? candidate.predictions : []) appendTextItem(predictions, prediction.rawText || '', documentRef);
    const suggestions = documentRef.getElementById('suggestions'); suggestions.replaceChildren();
    for (const suggestion of Array.isArray(candidate.suggestions && candidate.suggestions.suggestions) ? candidate.suggestions.suggestions : []) {
      const status = suggestion.humanOnly ? 'human-only' : suggestion.result ? 'suggested' : 'not suggested';
      const numeric = ['fast', 'slow', 'light-noise'].includes(suggestion.tag);
      const policy = numeric ? (candidate.numericPolicyApproved ? 'approved' : 'unapproved') : 'policy-not-required';
      appendTextItem(suggestions, `${suggestion.tag || ''}: ${status} (${policy})`, documentRef);
    }
    const warnings = documentRef.getElementById('pii-warnings'); warnings.replaceChildren();
    for (const warning of Array.isArray(candidate.suggestions && candidate.suggestions.piiWarnings) ? candidate.suggestions.piiWarnings : []) appendTextItem(warnings, warning.ruleId || '', documentRef);
    const revision = documentRef.getElementById('expected-revision'); if (candidate.state && Number.isInteger(candidate.state.revision)) revision.value = String(candidate.state.revision);
    const action = documentRef.getElementById('action-input');
    for (const option of action.options) option.hidden = !candidate.allowedActions.includes(option.value);
    action.value = candidate.allowedActions[0] || '';
    updateActionFields(documentRef);
  }

  function updateActionFields(documentRef = document) {
    const action = documentRef.getElementById('action-input').value;
    const transcript = documentRef.getElementById('transcript-input'); const tags = documentRef.getElementById('tags-input'); const rationale = documentRef.getElementById('light-accent-rationale');
    transcript.hidden = action !== 'record-primary-transcript'; transcript.required = action === 'record-primary-transcript';
    tags.hidden = action !== 'set-final-tags'; tags.required = action === 'set-final-tags';
    rationale.hidden = action !== 'set-final-tags'; rationale.required = action === 'set-final-tags' && tags.value.split(',').map((tag) => tag.trim()).includes('light-accent');
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
    document.getElementById('action-input').addEventListener('change', () => updateActionFields());
    document.getElementById('tags-input').addEventListener('input', () => updateActionFields());
    transitionForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const candidateId = document.getElementById('candidate-id').textContent;
        const action = document.getElementById('action-input').value;
        const tags = document.getElementById('tags-input').value.split(',').map((tag) => tag.trim()).filter(Boolean);
        const body = buildTransition(action, { transcriptText: document.getElementById('transcript-input').value, tags, lightAccentRationale: document.getElementById('light-accent-rationale').value || null }, Number(document.getElementById('expected-revision').value));
        const response = await fetch(`/api/candidates/${encodeURIComponent(candidateId)}/transitions`, {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.body.dataset.csrf }, body: JSON.stringify(body)
        });
        if (!response.ok) throw new Error('transition unavailable');
        const state = await response.json(); document.getElementById('expected-revision').value = String(state.revision); renderText(status, 'Review action recorded');
      } catch {
        renderText(status, 'Transcript was not recorded');
      }
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { buildTransition, renderText, initializeReviewUi, showCandidate, updateActionFields };
  if (global.document) global.document.addEventListener('DOMContentLoaded', initializeReviewUi, { once: true });
}(globalThis));
