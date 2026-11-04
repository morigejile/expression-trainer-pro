'use strict';
// Author the Markdown cards/rules; this build step emits only production content.
const fs=require('node:fs');
const path=require('node:path');
const SOURCE=path.join(__dirname,'../docs/product/expression-problem-library.md');
const OUTPUT=path.join(__dirname,'../lib/expression-problem-library.generated.json');
const groups={ORG:['organization',null,9],ARG:['argument',null,9],DEL:['delivery',null,7],WRD:['wording',null,8],
  STAR:[null,'star',7],PREP:[null,'prep',4],PYR:[null,'pyramid',4]};

function compileProblemLibrary(markdown){
  markdown=markdown.replace(/\r\n/g,'\n');
  const section=(start,end)=>{
    const a=markdown.indexOf(start),b=markdown.indexOf(end,a+start.length);
    if(a<0||b<a) throw new Error(`Missing library section: ${start}`);
    return markdown.slice(a+start.length,b).trim();
  };
  const cards=[];
  for(const line of markdown.split(/\r?\n/)){
    if(!/^\| (?:ORG|ARG|DEL|WRD|STAR|PREP|PYR)-\d{2} /.test(line)) continue;
    const cells=line.split('|').slice(1,-1).map(x=>x.trim());
    if(cells.length!==8||cells.some(x=>!x)) throw new Error(`Incomplete card: ${cells[0]}`);
    const [,id,title]=cells[0].match(/^(\S+) (.+)$/)||[];
    const group=groups[id?.split('-')[0]];
    const [category,usage,applicability,question,exclusions,evidence,practice]=cells.slice(1);
    if(!group||!['organization','argument','delivery','wording'].includes(category)||
      (group[0]&&category!==group[0])||!['可检查','仅观察','禁评'].includes(usage)) throw new Error(`Invalid card: ${id}`);
    cards.push({id,title,category,framework:group[1],usage,applicability,question,exclusions,evidence,practice});
  }
  const ids=new Set(cards.map(x=>x.id));
  if(ids.size!==48||cards.length!==48) throw new Error('Expected 48 unique reviewed cards');
  for(const [prefix,[,,count]] of Object.entries(groups)) for(let n=1;n<=count;n++){
    if(!ids.has(`${prefix}-${String(n).padStart(2,'0')}`)) throw new Error(`Missing ${prefix} card`);
  }
  const version=markdown.match(/内容版本：(v\d+\.\d+)/)?.[1];
  if(!version) throw new Error('Missing library version');
  return {version:`expression-problem-library-${version}`,rules:{
    taskGate:section('### 2.0 任务必要性门槛','### 2.1 成立条件'),
    mergeExamples:section('### 2.4 合并与不合并的短对照','## 3. 通用问题清单'),
    common:section('### 2.1 成立条件','### 2.3 重叠问题如何区分、何时合并'),
    merge:section('### 2.3 重叠问题如何区分、何时合并','### 2.4 合并与不合并的短对照'),
    evidence:section('### 1.4 主诊断的证据使用规则','## 2. 写出问题之前的共同规则'),
    advice:section('## 5. 建议如何转成下一轮练习','## 6. 未来本地线索：内容建议，不是本轮实施项')},cards};
}
if(require.main===module){
  const output=JSON.stringify(compileProblemLibrary(fs.readFileSync(SOURCE,'utf8')),null,2)+'\n';
  if(process.argv.includes('--check')){
    if(!fs.existsSync(OUTPUT)||fs.readFileSync(OUTPUT,'utf8').replace(/\r\n/g,'\n')!==output.replace(/\r\n/g,'\n')){
      console.error('Problem library artifact is stale; run node scripts/generate-problem-library.js');process.exitCode=1;
    }
  }else fs.writeFileSync(OUTPUT,output);
}
module.exports={compileProblemLibrary};
