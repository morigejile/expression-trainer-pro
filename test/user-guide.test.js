'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');

test('bundled manual is generated from the maintained Markdown and remains in the runtime package',()=>{
 const {generate}=require('../scripts/generate-user-guide');
 const source=fs.readFileSync(path.join(__dirname,'../docs/guides/deepseek-first-use.md'),'utf8');
 const runtime=fs.readFileSync(path.join(__dirname,'../src/deepseek-guide.js'),'utf8');
 assert.equal(runtime,generate(source));
 const ignore=require('../forge.config').packagerConfig.ignore;
 assert.equal(ignore('/src/deepseek-guide.js'),false);
 assert.equal(ignore('/src/help-guide.js'),false);
 const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');
 assert.ok(html.indexOf('deepseek-guide.js')<html.indexOf('utility-content.js'));
 assert.ok(html.indexOf('help-guide.js')<html.indexOf('utility-content.js'));
});

test('every bundled external guide link is in the exact support URL allowlist',()=>{
 const guide=require('../src/deepseek-guide'),{isAllowedSupportUrl}=require('../shared/support-links');
 const urls=[...JSON.stringify(guide).matchAll(/\]\((https?:[^)]+)\)/g)].map(match=>match[1]);
 assert.ok(urls.length>0);
 for(const url of urls){
  assert.equal(isAllowedSupportUrl(url),true,url);
  assert.equal(isAllowedSupportUrl(url+'?redirect=https://untrusted.invalid'),false);
  assert.equal(isAllowedSupportUrl(url.replace('deepseek.com','deepseek.com.untrusted.invalid')),false);
 }
});
