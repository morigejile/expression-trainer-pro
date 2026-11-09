'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const config=require('../lib/appearance-config'),{createAppearanceController,applyAppearance,syncMaterialFallback}=require('../src/appearance');
const value=theme=>({schemaVersion:1,theme,layout:'coach-rail'});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const tick=()=>new Promise(done=>setImmediate(done));
test('frosted-mist is a fourth stable theme with schema 1 and does not reinterpret retired mist',()=>{
 assert.equal(config.THEME_OPTIONS.find(option=>option.id==='frosted-mist')?.label,'柔雾 · 毛玻璃');
 assert.deepEqual(config.normalizeAppearance(value('frosted-mist')),value('frosted-mist'));
 assert.deepEqual(config.normalizeAppearance(value('mist')),value('graphite'));
 assert.deepEqual(config.normalizeAppearance(value('frost')),value('graphite'));
 const future=config.parseAppearanceJson(JSON.stringify({...value('frosted-mist'),schemaVersion:99}));assert.equal(future.isFutureSchema,true);assert.equal(future.appearance.theme,'frosted-mist');
 assert.equal(config.CURRENT_APPEARANCE_SCHEMA_VERSION,1);
});
test('frosted-mist uses the existing latest-choice queue, broadcast isolation and failed-save rollback',async()=>{
 const first=deferred(),second=deferred(),root={dataset:{}};let broadcast;const calls=[];
 const controller=createAppearanceController({root,api:{getAppearance:async()=>value('ink-night'),onAppearanceChanged:fn=>{broadcast=fn;},saveAppearance:appearance=>{calls.push(appearance);return calls.length===1?first.promise:second.promise;}}});
 await controller.ready;const a=controller.select('coral-glow');await tick();const b=controller.select('frosted-mist');assert.equal(root.dataset.theme,'frosted-mist');broadcast(value('coral-glow'));assert.equal(root.dataset.theme,'frosted-mist');first.resolve({success:true,appearance:value('coral-glow')});await tick();assert.equal(calls[1].theme,'frosted-mist');second.resolve({success:false,error:'外观保存失败，请重试'});await Promise.all([a,b]);assert.equal(root.dataset.theme,'coral-glow');assert.equal(controller.snapshot().status,'error');
});
test('frosted mist checks its actual glass layer, keeping normal solid Utility reading panels from causing a false fallback',()=>{
 let supported=true,reduced=false,glassBlur='blur(24px) saturate(1.3)';
 const glass={kind:'glass'},utility={open:true,kind:'reading'};
 const root={dataset:{},ownerDocument:{querySelector:()=>glass,getElementById:()=>utility,defaultView:{CSS:{supports:()=>supported},matchMedia:()=>({matches:reduced}),getComputedStyle:el=>({backdropFilter:el===glass?glassBlur:'none'})}}};
 applyAppearance(root,{theme:'frosted-mist'});assert.equal(root.dataset.theme,'frosted-mist');assert.equal(root.dataset.materialFallback,undefined);
 glassBlur='none';syncMaterialFallback(root);assert.equal(root.dataset.materialFallback,'solid');
 glassBlur='blur(24px)';syncMaterialFallback(root);assert.equal(root.dataset.materialFallback,undefined);
 supported=false;syncMaterialFallback(root);assert.equal(root.dataset.materialFallback,'solid');
 supported=true;reduced=true;syncMaterialFallback(root);assert.equal(root.dataset.materialFallback,'solid');
 applyAppearance(root,{theme:'graphite'});assert.equal(root.dataset.materialFallback,undefined);
});
