'use strict';
const $=id=>document.getElementById(id);
const audio=$('audio');
let samples=[],state={},activeId='',stage='review',revision=0,datasetKey='',dirty=0,saved=0,saving=false,timer,clipEnd=null;
const format=time=>{const ticks=Math.round(Math.max(0,time||0)*10);return `${String(Math.floor(ticks/600)).padStart(2,'0')}:${((ticks%600)/10).toFixed(1).padStart(4,'0')}`;};
const sample=()=>samples.find(item=>item.id===activeId),row=()=>state[activeId];
const gap=()=>sample().gaps[row().cursor];
const blank=()=>({presence:'',impact:'',boundary:'',note:''});
const judgment=()=>row().judgments[gap().id] || blank();
const {isRecorded,isDecided,summarizeJudgments}=FluencyReviewState;

function status(text,failed=false) {$('save-status').textContent=text;$('save-status').classList.toggle('failed',failed);$('retry-save').hidden=!failed;}
function changed() {dirty++;status('有修改，正在保存…');clearTimeout(timer);timer=setTimeout(flush,250);}
async function flush() {
  clearTimeout(timer);if(saving || saved===dirty)return;saving=true;
  try {
    while(saved<dirty) {
      const target=dirty;
      const response=await fetch('/api/state',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({revision,state})});
      const result=await response.json();if(!response.ok)throw new Error(result.error || '保存失败，请重试');
      revision=result.revision;saved=target;
    }
    status('已保存到本机');
  } catch(error) {status(error.message,true);} finally {saving=false;}
}

function options(id,key,items,scope) {
  const container=$(id);
  if(!container.children.length)for(const [value,label] of items) {
    const button=document.createElement('button');button.className='choice';button.type='button';button.textContent=label;button.dataset.value=value;
    button.addEventListener('click',()=>{
      if(scope==='sample')row()[key]=value;
      else {const item=judgment();item[key]=value;row().judgments[gap().id]=item;}
      changed();render();
    });container.append(button);
  }
  const selected=scope==='sample'?row()[key]:judgment()[key];
  for(const button of container.children)button.setAttribute('aria-pressed',String(button.dataset.value===selected));
}

function stop() {audio.pause();clipEnd=null;}
async function play(start,end=null) {
  stop();audio.currentTime=Math.max(0,start);clipEnd=end;
  try {await audio.play();$('play-status').textContent=end===null?'正在播放原录音。':`正在回放 ${format(start)}—${format(end)}，包含前后语音。`;}
  catch {$('play-status').textContent='暂时无法播放，请再次点击播放或刷新页面。';clipEnd=null;}
}
function replay(padding) {const item=gap();play(Math.max(0,item.start-padding),Math.min(sample().duration,item.end+padding));}

function renderMarkers(id) {
  const container=$(id);container.replaceChildren();
  if(!row().markers.length) {const empty=document.createElement('p');empty.className='empty';empty.textContent='还没有标记。没有听到明显中断，也可以继续核对。';container.append(empty);return;}
  for(const item of [...row().markers].sort((a,b)=>a.time-b.time)) {
    const line=document.createElement('div');line.className='marker-row';
    const listen=document.createElement('button');listen.className='text-button';listen.textContent=`▶ ${format(item.time)} 附近`;listen.addEventListener('click',()=>play(Math.max(0,item.time-2),Math.min(sample().duration,item.time+2)));
    const remove=document.createElement('button');remove.className='text-button remove';remove.textContent='移除标记';remove.setAttribute('aria-label',`移除 ${format(item.time)} 的标记`);
    remove.addEventListener('click',()=>{row().markers=row().markers.filter(mark=>mark.id!==item.id);changed();renderMarkers('markers');renderMarkers('review-markers');});
    line.append(listen,remove);container.append(line);
  }
}

