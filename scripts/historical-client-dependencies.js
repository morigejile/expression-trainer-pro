'use strict';

// Frozen transports import these retired modules at load time. Historical
// probes exercise structured diagnosis only; no legacy generation is restored.
function retired() {throw new Error('Historical client loaders support structured diagnosis only');}
module.exports={
  './prompts':{getRealtimePrompt:retired,getReportPrompt:retired,getPlaybackAnalysisPrompt:retired},
  './playback-analysis':{parsePlaybackAnalysisResponse:retired}
};
