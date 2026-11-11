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
      transcript=get('playback-segments'),backward=get('playback-backward'),forward=get('playback-forward'),
      followControls=get('playback-follow-controls'),followSwitch=get('playback-follow'),returnButton=get('playback-return'),
      scrollRegion=get('report-scroll'),materials=get('report-materials');
    let record=null,recordKey=null,segments=null,selectedId=null,currentId=null,playError='',lastVolume=1,scrubbing=false,following=true;
    let rangeEnd=null,playRequest=0;
    const rows=new Map(),available=()=>Boolean(record?.audioUrl&&!['missing','corrupt'].includes(record.audioState));
    audio.controls=false;audio.hidden=true;
    const node=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
    function updateRows(){
      for(const [id,row]of rows){const selected=id===selectedId,position=id===currentId;
        row.button.setAttribute('aria-pressed',String(selected));row.button.setAttribute('aria-current',String(position));row.root.classList.toggle('is-current',position);
        row.position.textContent=position?(audio.paused?'已定位':'播放中'):'';
      }
    }
    function syncFollow(){
      const usable=available()&&!audio.error&&(segments||[]).some(segment=>Number.isFinite(segment.startMs));
      if(followControls)followControls.hidden=!usable;
      if(followSwitch)followSwitch.checked=following;
      if(returnButton){returnButton.hidden=following||!usable;returnButton.disabled=!usable||!rows.has(currentId);}
    }
    function revealCurrent(force=false){
      if(!following||(!force&&(audio.paused||rangeEnd!==null))||!available()||audio.error||!materials?.open||!scrollRegion?.clientHeight||document.body?.dataset?.frozenUi!=='report')return;
      const row=rows.get(currentId)?.button;if(!row)return;
      const viewport=scrollRegion.getBoundingClientRect(),bounds=row.getBoundingClientRect();
      const heading=get('report-materials-heading')?.getBoundingClientRect().height||0,toolbar=get('report-audio')?.getBoundingClientRect().height||0;
      const visibleTop=viewport.top+heading+toolbar+12;
      if(bounds.top>=visibleTop&&bounds.bottom<=viewport.bottom-12)return;
      const reduced=document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      scrollRegion.scrollTo({top:Math.max(0,scrollRegion.scrollTop+bounds.top-visibleTop),behavior:reduced?'instant':'smooth'});
    }
    function setFollowing(value){following=value;syncFollow();}
    function clipTranscript(){
      const surface=get('report-transcript');if(!surface)return;
      let inset=0;
      if(materials?.open&&document.body?.dataset?.frozenUi==='report'&&scrollRegion?.clientHeight){
        const bounds=surface.getBoundingClientRect(),heading=get('report-materials-heading')?.getBoundingClientRect(),toolbar=get('report-audio')?.getBoundingClientRect();
        inset=Math.max(0,Math.min(bounds.height,Math.max(heading?.bottom||0,toolbar?.bottom||0)-bounds.top));
      }
      surface.style.setProperty('--playback-transcript-clip',`${inset}px`);
    }
    function pauseFollow(event){
      if(audio.paused||event.target?.closest?.('#playback-controls, #playback-follow-controls, input, select'))return;
      setFollowing(false);
    }
    function syncMedia(){
      const usable=available()&&!audio.error,total=Number.isFinite(audio.duration)&&audio.duration>0?audio.duration:0,time=Number.isFinite(audio.currentTime)?audio.currentTime:0;
      player.hidden=!usable;toggle.disabled=!usable;toggle.setAttribute('aria-label',!audio.paused?'暂停回放':audio.ended?'重新播放录音':'播放录音');
      toggle.setAttribute('aria-pressed',String(!audio.paused));toggle.dataset.playing=String(!audio.paused);
      current.textContent=clock(time);duration.textContent=total?clock(total):'—';seek.disabled=!usable||!total;seek.max=String(total||1);if(!scrubbing)seek.value=String(Math.min(time,total||0));
      for(const button of [backward,forward])if(button)button.disabled=!usable||!total;
      seek.style.setProperty('--playback-progress',`${total?Math.min(100,time/total*100):0}%`);seek.setAttribute('aria-valuetext',`${clock(time)}，共 ${total?clock(total):'时长加载中'}`);
      volume.value=String(audio.volume);mute.setAttribute('aria-pressed',String(audio.muted||audio.volume===0));mute.setAttribute('aria-label',audio.muted||audio.volume===0?'取消静音':'静音');speed.value=String(audio.playbackRate);
      audioStatus.textContent=!available()?(record?.audioState==='corrupt'?'录音已损坏，无法回放。':'录音缺失，无法回放。'):audio.error?'录音无法加载或已损坏，无法回放。':playError||(audio.readyState===0?'录音加载中…':'');
      updateRows();syncFollow();clipTranscript();
    }
    function clearRange() { rangeEnd=null; }
    function play() {
      const key=recordKey;
      const request=++playRequest;
      playError='';
      const failed=()=>{
        if (recordKey!==key || request!==playRequest) return;
        clearRange();
        playError='录音播放失败，请重试。';
        syncMedia();
      };
      try { audio.play()?.catch(failed); }
      catch { failed(); }
    }
    function playRange(start,end) {
      if (!available() || audio.error || !Number.isFinite(start) || !Number.isFinite(end) || start<0) return false;
      const limit=Number.isFinite(audio.duration)?Math.min(audio.duration,end):end;
      if (start>=limit) return false;
      audio.currentTime=start;
      rangeEnd=limit;
      play();
      return true;
    }
    toggle.addEventListener('click',()=>{
      if(!available()||audio.error)return;
      clearRange();
      if(!audio.paused){audio.pause();return;}
      if(audio.ended)audio.currentTime=0;
      play();
    });
    seek.addEventListener('input',()=>{if(available()&&Number.isFinite(audio.duration)&&audio.duration>0){clearRange();audio.currentTime=Math.max(0,Math.min(audio.duration,Number(seek.value)||0));}});
    seek.addEventListener('pointerdown',()=>{scrubbing=true;});
    for(const event of ['pointerup','pointercancel','blur'])seek.addEventListener(event,()=>{scrubbing=false;syncMedia();});
    mute.addEventListener('click',()=>{if(audio.muted||audio.volume===0){audio.muted=false;if(audio.volume===0)audio.volume=lastVolume;}else{lastVolume=audio.volume;audio.muted=true;}});
    volume.addEventListener('input',()=>{audio.volume=Math.max(0,Math.min(1,Number(volume.value)||0));if(audio.volume>0){audio.muted=false;lastVolume=audio.volume;}});
    speed.addEventListener('change',()=>{const rate=Number(speed.value);if(rate>=.25&&rate<=2)audio.playbackRate=rate;});
    function jumpBy(seconds){
      if(!available()||audio.error||!Number.isFinite(audio.duration)||audio.duration<=0)return;
      clearRange();
      audio.currentTime=Math.max(0,Math.min(audio.duration,(Number(audio.currentTime)||0)+seconds));syncMedia();
    }
    backward?.addEventListener('click',()=>jumpBy(-5));forward?.addEventListener('click',()=>jumpBy(5));
    followSwitch?.addEventListener('change',()=>{setFollowing(followSwitch.checked);if(following)revealCurrent(true);});
    returnButton?.addEventListener('click',()=>{const restoreFocus=document.activeElement===returnButton;setFollowing(true);revealCurrent(true);if(restoreFocus)followSwitch?.focus();});
    scrollRegion?.addEventListener('wheel',pauseFollow,{passive:true});
    scrollRegion?.addEventListener('touchmove',pauseFollow,{passive:true});
    scrollRegion?.addEventListener('pointerdown',event=>{if(event.target===scrollRegion)pauseFollow(event);});
    scrollRegion?.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End'].includes(event.key))pauseFollow(event);});
    scrollRegion?.addEventListener('scroll',clipTranscript,{passive:true});
    materials?.addEventListener('toggle',clipTranscript);
    const ResizeObserver=document.defaultView?.ResizeObserver;
    if(ResizeObserver){const observer=new ResizeObserver(clipTranscript);for(const element of [scrollRegion,get('report-audio'),get('report-materials-heading')])if(element)observer.observe(element);}
    audio.addEventListener('timeupdate',()=>{
      if(rangeEnd!==null && audio.currentTime>=rangeEnd){
        clearRange();
        audio.pause();
      }
      syncMedia();
    });
    for(const event of ['loadedmetadata','durationchange','seeked','play','pause','ended','volumechange','ratechange','emptied'])audio.addEventListener(event,syncMedia);
    audio.addEventListener('ended',clearRange);
    audio.addEventListener('error',()=>{clearRange();syncMedia();});
    audio.addEventListener('waiting',()=>{playError='录音加载中…';syncMedia();});
    audio.addEventListener('canplay',()=>{playError='';syncMedia();});
    audio.addEventListener('play',()=>revealCurrent());
    function selectSegment(id){if(!rows.has(id))return false;selectedId=id;updateRows();return true;}
    function setCurrentSegment(id){currentId=id;if(rows.has(id))selectedId=id;updateRows();syncFollow();revealCurrent();}
    function setRecord(next){
      const key=`${next?.id||''}:${next?.audioUrl||''}`,changed=key!==recordKey;
      if(changed){clearRange();playError='';scrubbing=false;if(record?.id!==next?.id)following=true;recordKey=key;currentId=null;selectedId=null;}
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
    return {setRecord,setCurrentSegment,selectSegment,syncMedia,playRange,clearRange};
  }
  return {createReportPlayback,clock};
});