function render() {
  const current=sample(),record=row();
  document.body.dataset.stage=stage;
  $('sample-title').textContent=current.label;$('duration').textContent=`约 ${Math.round(current.duration)} 秒`;
  for(const button of $('samples').children) {
    button.setAttribute('aria-pressed',String(button.dataset.id===activeId));
    const item=samples.find(item=>item.id===button.dataset.id),record=state[item.id];
    const counts=summarizeJudgments(item.gaps,record.judgments);
    button.querySelector('small').textContent=counts.recorded?`已确认 ${counts.decided}/${item.gaps.length}${counts.uncertain?` · 待定 ${counts.uncertain}`:''}`:`${Math.round(item.duration)} 秒 · ${item.gaps.length} 处待核对`;
  }
  $('listen-panel').hidden=stage!=='listen';$('review-panel').hidden=stage!=='review';
  $('step-listen').classList.toggle('active',stage==='listen');$('step-review').classList.toggle('active',stage==='review');
  options('flow-choices','flow',[['smooth','顺畅'],['occasional','偶有中断'],['frequent','经常中断'],['unsure','不确定']],'sample');
  options('speed-choices','speed',[['slow','偏慢'],['suitable','适中'],['fast','偏快'],['unsure','不确定']],'sample');
  if(document.activeElement!==$('overall-note'))$('overall-note').value=record.note;
  renderMarkers('markers');renderMarkers('review-markers');
  if(stage==='review') {
    const item=gap(),counts=summarizeJudgments(current.gaps,record.judgments);
    $('gap-counter').textContent=`第 ${record.cursor+1} 处 / 共 ${current.gaps.length} 处`;
    $('gap-title').textContent=`${format(item.start)}—${format(item.end)}`;
    $('gap-observation').textContent=`检测结果：这段语音间隔约 ${(item.end-item.start).toFixed(2)} 秒。请复听确认是否准确，以及是否影响连贯性。`;
    $('review-progress').textContent=`已确认 ${counts.decided}/${current.gaps.length}${counts.uncertain?` · 待定 ${counts.uncertain}`:''}`;
    const list=$('gap-list');list.replaceChildren();
    current.gaps.forEach((item,index)=>{
      const button=document.createElement('button');button.className='gap-chip';button.textContent=String(index+1);
      button.classList.toggle('done',isDecided(record.judgments[item.id]));button.classList.toggle('uncertain',isRecorded(record.judgments[item.id]) && !isDecided(record.judgments[item.id]));button.setAttribute('aria-current',String(index===record.cursor));
      button.setAttribute('aria-label',`第 ${index+1} 处，${format(item.start)}${isDecided(record.judgments[item.id])?'，已确认':isRecorded(record.judgments[item.id])?'，待定':''}`);
      button.addEventListener('click',()=>{stop();record.cursor=index;changed();render();});list.append(button);
    });
    options('presence-choices','presence',[['yes','确实存在'],['no','不存在'],['unsure','听不准']],'gap');
    options('impact-choices','impact',[['natural','自然停顿'],['disruptive','影响连贯'],['unsure','不确定']],'gap');
    options('boundary-choices','boundary',[['roughly','大致准确'],['adjust','需要调整'],['unsure','不确定']],'gap');
    if(document.activeElement!==$('gap-note'))$('gap-note').value=judgment().note;
    $('previous').disabled=record.cursor===0;
    $('next').disabled=!isRecorded(judgment());$('next').textContent=record.cursor===current.gaps.length-1?'查看本轮记录':'下一处 →';
    $('completion').hidden=!counts.allDecided;
    $('pending-notice').hidden=!(counts.allRecorded && !counts.allDecided);
    $('pending-notice').textContent=`本轮已记录，仍有 ${counts.remaining} 处待确认。可以继续复听，也可以先回到聊天反馈“不确定”的位置。`;
  }
}

