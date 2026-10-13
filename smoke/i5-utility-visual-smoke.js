'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function run({mainWindow,BrowserWindow,evaluate,wait,capture,open,close,edit,field,activeId}) {
  const frozen='C:/Users/mr/.codex/worktrees/29dd/expression-trainer-pro/design-preview-merged';
  assert.ok(fs.existsSync(path.join(frozen,'freeze-v1.json')),'protected Frozen reference is available');
  const reference=new BrowserWindow({show:false,width:1200,height:800,
    webPreferences:{contextIsolation:true,nodeIntegration:false}});
  const originalSize=mainWindow.getSize(),measurements=[];
  const directory=process.env.EXPRESSION_TRAINER_PRODUCT_SCREENSHOTS;
  assert.ok(directory && path.isAbsolute(directory));fs.mkdirSync(directory,{recursive:true});
  const referenceEval=async code=>{
    try{return await reference.webContents.executeJavaScript(code);}
    catch(cause){throw new Error(`Frozen I5 visual evaluation failed: ${code}`,{cause});}
  };
  const style=selector=>`(()=>{
    const e=document.querySelector(${JSON.stringify(selector)});
    if(!e)throw new Error('Missing I5 visual selector: '+${JSON.stringify(selector)});
    const c=getComputedStyle(e),r=e.getBoundingClientRect();
    return {font:c.fontFamily,size:c.fontSize,weight:c.fontWeight,line:c.lineHeight,
      spacing:c.letterSpacing,color:c.color,width:r.width,height:r.height,x:r.x,y:r.y,
      display:c.display,gap:c.gap,columns:c.gridTemplateColumns,padding:c.padding,
      border:c.borderBottomWidth,radius:c.borderRadius};
  })()`;
  const typography=async(width,actualSelector,expectedSelector=actualSelector)=>{
    const [actual,expected]=await Promise.all([evaluate(style(actualSelector)),referenceEval(style(expectedSelector))]);
    for(const key of ['font','size','weight','line','spacing','color'])
      assert.equal(actual[key],expected[key],`${width}: ${actualSelector} ${key}`);
    measurements.push({width,actualSelector,expectedSelector,actual,expected});return {actual,expected};
  };
  const refCapture=async name=>fs.writeFileSync(path.join(directory,`${name}.png`),(await reference.webContents.capturePage()).toPNG());
  const viewport=async width=>{
    let actualWidth=width,actualHeight=800,referenceWidth=width,referenceHeight=800;
    mainWindow.setContentSize(actualWidth,actualHeight);reference.setContentSize(referenceWidth,referenceHeight);
    const deadline=Date.now()+5000;let actual,expected;
    do {
      [actual,expected]=await Promise.all([evaluate('({width:innerWidth,height:innerHeight})'),referenceEval('({width:innerWidth,height:innerHeight})')]);
      if(actual.width===width && expected.width===width && actual.height===800 && expected.height===800)break;
      // Native Windows/DPI rounding can add a few logical pixels. Correct the
      // request from observed CSS dimensions, while keeping the comparison exact.
      actualWidth+=width-actual.width;actualHeight+=800-actual.height;
      referenceWidth+=width-expected.width;referenceHeight+=800-expected.height;
      mainWindow.setContentSize(actualWidth,actualHeight);reference.setContentSize(referenceWidth,referenceHeight);
      await new Promise(resolve=>setTimeout(resolve,30));
    } while(Date.now()<deadline);
    assert.deepEqual(actual,{width,height:800},'actual CSS viewport reached requested dimensions');
    assert.deepEqual(expected,{width,height:800},'Frozen and actual use the same CSS viewport');
    measurements.push({width,page:'viewport',actualCss:actual,referenceCss:expected,
      actualNativeOuter:mainWindow.getSize(),actualNativeContent:mainWindow.getContentSize(),
      referenceNativeOuter:reference.getSize(),referenceNativeContent:reference.getContentSize()});
  };
  const referencePage=async(surface,page)=>{
    await reference.loadFile(path.join(frozen,'index.html'),{query:{screen:'report',surface,page}});
    await Promise.all([referenceEval('document.fonts.ready'),evaluate('document.fonts.ready')]);
    assert.equal(await referenceEval(`document.getElementById('utility').open`),true);
  };
  const bounds=async(width,page)=>{
    const value=await evaluate(`(()=>{
      const dialog=document.getElementById('utility'),content=document.getElementById('content');
      const r=dialog.getBoundingClientRect();
      return {viewport:innerWidth,x:r.x,right:r.right,width:r.width,height:r.height,
        contentWidth:content.clientWidth,contentScrollWidth:content.scrollWidth,
        contentHeight:content.clientHeight,contentScrollHeight:content.scrollHeight,
        offenders:[...dialog.querySelectorAll('*')].filter(e=>{
          const c=getComputedStyle(e),b=e.getBoundingClientRect();
          return c.display!=='none' && b.width>0 && (b.right>r.right+1 || b.left<r.left-1);
        }).map(e=>({tag:e.tagName,class:e.className,text:e.textContent.slice(0,55)})).slice(0,8)};
    })()`);
    assert.equal(value.viewport,width);assert.ok(value.x>=0 && value.right<=width+1,`${width}: dialog bounds`);
    assert.ok(value.contentScrollWidth<=value.contentWidth+1,`${width}: ${page} content overflow ${JSON.stringify(value)}`);
    assert.deepEqual(value.offenders,[],`${width}: ${page} controls stay within the dialog`);
    measurements.push({width,page,bounds:value});return value;
  };
  const shell=async width=>{
    const frame=await typography(width,'#utility');
    for(const key of ['width','height','x','y','radius'])
      if(typeof frame.actual[key]==='number')assert.ok(Math.abs(frame.actual[key]-frame.expected[key])<1,`${width}: dialog ${key}`);
      else assert.equal(frame.actual[key],frame.expected[key],`${width}: dialog ${key}`);
    for(const selector of ['#utility-kind','#surface-title','#close-surface','#local-nav button','#content'])await typography(width,selector);
    for(const selector of ['#utility .utility-shell','#utility .sidebar','#utility .surface-header','#content']) {
      const actual=await evaluate(style(selector)),expected=await referenceEval(style(selector));
      for(const key of ['width','x','padding','display','gap'])
        if(typeof actual[key]==='number')assert.ok(Math.abs(actual[key]-expected[key])<1,`${width}: ${selector} ${key}`);
        else assert.equal(actual[key],expected[key],`${width}: ${selector} ${key}`);
      measurements.push({width,actualSelector:selector,actual,expected});
    }
  };
  try {
    for(const width of [1200,960,1280,1440]) {
      // Load before evaluating the hidden BrowserWindow; executeJavaScript on
      // an uninitialized webContents otherwise waits indefinitely for a page.
      await referencePage('settings','ai');await viewport(width);await open('settings','ai');
      await shell(width);await bounds(width,'ai');
      for(const selector of ['#utility .activation-line h2','#utility .activation-line p',
        '#utility .settings-section-head h2','#utility .config-info strong','#utility .config-info small','#ai-toggle'])
        await typography(width,selector);
      await capture(`i5-settings-ai-${width}`);await refCapture(`i5-frozen-settings-ai-${width}`);
      await edit(activeId);await referenceEval(`document.querySelector('[data-edit="remote"]').click()`);
      // Frozen deliberately forbids real keys in its simulated Demo. Compare
      // an equivalent editable password control without changing its files.
      await referenceEval(`document.querySelector('#utility input[type="password"]').readOnly=false`);
      assert.equal(await evaluate(`document.querySelector('[data-field="apiKey"]').readOnly`),false);
      for(const selector of ['#utility .ai-editor h2','#utility .settings-form label',
        '#utility [data-field="name"]','#utility [data-field="model"]','#utility [data-field="url"]',
        '#utility .editor-actions button','#utility #destination'])await typography(width,selector);
      await typography(width,'#utility [data-field="apiKey"]','#utility input[type="password"]');
      await bounds(width,'ai-editor');await capture(`i5-settings-editor-${width}`);await refCapture(`i5-frozen-settings-editor-${width}`);
      await field('name','I5 有尚未保存的修改');
      await referenceEval(`(()=>{const e=document.querySelector('[data-field="name"]');e.value='有尚未保存的修改';e.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('close-surface').click();})()`);
      await evaluate(`document.getElementById('close-surface').click()`);
      await wait('visual unsaved guard',`!document.getElementById('unsaved').hidden`);
      for(const selector of ['#unsaved','#stay','#discard'])await typography(width,selector);
      await bounds(width,'unsaved');await capture(`i5-settings-unsaved-${width}`);await refCapture(`i5-frozen-settings-unsaved-${width}`);
      await evaluate(`document.getElementById('discard').click()`);await wait('visual discarded Utility closed',`!document.getElementById('utility').open`);

      await referencePage('settings','preferences');await open('settings','preferences');await shell(width);
      for(const selector of ['#utility .settings-intro','#utility .preference-field','#utility [data-pref="goals"]',
        '#utility .preference-more>summary','#utility [data-save-pref]'])await typography(width,selector);
      await capture(`i5-settings-preferences-${width}`);await refCapture(`i5-frozen-settings-preferences-${width}`);
      await evaluate(`document.querySelector('#utility .preference-more').open=true`);
      await referenceEval(`document.querySelector('#utility .preference-more').open=true`);
      await field('goals','长期关注点，需要结合上下文、原文与建议一起阅读。'.repeat(80),'pref');
      await field('rules','补充分析指令只应用于后续主动分析，不改变已有结果。'.repeat(80),'pref');
      await bounds(width,'preferences-expanded-long');await capture(`i5-settings-preferences-long-${width}`);
      await evaluate(`document.getElementById('content').scrollTop=document.getElementById('content').scrollHeight`);
      await capture(`i5-settings-preferences-actions-${width}`);
      await evaluate(`document.getElementById('close-surface').click();document.getElementById('discard').click()`);
      await wait('long preferences discarded',`!document.getElementById('utility').open`);

      await referencePage('settings','speech');await open('settings','speech');await shell(width);
      for(const selector of ['#utility .settings-intro','#utility .settings-section-head h2',
        '#utility .speech-model h3','#utility .speech-model p'])await typography(width,selector);
      await bounds(width,'speech');await capture(`i5-settings-speech-${width}`);await refCapture(`i5-frozen-settings-speech-${width}`);await close();

      for(const page of ['start','report','privacy','feedback']) {
        await referencePage('help',page);await open('help',page);await shell(width);
        for(const selector of ['#utility .faq>summary','#utility .faq>div'])await typography(width,selector);
        if(page==='start') {
          // The final Frozen script retains search CSS/listeners but does not
          // render a search box. Record this real functional addition honestly.
          measurements.push({width,page,actualSelector:'#help-search',actual:await evaluate(style('#help-search')),reference:'No search input in protected Frozen DOM'});
          for(const selector of ['#utility .steps h3','#utility .steps p'])await typography(width,selector);
        }
        if(page==='report' || page==='privacy')for(const selector of ['#utility .help-facts dt','#utility .help-facts dd','#utility .help-section-title'])await typography(width,selector);
        await bounds(width,`help-${page}`);await capture(`i5-help-${page}-${width}`);await refCapture(`i5-frozen-help-${page}-${width}`);
        await evaluate(`document.querySelectorAll('#utility .faq').forEach(e=>e.open=true)`);
        await referenceEval(`document.querySelectorAll('#utility .faq').forEach(e=>e.open=true)`);
        await bounds(width,`help-${page}-expanded`);await capture(`i5-help-${page}-expanded-${width}`);
        await close();
      }
    }
    fs.writeFileSync(path.join(directory,'i5-utility-visual-measurements.json'),JSON.stringify(measurements,null,2));
  } finally {reference.destroy();mainWindow.setSize(...originalSize);}
}
module.exports = {run};
