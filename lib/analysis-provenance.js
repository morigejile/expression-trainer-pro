'use strict';

function analysisProvenance(profile, customPrompt, promptVersion) {
  const fields = promptVersion === 'report-v1' ? ['goals','styleRef','customWords'] : ['goals','customRules','styleRef'];
  return {provider:profile?.provider || null,model:profile?.model || null,profileId:profile?.id || null,
    promptVersion,promptSnapshot:Object.fromEntries(fields.map(field => [field,customPrompt[field]]))};
}

module.exports = {analysisProvenance};
