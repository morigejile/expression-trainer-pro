(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ReportPlayback=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  function clock(seconds){
    if(!Number.isFinite(seconds)||seconds<0)return '—';
    const total=Math.floor(seconds),pad=value=>String(value).padStart(2,'0');
    return total>=3600?`${pad(Math.floor(total/3600))}:${pad(Math.floor(total/60)%60)}:${pad(total%60)}`:`${pad(Math.floor(total/60))}:${pad(total%60)}`;
  }
  function createReportPlayback({document,audio,onSelect,renderText=(node,text)=>{node.textContent=text;}}){
    const get=id=>document.getElementById(id),player=get('playback-player');if(!player)return null;
    const toggle=get('playback-toggle'),seek=get('playback-seek'),current=get('playback-current-time'),duration=get('playback-duration'),
      volume=get('playback-volume'),mute=get('playback-mute'),speed=get('playback-speed'),audioStatus=get('playback-audio-status'),
      transcript=get('playback-segments');
    let record=null,recordKey=null,segments=null,selectedId=null,currentId=null,playError='',lastVolume=1,scrubbing=false;
    const rows=new Map(),available=()=>Boolean(record?.audioUrl&&!['missing','corrupt'].includes(record.audioState));
    audio.controls=false;audio.hidden=true;
    const node=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
    function updateRows(){
      for(const [id,row]of rows){const selected=id===selectedId,position=id===currentId;
        row.button.setAttribute('aria-pressed',String(selected));row.root.classList.toggle('is-current',position);
        row.position.textContent=position?(audio.paused?'播放位置':'正在播放'):'';
      }
    }
    function syncMedia(){
      const usable=available()&&!audio.error,total=Number.isFinite(audio.duration)&&audio.duration>0?audio.duration:0,time=Number.isFinite(audio.currentTime)?audio.currentTime:0;
      player.hidden=!usable;toggle.disabled=!usable;toggle.setAttribute('aria-label',!audio.paused?'暂停回放':audio.ended?'重新播放录音':'播放录音');
      toggle.setAttribute('aria-pressed',String(!audio.paused));toggle.dataset.playing=String(!audio.paused);
      current.textContent=clock(time);duration.textContent=total?clock(total):'—';seek.disabled=!usable||!total;seek.max=String(total||1);if(!scrubbing)seek.value=String(Math.min(time,total||0));
      seek.style.setProperty('--playback-progress',`${total?Math.min(100,time/total*100):0}%`);seek.setAttribute('aria-valuetext',`${clock(time)}，共 ${total?clock(total):'时长加载中'}`);
      volume.value=String(audio.volume);mute.setAttribute('aria-pressed',String(audio.muted||audio.volume===0));mute.setAttribute('aria-label',audio.muted||audio.volume===0?'取消静音':'静音');speed.value=String(audio.playbackRate);
      audioStatus.textContent=!available()?(record?.audioState==='corrupt'?'录音已损坏，无法回放。':'录音缺失，无法回放。'):audio.error?'录音无法加载或已损坏，无法回放。':playError||(audio.readyState===0?'录音加载中…':'');
      updateRows();
    }
    toggle.addEventListener('click',()=>{
      if(!available()||audio.error)return;
      if(!audio.paused){audio.pause();return;}
      if(audio.ended)audio.currentTime=0;
      const key=recordKey;playError='';
      try{audio.play()?.catch(()=>{if(recordKey===key){playError='录音播放失败，请重试。';syncMedia();}});}catch{playError='录音播放失败，请重试。';syncMedia();}
    });
    seek.addEventListener('input',()=>{if(available()&&Number.isFinite(audio.duration)&&audio.duration>0){audio.currentTime=Math.max(0,Math.min(audio.duration,Number(seek.value)||0));}});
    seek.addEventListener('pointerdown',()=>{scrubbing=true;});
    for(const event of ['pointerup','pointercancel','blur'])seek.addEventListener(event,()=>{scrubbing=false;syncMedia();});
    mute.addEventListener('click',()=>{if(audio.muted||audio.volume===0){audio.muted=false;if(audio.volume===0)audio.volume=lastVolume;}else{lastVolume=audio.volume;audio.muted=true;}});
    volume.addEventListener('input',()=>{audio.volume=Math.max(0,Math.min(1,Number(volume.value)||0));if(audio.volume>0){audio.muted=false;lastVolume=audio.volume;}});
    speed.addEventListener('change',()=>{const rate=Number(speed.value);if(rate>=.25&&rate<=2)audio.playbackRate=rate;});
    for(const event of ['loadedmetadata','durationchange','timeupdate','seeked','play','pause','ended','volumechange','ratechange','emptied'])audio.addEventListener(event,syncMedia);
    audio.addEventListener('error',()=>{syncMedia();});
    audio.addEventListener('waiting',()=>{playError='录音加载中…';syncMedia();});
    audio.addEventListener('canplay',()=>{playError='';syncMedia();});
    function selectSegment(id){if(!rows.has(id))return false;selectedId=id;updateRows();return true;}
    function setCurrentSegment(id){currentId=id;if(rows.has(id))selectedId=id;updateRows();}
    function setRecord(next){
      const key=`${next?.id||''}:${next?.audioUrl||''}`,changed=key!==recordKey;
      if(changed){playError='';scrubbing=false;recordKey=key;currentId=null;selectedId=null;}
      const rebuild=changed||segments!==next?.segments;record=next;
      if(rebuild){
        segments=next?.segments;rows.clear();transcript.replaceChildren();
        for(const segment of segments||[]){
          const root=node('div','playback-segment'),button=node('button','playback-segment-button'),time=node('span','playback-segment-time',clock(Number.isFinite(segment.startMs)?segment.startMs/1000:NaN)),text=node('span','playback-segment-text'),position=node('span','playback-position');
          root.dataset.segmentId=segment.id;button.type='button';button.setAttribute('aria-label',`查看${Number.isFinite(segment.startMs)?clock(segment.startMs/1000)+'开始的':''}片段`);renderText(text,segment.text||'');button.append(time,text,position);root.append(button);transcript.append(root);rows.set(segment.id,{root,button,position});
          button.addEventListener('click',()=>{selectSegment(segment.id);onSelect?.(segment.id);});
        }
        if(!rows.size&&next?.fullText)transcript.append(node('p','playback-plain-transcript',next.fullText));
        selectedId=rows.has(selectedId)?selectedId:(rows.keys().next().value||null);
      }
      syncMedia();updateRows();
    }
    return {setRecord,setCurrentSegment,selectSegment,syncMedia};
  }
  return {createReportPlayback,clock};
});
