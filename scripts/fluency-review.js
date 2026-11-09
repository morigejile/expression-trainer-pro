'use strict';

// Local acceptance utility. Reads exported, pinned evidence; never opens the
// training database or runs ASR/VAD/AI. Annotations have their own output file.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {createHash,randomUUID}=require('node:crypto');
const {parseArgs}=require('node:util');

const hash=value=>createHash('sha256').update(value).digest('hex');
const choices={flow:['','smooth','occasional','frequent','unsure'],speed:['','slow','suitable','fast','unsure'],
  presence:['','yes','no','unsure'],impact:['','natural','disruptive','unsure'],boundary:['','roughly','adjust','unsure']};
function validateState(state,samples) {
  const object=value=>value && typeof value==='object' && !Array.isArray(value);
  const text=value=>typeof value==='string' && value.length<=2000;
  const choice=(key,value)=>choices[key].includes(value);
  if(!object(state) || Object.keys(state).length!==samples.length) throw new Error('验收记录格式不正确');
  for(const sample of samples) {
    const row=state[sample.id];
    if(!object(row) || Object.keys(row).some(key=>!['blindComplete','flow','speed','note','markers','judgments','cursor'].includes(key)) ||
      typeof row.blindComplete!=='boolean' || !choice('flow',row.flow) || !choice('speed',row.speed) || !text(row.note) ||
      !Number.isInteger(row.cursor) || row.cursor<0 || row.cursor>=Math.max(1,sample.gaps.length) ||
      !Array.isArray(row.markers) || row.markers.length>200 || !object(row.judgments)) throw new Error('验收记录格式不正确');
    const ids=new Set();
    for(const mark of row.markers) {
      if(!object(mark) || Object.keys(mark).some(key=>!['id','time'].includes(key)) ||
        typeof mark.id!=='string' || !/^[a-zA-Z0-9-]{1,64}$/.test(mark.id) || ids.has(mark.id) ||
        !Number.isFinite(mark.time) || mark.time<0 || mark.time>sample.duration) throw new Error('标记时间不正确');
      ids.add(mark.id);
    }
    for(const [id,item] of Object.entries(row.judgments)) {
      if(!sample.gaps.some(gap=>gap.id===id) || !object(item) ||
        Object.keys(item).some(key=>!['presence','impact','boundary','note'].includes(key)) ||
        !choice('presence',item.presence) || !choice('impact',item.impact) || !choice('boundary',item.boundary) || !text(item.note)) {
        throw new Error('间隔判断不正确');
      }
    }
  }
}

