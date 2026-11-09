'use strict';
(function(root){
  const isRecorded=item=>Boolean(item?.presence && item?.impact);
  const isDecided=item=>Boolean(item && ['yes','no'].includes(item.presence) && ['natural','disruptive'].includes(item.impact));
  function summarizeJudgments(gaps,judgments) {
    const recorded=gaps.filter(gap=>isRecorded(judgments[gap.id])).length;
    const decided=gaps.filter(gap=>isDecided(judgments[gap.id])).length;
    return {recorded,decided,uncertain:recorded-decided,remaining:gaps.length-decided,
      allRecorded:recorded===gaps.length,allDecided:decided===gaps.length};
  }
  const api={isRecorded,isDecided,summarizeJudgments};
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.FluencyReviewState=api;
})(globalThis);
