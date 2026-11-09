'use strict';
// Rendering regression only: real entry DOM, stylesheet order and flow adapter.
// All business scripts are removed, so no ASR, AI, settings or history API runs.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..'),data=process.env.ROOT_VIEWPORT_DATA,dpr=Number(process.env.ROOT_VIEWPORT_DPR),pause=ms=>new Promise(done=>setTimeout(done,ms));
app.setPath('userData',data);app.commandLine.appendSwitch('force-device-scale-factor',String(dpr));app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const entry=path.join(data,'viewport.html'),base=pathToFileURL(path.join(repo,'src')+path.sep).href;
 const html=fs.readFileSync(path.join(repo,'src/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('<head>',`<head><base href="${base}">`).replace('</body>','<script src="frozen-flow-view.js"></script></body>');fs.writeFileSync(entry,html);
 const win=new BrowserWindow({show:false,frame:false,backgroundColor:'#000000',width:1200,height:800,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
 let external=0;win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,done)=>{external++;done({cancel:true});});
 await win.loadFile(entry);await win.webContents.executeJavaScript('document.fonts.ready');await win.webContents.executeJavaScript('window.flow=FrozenFlowView.createFlowView(document);void 0');let checks=0;
 for(const [width,height]of [[1200,800],[960,640]]){win.setContentSize(width,height);await pause(30);
  for(const theme of ['graphite','coral-glow','ink-night','frosted-mist'])for(const screen of ['training','history','report','comparison']){
   const sample=await win.webContents.executeJavaScript(`(()=>{document.documentElement.dataset.theme='${theme}';flow.show('${screen}');for(const animation of document.getAnimations())if(animation instanceof CSSTransition)animation.finish();const rect=el=>{const r=el.getBoundingClientRect();return {right:r.right,width:r.width};};window.scrollTo(0,100);return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,root:rect(document.documentElement),body:rect(document.body),layout:rect(document.querySelector('.layout')),scrollY,anchor:getComputedStyle(document.documentElement).overflowAnchor};})()`);
   assert.equal(sample.width,width);assert.equal(sample.height,height);assert.equal(sample.dpr,dpr);for(const key of ['root','body','layout'])assert(Math.abs(sample[key].right-width)<.05,`${theme}/${screen}: ${key} right ${sample[key].right} must reach viewport ${width}`);assert.equal(sample.scrollY,0);assert.equal(sample.anchor,'none');
   if(screen==='history'||screen==='report')assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.getElementById('${screen==='history'?'history':'report'}-scroll')).scrollbarGutter`),'stable');
   await win.webContents.capturePage();await pause(20);const image=await win.webContents.capturePage(),size=image.getSize(),pixels=image.toBitmap();assert.equal(pixels.length,size.width*size.height*4);
   // Scan adjacent physical columns across the former strip boundary, not only
   // overflow or a CSS value. The margin here contains only the real page paint.
   for(const fraction of [.3,.5,.7]){const y=Math.floor(size.height*fraction);for(let x=size.width-Math.ceil(25*dpr);x<size.width-1;x++){const a=(y*size.width+x)*4,b=a+4;for(let channel=0;channel<3;channel++)assert(Math.abs(pixels[a+channel]-pixels[b+channel])<=3,`${theme}/${screen}: discontinuous right-edge paint at ${x}`);}}
   if(theme==='frosted-mist'){const offset=(Math.floor(size.height/2)*size.width+size.width-1)*4;assert(pixels[offset]+pixels[offset+1]+pixels[offset+2]>100,'Frost must not expose the black window');}
   checks++;
  }
 }
 assert.equal(external,0);console.log('ROOT_VIEWPORT_OK '+checks);app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