function createReviewServer({samples,stateFile}) {
  if(!Array.isArray(samples) || !samples.length || new Set(samples.map(row=>row.id)).size!==samples.length ||
    samples.some(row=>!/^\w+$/.test(row.id) || !Number.isFinite(row.duration) || row.duration<=0 ||
      !Array.isArray(row.gaps) || new Set(row.gaps.map(gap=>gap.id)).size!==row.gaps.length ||
      row.gaps.some(gap=>!/^gap-\d+$/.test(gap.id) || !Number.isFinite(gap.start) ||
        !Number.isFinite(gap.end) || gap.start<0 || gap.end<=gap.start || gap.end>row.duration))) throw new Error('录音数据不正确');
  const bindings=samples.map(({id,duration,sessionId,sourceId,reportId,audioSha256,gaps})=>({id,duration,sessionId,sourceId,reportId,audioSha256,gaps}));
  const datasetKey=hash(JSON.stringify(bindings));
  let document={schemaVersion:1,datasetKey,revision:0,updatedAt:null,sources:bindings,
    state:Object.fromEntries(samples.map(row=>[row.id,{blindComplete:false,flow:'',speed:'',note:'',markers:[],judgments:{},cursor:0}]))};
  function restoreDocument() {if(fs.existsSync(stateFile)) {
    try {
      const saved=JSON.parse(fs.readFileSync(stateFile,'utf8'));
      if(saved.datasetKey!==datasetKey) throw new Error('录音来源已改变，请使用新的记录文件');
      if(saved.schemaVersion!==1 || !Number.isSafeInteger(saved.revision) || saved.revision<0) throw new Error('已有记录版本不支持');
      validateState(saved.state,samples);document={...document,revision:saved.revision,updatedAt:saved.updatedAt,state:saved.state};
    } catch(error) {throw new Error(`无法读取已有记录：${error.message}`);}
  }}
  restoreDocument();
  // One state file has one owning service, including across processes. A
  // leftover lock is never removed speculatively after an abnormal shutdown.
  fs.mkdirSync(path.dirname(stateFile),{recursive:true});
  const lockFile=stateFile+'.lock',lockToken=randomUUID();
  let lockHandle;
  try {
    lockHandle=fs.openSync(lockFile,'wx');
    fs.writeFileSync(lockHandle,JSON.stringify({pid:process.pid,token:lockToken}));
  } catch(error) {
    if(error.code==='EEXIST')throw new Error('此记录文件已由另一个验收服务使用，请复用原页面；若服务异常退出，请先确认旧进程结束再清理残留 .lock');
    if(lockHandle!==undefined){try{fs.unlinkSync(lockFile);}catch{}}
    throw error;
  } finally {if(lockHandle!==undefined)fs.closeSync(lockHandle);}
  function releaseLock() {
    try {if(JSON.parse(fs.readFileSync(lockFile,'utf8')).token===lockToken)fs.unlinkSync(lockFile);}catch{}
    process.removeListener('exit',releaseLock);
  }
  // A previous owner may have finished between our first read and lock
  // acquisition. Reload while owning the lock before accepting any writes.
  try {restoreDocument();}catch(error){releaseLock();throw error;}
  const assets={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],
    '/style.css':['style.css','text/css; charset=utf-8'],'/review-state.js':['review-state.js','text/javascript; charset=utf-8']};
  function json(res,status,value,headers={}) {res.writeHead(status,{'content-type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(value));}
  const server=http.createServer(async(req,res)=>{
    res.setHeader('cache-control','no-store');
    res.setHeader('x-content-type-options','nosniff');
    res.setHeader('cross-origin-resource-policy','same-origin');
    res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'");
    const expectedHost=`127.0.0.1:${server.address().port}`;
    if(req.headers.host!==expectedHost) return json(res,403,{error:'请使用本机验收地址'});
    const pathname=new URL(req.url,`http://${expectedHost}`).pathname;
    try {
      if(req.method==='GET' && pathname==='/api/review') {
        return json(res,200,{samples:samples.map(({audioPath,...sample})=>({...sample,audioUrl:`/audio/${sample.id}`})),
          datasetKey,revision:document.revision,state:document.state,updatedAt:document.updatedAt});
      }
      if(req.method==='GET' && pathname==='/api/export') return json(res,200,document,{'content-disposition':'attachment; filename="fluency-review.json"'});
      if(req.method==='PUT' && pathname==='/api/state') {
        if(req.headers.origin!==`http://${expectedHost}`) return json(res,403,{error:'保存请求来源不正确'});
        const chunks=[];let size=0;
        for await(const chunk of req) {size+=chunk.length;if(size>1024*1024)return json(res,413,{error:'记录内容过大'});chunks.push(chunk);}
        let input;
        try {input=JSON.parse(Buffer.concat(chunks).toString('utf8'));validateState(input.state,samples);}
        catch {return json(res,400,{error:'记录内容不正确，尚未保存'});}
        if(input.revision!==document.revision) return json(res,409,{error:'另一页面已更新记录，请导出当前草稿后刷新'});
        const next={...document,state:input.state,revision:document.revision+1,updatedAt:new Date().toISOString()};
        fs.mkdirSync(path.dirname(stateFile),{recursive:true});
        const temporary=stateFile+'.'+randomUUID()+'.tmp';
        try {fs.writeFileSync(temporary,JSON.stringify(next,null,2)+'\n',{flag:'wx'});fs.renameSync(temporary,stateFile);}
        catch(error) {try{fs.unlinkSync(temporary);}catch{}throw error;}
        document=next;
        return json(res,200,{revision:document.revision,updatedAt:document.updatedAt});
      }
      if(['GET','HEAD'].includes(req.method) && pathname.startsWith('/audio/')) {
        const sample=samples.find(row=>pathname===`/audio/${row.id}`);
        if(!sample)return json(res,404,{error:'找不到录音'});
        const size=fs.statSync(sample.audioPath).size;
        let start=0,end=size-1,status=200;
        if(req.headers.range) {
          const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          if(!range || (!range[1] && !range[2]))return json(res,416,{error:'时间范围不正确'},{'content-range':`bytes */${size}`});
          if(range[1]) {start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end;}
          else start=Math.max(0,size-Number(range[2]));
          if(start>end || start>=size)return json(res,416,{error:'时间范围不正确'},{'content-range':`bytes */${size}`});
          status=206;res.setHeader('content-range',`bytes ${start}-${end}/${size}`);
        }
        res.writeHead(status,{'content-type':'audio/wav','accept-ranges':'bytes','content-length':end-start+1});
        if(req.method==='HEAD')return res.end();
        const stream=fs.createReadStream(sample.audioPath,{start,end});
        stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());return stream.pipe(res);
      }
      if(req.method==='GET' && Object.hasOwn(assets,pathname)) {
        const [file,type]=assets[pathname];res.writeHead(200,{'content-type':type});return res.end(fs.readFileSync(path.join(__dirname,'fluency-review',file)));
      }
      return json(res,404,{error:'找不到页面'});
    } catch {if(!res.headersSent)json(res,500,{error:'本地读取或保存失败，修改仍留在页面，请重试或导出草稿'});else res.destroy();}
  });
  server.once('close',releaseLock);server.once('error',releaseLock);process.once('exit',releaseLock);
  return server;
}

function loadSamples(root) {
  const entries=fs.readdirSync(root,{withFileTypes:true}).filter(entry=>entry.isDirectory());
  const samples=[];
  for(const entry of entries) {
    const folder=path.join(root,entry.name),file=fs.readdirSync(folder).find(name=>name.endsWith('.json'));
    if(!file)continue;
    const data=JSON.parse(fs.readFileSync(path.join(folder,file),'utf8'));
    if(data.kind!=='saved-vad-inspection' || data.availability!=='available' || !data.gaps?.length)continue;
    if(data.audio.verification!=='verified' || !data.metricChecks?.every(item=>item.matches) ||
      hash(fs.readFileSync(data.audio.path))!==data.audio.expectedSha256)throw new Error('录音与导出证据不一致，请重新核验');
    samples.push({label:'',duration:data.audio.sampleCount/data.audio.sampleRateHz,audioPath:data.audio.path,
      sessionId:data.session.id,sourceId:data.selection.evidenceRunId,reportId:data.selection.reportSnapshotId,
      audioSha256:data.audio.expectedSha256,gaps:data.gaps.map(gap=>({id:gap.id,start:gap.startSeconds,end:gap.endSeconds}))});
  }
  return samples.sort((a,b)=>a.duration-b.duration).map((sample,index)=>({...sample,id:String.fromCharCode(65+index),label:`录音 ${String.fromCharCode(65+index)}`}));
}

if(require.main===module) {
  try {
    const {values}=parseArgs({options:{previews:{type:'string'},state:{type:'string'},port:{type:'string'},ready:{type:'string'}}});
    if(!values.previews || !values.state)throw new Error('用法：node scripts/fluency-review.js --previews <只读导出目录> --state <独立记录.json> [--port 端口] [--ready 就绪文件]');
    if(values.ready && path.resolve(values.ready).toLowerCase()===path.resolve(values.state).toLowerCase())
      throw new Error('就绪文件必须与验收记录使用不同路径');
    const server=createReviewServer({samples:loadSamples(path.resolve(values.previews)),stateFile:path.resolve(values.state)});
    server.on('error',error=>{console.error(error.message);process.exitCode=1;});
    server.listen(Number(values.port || 0),'127.0.0.1',()=>{
      const ready={url:`http://127.0.0.1:${server.address().port}`,pid:process.pid,stateFile:path.resolve(values.state)};
      try {
        if(values.ready)fs.writeFileSync(path.resolve(values.ready),JSON.stringify(ready,null,2)+'\n',{flag:'wx'});
      } catch(error) {
        console.error(error.message);process.exitCode=1;server.close();return;
      }
      console.log(`本地验收页面：${ready.url}\n记录保存：${ready.stateFile}`);
    });
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
module.exports={createReviewServer,loadSamples};
