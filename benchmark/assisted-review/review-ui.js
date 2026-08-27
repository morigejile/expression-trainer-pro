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

  function buildConfirmation(transcriptText) {
    if (typeof transcriptText !== 'string' || transcriptText.trim() === '') throw new Error('invalid final transcript');
    return { transcriptText };
  }

  async function fetchCandidate(candidateId) {
    const response = await fetch(`/api/candidates/${encodeURIComponent(candidateId)}`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('candidate unavailable');
    return response.json();
  }

  async function fetchSummary() {
    const response = await fetch('/api/review-status', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('review status unavailable');
    return response.json();
  }

  function showSummary(summary, documentRef = document) {
    for (const name of ['confirmed', 'pending', 'invalid', 'stale']) {
      renderText(documentRef.getElementById(`${name}-count`), summary[`${name}Count`] || 0);
    }
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
    for (const prediction of Array.isArray(candidate.predictions) ? candidate.predictions : []) {
      const detail = prediction.status === 'failed' ? `failed (${prediction.errorCode || 'INFERENCE_FAILED'})` : `succeeded: ${prediction.rawText || ''}`;
      appendTextItem(predictions, prediction.role ? `${prediction.role}: ${detail}` : prediction.rawText || '', documentRef);
    }
    if (candidate.workflow === 'single') {
      renderText(documentRef.getElementById('review-status'), candidate.reviewStatus || 'invalid');
      documentRef.getElementById('final-transcript-input').value = candidate.finalTranscriptText || candidate.transcript || '';
      documentRef.getElementById('confirm-final-button').disabled = candidate.reviewStatus === 'confirmed' || candidate.reviewStatus === 'invalid';
      documentRef.getElementById('single-review').hidden = false;
      documentRef.getElementById('legacy-review').hidden = true;
      documentRef.getElementById('legacy-primary').hidden = true;
      documentRef.getElementById('legacy-governance').hidden = true;
      return;
    }
    const singleSection = documentRef.getElementById('single-review');
    const legacySection = documentRef.getElementById('legacy-review');
    if (singleSection) singleSection.hidden = true;
    if (legacySection) legacySection.hidden = false;
    documentRef.getElementById('legacy-primary').hidden = false;
    documentRef.getElementById('legacy-governance').hidden = false;
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
    let summary = null;
    async function refreshSummary() {
      summary = await fetchSummary();
      showSummary(summary);
      return summary;
    }
    async function loadCandidate(candidateId) {
      const candidate = await fetchCandidate(candidateId);
      showCandidate(candidate);
      document.getElementById('candidate-input').value = candidate.candidateId;
      renderText(status, 'Loaded');
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await loadCandidate(document.getElementById('candidate-input').value);
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
    document.getElementById('confirm-final-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const candidateId = document.getElementById('candidate-id').textContent;
        const body = buildConfirmation(document.getElementById('final-transcript-input').value);
        const response = await fetch(`/api/candidates/${encodeURIComponent(candidateId)}/confirm`, {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.body.dataset.csrf }, body: JSON.stringify(body)
        });
        if (!response.ok) throw new Error('confirmation unavailable');
        showCandidate(await response.json());
        const current = await refreshSummary();
        renderText(status, 'Final transcript explicitly confirmed');
        const nextCandidateId = [...current.pending, ...current.stale][0];
        if (nextCandidateId) await loadCandidate(nextCandidateId);
      } catch {
        renderText(status, 'Final transcript was not confirmed');
      }
    });
    refreshSummary().then((current) => {
      const candidateId = [...current.pending, ...current.stale][0];
      if (candidateId) return loadCandidate(candidateId);
      return undefined;
    }).catch(() => {});
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { buildConfirmation, buildTransition, renderText, initializeReviewUi, showCandidate, showSummary, updateActionFields };
  if (global.document) global.document.addEventListener('DOMContentLoaded', initializeReviewUi, { once: true });
}(globalThis));
