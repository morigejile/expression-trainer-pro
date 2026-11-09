'use strict';
const {validateSessionCommand}=require('./asr-ipc');

function createAsrRecordingScheduler({getWebContents}) {
  let active=null;
  function restore() {
    const previous=active;active=null;
    if(previous && !previous.contents.isDestroyed()) {
      previous.contents.setBackgroundThrottling(previous.throttling);
    }
  }
  return {
    started(sessionId,contents=getWebContents()) {
      if(typeof sessionId!=='string' || !sessionId.trim())return;
      if(!contents || contents!==getWebContents() || contents.isDestroyed())return;
      if(active?.contents!==contents) {
        restore();
        active={contents,throttling:contents.getBackgroundThrottling(),sessionId};
      }else active.sessionId=sessionId;
      // Worklet audio remains real-time while hidden. Throttling its consumer
      // turns that stream into bursts before the unchanged bounded ASR queue.
      contents.setBackgroundThrottling(false);
    },
    finished(command) {
      const validated=validateSessionCommand(command);
      if(validated && active?.sessionId===validated.sessionId)restore();
    }
  };
}
module.exports={createAsrRecordingScheduler};
