'use strict';
const assert=require('node:assert/strict');

// Real renderer/audio/CSS with a temporary synthetic long recording. The saved
// offline sessions remain unchanged and are reopened by the restart smoke.
async function run({mainWindow,evaluate,wait,click,capture}){
  const originalSize=mainWindow.getSize();
  await evaluate(`(()=>{
    const trainer=window.__trainingProductTrainer,record=trainer.trainingRecords.selected();
    const buffer=new ArrayBuffer(44+16000*120*2),wav=new DataView(buffer);
    const ascii=(offset,value)=>[...value].forEach((char,i)=>wav.setUint8(offset+i,char.charCodeAt(0)));
    ascii(0,'RIFF');wav.setUint32(4,buffer.byteLength-8,true);ascii(8,'WAVE');ascii(12,'fmt ');
    wav.setUint32(16,16,true);wav.setUint16(20,1,true);wav.setUint16(22,1,true);wav.setUint32(24,16000,true);
    wav.setUint32(28,32000,true);wav.setUint16(32,2,true);wav.setUint16(34,16,true);ascii(36,'data');wav.setUint32(40,buffer.byteLength-44,true);
    const url=URL.createObjectURL(new Blob([buffer],{type:'audio/wav'}));
    window.__playbackSmoke={record,original:{audioUrl:record.audioUrl,segments:record.segments,fullText:record.fullText,durationMs:record.durationMs},url,theme:document.documentElement.dataset.theme};
    record.audioUrl=url;record.durationMs=120000;
    record.segments=Array.from({length:48},(_,i)=>({id:'playback-smoke-'+i,startMs:i*2000,endMs:(i+1)*2000,timingSource:'estimated',text:'这是第 '+(i+1)+' 段合成转写，用于核对紧凑排版、播放定位和长文阅读，不用于表达质量评估。'}));
    record.fullText=record.segments.map(segment=>segment.text).join('');
    trainer.refreshPlaybackControls();document.getElementById('report-materials').open=true;
  })()`);
  try{
    await wait('synthetic WAV metadata',`document.getElementById('recording-player').duration===120`);
    await click('#playback-forward');
    assert.equal(await evaluate(`document.getElementById('recording-player').currentTime`),5);
    assert.equal(await evaluate(`document.getElementById('recording-player').paused`),true);
    await click('#playback-backward');assert.equal(await evaluate(`document.getElementById('recording-player').currentTime`),0);
    await evaluate(`(()=>{const seek=document.getElementById('playback-seek');seek.value=60;seek.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait('saved segment selected at 60 seconds',`document.querySelector('.playback-segment.is-current')?.dataset.segmentId==='playback-smoke-30'`);
    await click('#playback-toggle');await wait('native audio advances',`document.getElementById('recording-player').currentTime>60.2`);
    await wait('current line followed into view',`(()=>{const row=document.querySelector('.playback-segment.is-current').getBoundingClientRect(),toolbar=document.getElementById('report-audio').getBoundingClientRect(),region=document.getElementById('report-scroll').getBoundingClientRect();return row.top>=toolbar.bottom-1&&row.bottom<=region.bottom;})()`);
    const wheel=await evaluate(`(()=>{const r=document.getElementById('report-scroll').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.bottom-60)};})()`);
    mainWindow.webContents.sendInputEvent({type:'mouseWheel',...wheel,deltaX:0,deltaY:160});
    await wait('reading pauses follow',`!document.getElementById('playback-follow').checked&&!document.getElementById('playback-return').hidden`);
    await click('#playback-return');
    await wait('return restores follow',`document.getElementById('playback-follow').checked`);
    const returned=await evaluate(`({open:document.getElementById('report-materials').open,follow:document.getElementById('playback-follow').checked,hidden:document.getElementById('playback-return').hidden,active:document.activeElement.id})`);
    assert.equal(returned.open&&returned.follow,true,'return action state: '+JSON.stringify(returned));
    await click('#playback-toggle');await wait('native audio paused',`document.getElementById('recording-player').paused`);
    await click('#playback-follow');
    assert.equal(await evaluate(`document.getElementById('report-materials').open&&!document.getElementById('playback-follow').checked`),true,'switch toggles without collapsing the disclosure');
    const position=await evaluate(`document.getElementById('recording-player').currentTime`);
    await click('#playback-return');
    await wait('paused return restores follow',`document.getElementById('playback-follow').checked`);
    assert.equal(await evaluate(`document.getElementById('recording-player').currentTime`),position);
    assert.equal(await evaluate(`document.getElementById('recording-player').paused`),true);
    assert.equal(await evaluate(`document.activeElement.id`),'playback-follow','hidden return action retains keyboard navigation');
    await evaluate(`document.getElementById('playback-follow').focus()`);
    mainWindow.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});mainWindow.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});
    await wait('keyboard switch off',`!document.getElementById('playback-follow').checked`);
    assert.equal(await evaluate(`document.getElementById('recording-player').paused&&document.getElementById('report-materials').open`),true);
    await click('.playback-follow-label span');
    await wait('label text enables follow',`document.getElementById('playback-follow').checked`);
    assert.equal(await evaluate(`document.getElementById('report-materials').open`),true,'label text never collapses the disclosure');
    await click('#playback-follow');
    await wait('switch off for layout checks',`!document.getElementById('playback-follow').checked`);
    await evaluate('document.fonts.ready');
    for(const width of [960,1280,1440]){
      mainWindow.setContentSize(width,800);
      await wait('playback viewport resize',`innerWidth===${width}`);
      for(const theme of ['graphite','coral-glow','ink-night','frosted-mist']){
        await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.getElementById('report-scroll').scrollTop=document.getElementById('report-scroll').scrollHeight/2`);
        const layout=await evaluate(`(()=>{
          const region=document.getElementById('report-scroll'),toolbar=document.getElementById('report-audio'),heading=document.getElementById('report-materials-heading'),seek=document.getElementById('playback-seek'),actions=document.querySelector('.playback-actions');
          const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height};};
          return {viewport:innerWidth,page:document.documentElement.scrollWidth,region:rect(region),toolbar:rect(toolbar),heading:rect(heading),rail:rect(seek),actions:rect(actions),
            fits:[...document.querySelectorAll('.playback-actions button,.playback-actions input,.playback-actions select,#playback-return,.playback-follow-label')].every(node=>{const r=node.getBoundingClientRect(),p=region.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right;}),
            surface:getComputedStyle(toolbar).backgroundColor,headerSurface:getComputedStyle(heading).backgroundColor};
        })()`);
        assert.ok(layout.page<=layout.viewport&&layout.fits,theme+' controls fit '+width);
        assert.ok(Math.abs(layout.heading.top-layout.region.top)<2,'material title stays pinned');
        assert.ok(Math.abs(layout.toolbar.top-layout.heading.bottom)<2,'player stays below its title');
        assert.equal(layout.surface,layout.headerSurface,'sticky surfaces share the project theme');
        assert.ok(!['transparent','rgba(0, 0, 0, 0)'].includes(layout.surface));
        assert.ok(layout.actions.left>=layout.rail.right-1||layout.actions.top>=layout.rail.bottom-1,'controls remain on the right or wrap as a group');
        assert.ok(Math.abs(layout.actions.right-layout.toolbar.right)<2,'control group stays right aligned');
        if(width===1280)await capture('playback-'+theme);
      }
    }
    await evaluate(`document.getElementById('report-materials').open=false`);
    assert.equal(await evaluate(`document.getElementById('playback-player').checkVisibility()`),false,'collapsed player is not painted or interactive');
    assert.ok(await evaluate(`document.getElementById('report-materials').getBoundingClientRect().height<80`),'collapsed disclosure occupies only its heading');
  }catch(error){await capture('playback-failure');throw error;}finally{
    await evaluate(`(()=>{const state=window.__playbackSmoke;document.getElementById('recording-player').pause();Object.assign(state.record,state.original);window.__trainingProductTrainer.refreshPlaybackControls();URL.revokeObjectURL(state.url);if(state.theme)document.documentElement.dataset.theme=state.theme;else delete document.documentElement.dataset.theme;delete window.__playbackSmoke;})()`);
    mainWindow.setSize(...originalSize);
  }
}
module.exports={run};
