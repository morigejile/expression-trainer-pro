'use strict';
const {analyzeText} = require('./lexicon');
const {normalizeCustomPrompt} = require('./custom-prompt-config');
const {analysisCharacterCounts} = require('../shared/text-statistics');

// Read-only compatibility for historical M2 results with vocabulary but no counts.
function legacyFillers(words) {
  return [...new Set(words.split(/[\s,，、;；]+/u).map(word=>word.trim())
    .filter(word=>word && word.length<=32))].slice(0,64);
}

function buildSessionAnalysisInputs(session,prompt,{fresh=false} = {}) {
  const analysisInstructions=normalizeCustomPrompt(prompt);
  const runs=(session.results || []).filter(run=>run.status==='completed' && run.inputRevision===session.transcript.revision);
  const common=runs.find(run=>run.kind==='common-analysis');
  const legacy=runs.find(run=>run.kind==='metrics' && run.value?.stats);
  if (common?.value?.localStatsSnapshot || legacy) {
    const source=common?.value?.localStatsSnapshot ? common : legacy;
    return {analysisInstructions,localStats:structuredClone(source.kind==='metrics' ? source.value.stats : source.value.localStatsSnapshot),
      provenance:structuredClone(source.provenance || {})};
  }
  const savedWords=common?.provenance?.promptSnapshot?.customWords;
  // Older M2 snapshots retained the vocabulary but not the input counts.
  // History without either form of evidence must stay unavailable.
  if (typeof savedWords!=='string' && (!fresh || common)) return {analysisInstructions,localStats:null,provenance:{}};
  const customWords=typeof savedWords==='string' ? savedWords : '';
  const analysis=analyzeText(session.transcript.text,{extraFillers:legacyFillers(customWords)});
  const counts=analysis ? analysisCharacterCounts(analysis) : {excludedCharacters:0,hedgeCharacters:0};
  return {analysisInstructions,localStats:analysis ? {fillers:analysis.fillers.length,hedges:analysis.hedges.length,
    vagueWords:analysis.vagueWords.length,totalWords:analysis.totalWords,...counts} : null,
    provenance:{promptSnapshot:{customWords}}};
}

module.exports={buildSessionAnalysisInputs};