function chooseSample(id) {
  stop();activeId=id;stage='review';audio.src=sample().audioUrl;
  $('play-status').textContent='点击“播放这一处”，直接核对检测结果。';$('current-time').textContent='00:00.0';render();
}
function moveNext() {
  stop();if(row().cursor<sample().gaps.length-1){row().cursor++;changed();render();}
  else {
    const pending=sample().gaps.findIndex(item=>!isRecorded(row().judgments[item.id]));
    if(pending>=0){row().cursor=pending;changed();render();$('play-status').textContent='还有未记录的间隔，已回到下一处待核对位置。';}
    else {render();const counts=summarizeJudgments(sample().gaps,row().judgments);$(counts.allDecided?'completion':'pending-notice').scrollIntoView({behavior:'smooth',block:'nearest'});flush();}
  }
}
function mark() {
  if(!Number.isFinite(audio.duration) || row().markers.length>=200)return;
  row().markers.push({id:crypto.randomUUID(),time:Math.min(audio.currentTime,sample().duration)});changed();renderMarkers('markers');renderMarkers('review-markers');
}

audio.addEventListener('timeupdate',()=>{
  $('current-time').textContent=format(audio.currentTime);
  if(clipEnd!==null && audio.currentTime>=clipEnd) {audio.pause();clipEnd=null;$('play-status').textContent='本次片段播放结束，可再听或选择判断。';}
});
audio.addEventListener('error',()=>{$('play-status').textContent='录音加载失败，请刷新页面；已有记录仍保留。';});
$('mark').addEventListener('click',mark);
document.addEventListener('keydown',event=>{if(event.key.toLowerCase()==='m' && stage==='listen' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){event.preventDefault();mark();}});
$('overall-note').addEventListener('input',event=>{row().note=event.target.value;changed();});
$('gap-note').addEventListener('input',event=>{const item=judgment();item.note=event.target.value;row().judgments[gap().id]=item;changed();});
$('enter-review').addEventListener('click',()=>{stop();stage='review';render();});
$('step-listen').addEventListener('click',()=>{stop();stage='listen';render();});
$('step-review').addEventListener('click',()=>{stop();stage='review';render();});
$('play-clip').addEventListener('click',()=>replay(2));
$('more-context').addEventListener('click',()=>replay(5));
$('play-rest').addEventListener('click',()=>play(Math.max(0,gap().start-3)));
$('previous').addEventListener('click',()=>{stop();row().cursor=Math.max(0,row().cursor-1);changed();render();});
$('next').addEventListener('click',moveNext);
$('skip').addEventListener('click',()=>{row().judgments[gap().id]={...judgment(),presence:'unsure',impact:'unsure'};changed();render();moveNext();});
$('retry-save').addEventListener('click',flush);
$('export').addEventListener('click',()=>{
  const content={schemaVersion:1,datasetKey,revision,exportedAt:new Date().toISOString(),sources:samples.map(({id,sessionId,sourceId,reportId,audioSha256,gaps})=>({id,sessionId,sourceId,reportId,audioSha256,gaps})),state};
  const url=URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='fluency-review.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
window.addEventListener('beforeunload',event=>{if(dirty>saved){event.preventDefault();event.returnValue='';}});
fetch('/api/review').then(async response=>{
  if(!response.ok)throw new Error('无法读取本地验收材料');return response.json();
}).then(data=>{
  samples=data.samples;state=data.state;revision=data.revision;datasetKey=data.datasetKey;
  for(const item of samples) {
    const button=document.createElement('button');button.className='sample-option';button.dataset.id=item.id;
    const title=document.createElement('strong');title.textContent=item.label;button.append(title,document.createElement('small'));
    button.addEventListener('click',()=>chooseSample(item.id));$('samples').append(button);
  }
  $('app').hidden=false;chooseSample(samples[0].id);status(data.updatedAt?'已恢复上次记录':'记录会自动保存到本机');
}).catch(error=>{$('fatal').hidden=false;$('fatal').textContent=error.message+'。请刷新重试。';status('读取失败',true);});
