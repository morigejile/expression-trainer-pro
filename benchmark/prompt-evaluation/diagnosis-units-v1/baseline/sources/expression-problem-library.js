'use strict';
const library=require('./expression-problem-library.generated.json');
const cards=Object.freeze(library.cards.map(card=>Object.freeze(card)));
const PROBLEM_LIBRARY_VERSION=library.version;

function selectProblemCards(context){
  const selected=context.analysisTarget?.framework||context.trainingContext?.framework||null;
  const local=['sentence','segment'].includes(context.practiceComparison?.scope);
  const durationAvailable=context.metrics?.some(x=>x.metricId==='audio-duration-ms'&&x.status==='available');
  return {
    common:cards.filter(x=>!x.framework&&x.usage==='可检查'&&(x.id!=='ORG-09'||durationAvailable)),
    framework:local?[]:cards.filter(x=>x.framework===selected&&x.framework!==null&&x.usage==='可检查'),
    unavailable:cards.filter(x=>x.usage!=='可检查')
  };
}
function renderCards(values){
  return values.map(x=>`[${x.id} ${x.title} | ${x.category}]\n适用：${x.applicability}\n检查：${x.question}\n不判：${x.exclusions}\n证据与边界：${x.evidence}`).join('\n\n');
}
function getProblemLibraryPrompt(context){
  const selected=selectProblemCards(context);
  return {version:PROBLEM_LIBRARY_VERSION,
    commonRules:[library.rules.taskGate,library.rules.common,library.rules.merge,library.rules.advice].join('\n\n'),
    commonCards:renderCards(selected.common),frameworkCards:renderCards(selected.framework),
    mergeExamples:library.rules.mergeExamples,evidenceRules:library.rules.evidence};
}
module.exports={PROBLEM_LIBRARY_VERSION,cards,selectProblemCards,getProblemLibraryPrompt};
