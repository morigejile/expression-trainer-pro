'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAppearanceController,applyAppearance,syncMaterialFallback}=require('../src/appearance');
const {normalizeAppearance,THEME_IDS}=require('../lib/appearance-config');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const value=theme=>({schemaVersion:1,theme,layout:'coach-rail'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('new IDs are distinct from retired palettes; all legacy layouts keep the accepted layout',()=>{
 assert.deepEqual(THEME_IDS,['graphite','coral-glow','ink-night']);
 for(const theme of ['midnight','paper','mist','unknown',undefined])assert.deepEqual(normalizeAppearance({theme,layout:'focus-hud'}),value('graphite'));
 for(const theme of THEME_IDS)assert.deepEqual(normalizeAppearance({theme,layout:'focus-hud'}),value(theme));
});
test('rapid theme requests apply immediately and serialize saves so old replies and broadcasts cannot revert the latest choice',async()=>{
 const calls=[],root={dataset:{},children:[{id:'training'}]};let broadcast;
 const controller=createAppearanceController({root,api:{getAppearance:async()=>value('graphite'),onAppearanceChanged:fn=>{broadcast=fn;},saveAppearance:appearance=>{const pending=deferred();calls.push({appearance,...pending});return pending.promise;}}});
 await controller.ready;const children=root.children;
 const first=controller.select('coral-glow');await tick();const latest=controller.select('ink-night');assert.equal(root.dataset.theme,'ink-night');assert.equal(controller.snapshot().status,'saving');assert.equal(calls.length,1);
 broadcast(value('coral-glow'));assert.equal(root.dataset.theme,'ink-night');calls[0].resolve({success:true,appearance:value('coral-glow')});await tick();assert.equal(calls.length,2);assert.equal(calls[1].appearance.theme,'ink-night');assert.equal(root.dataset.theme,'ink-night');
 calls[1].resolve({success:true,appearance:value('ink-night')});await Promise.all([first,latest]);assert.equal(controller.snapshot().status,'saved');assert.equal(root.dataset.theme,'ink-night');assert.equal(root.children,children);
});
test('failed save restores the last successful value, reports failure and allows retry',async()=>{
 let failed=true;const root={dataset:{}};
 const controller=createAppearanceController({root,api:{getAppearance:async()=>value('ink-night'),saveAppearance:async appearance=>failed?{success:false,error:'当前版本无法保存更高版本的外观配置'}:{success:true,appearance}}});
 await controller.ready;await controller.select('coral-glow');assert.equal(root.dataset.theme,'ink-night');assert.equal(controller.snapshot().status,'error');assert.match(controller.snapshot().error,/更高版本/);
 failed=false;await controller.select('coral-glow');assert.equal(root.dataset.theme,'coral-glow');assert.equal(controller.snapshot().status,'saved');
});
test('stale failures do not erase the next requested theme and the last successful file remains the rollback point',async()=>{
 const first=deferred(),second=deferred(),root={dataset:{}};let calls=0;
 const controller=createAppearanceController({root,api:{getAppearance:async()=>value('graphite'),saveAppearance:()=>++calls===1?first.promise:second.promise}});
 await controller.ready;const a=controller.select('coral-glow');await tick();const b=controller.select('ink-night');first.reject(Error('disk'));await tick();assert.equal(root.dataset.theme,'ink-night');second.reject(Error('disk'));await Promise.all([a,b]);assert.equal(root.dataset.theme,'graphite');assert.equal(controller.snapshot().status,'error');
});
test('new broadcast wins over late initial read; failed reads keep a usable default and subscriptions are removable',async()=>{
 const loaded=deferred(),root={dataset:{}};let broadcast;const controller=createAppearanceController({root,api:{getAppearance:()=>loaded.promise,onAppearanceChanged:fn=>{broadcast=fn;return ()=>{};},saveAppearance:async appearance=>({success:true,appearance})}});
 const seen=[];const unsubscribe=controller.subscribe(s=>seen.push(s));broadcast(value('ink-night'));loaded.resolve(value('coral-glow'));await controller.ready;assert.equal(root.dataset.theme,'ink-night');unsubscribe();const count=seen.length;await controller.select('graphite');assert.equal(seen.length,count);
 const fallback=createAppearanceController({root:{dataset:{}},api:{getAppearance:async()=>{throw Error('read');}}});await fallback.ready;assert.equal(fallback.snapshot().appearance.theme,'graphite');assert.equal(fallback.snapshot().status,'error');
});
test('coral retains normal blur and uses a solid fallback only when blur is absent or ineffective',()=>{
 let supported=true,blur='blur(18px)',reduced=false;
 const root={dataset:{},ownerDocument:{getElementById:()=>({open:true}),defaultView:{CSS:{supports:()=>supported},matchMedia:()=>({matches:reduced}),getComputedStyle:()=>({backdropFilter:blur})}}};
 applyAppearance(root,{theme:'coral-glow'});assert.equal(root.dataset.materialFallback,undefined);
 blur='none';syncMaterialFallback(root);assert.equal(root.dataset.materialFallback,'solid');
 blur='blur(18px)';syncMaterialFallback(root);assert.equal(root.dataset.materialFallback,undefined);
 supported=false;syncMaterialFallback(root);assert.equal(root.dataset.materialFallback,'solid');
 supported=true;reduced=true;syncMaterialFallback(root);assert.equal(root.dataset.materialFallback,'solid');
 applyAppearance(root,{theme:'ink-night'});assert.equal(root.dataset.materialFallback,undefined);
});
test('selection waits for the initial read even if a broadcast arrives while it is pending',async()=>{
 const loaded=deferred(),write=deferred(),root={dataset:{}};let broadcast,calls=0;
 const controller=createAppearanceController({root,api:{getAppearance:()=>loaded.promise,onAppearanceChanged:fn=>{broadcast=fn;},saveAppearance:()=>{calls++;return write.promise;}}});
 broadcast(value('ink-night'));const choosing=controller.select('coral-glow');assert.equal(calls,0);assert.equal(root.dataset.theme,'ink-night');loaded.resolve(value('graphite'));await tick();assert.equal(calls,1);assert.equal(root.dataset.theme,'coral-glow');assert.equal(controller.snapshot().status,'saving');write.resolve({success:true,appearance:value('coral-glow')});await choosing;assert.equal(controller.snapshot().status,'saved');
});
