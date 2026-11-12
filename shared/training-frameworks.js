(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrainingFrameworks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  // Shared by preparation and the selected-framework analysis. Version changes
  // are explicit; saved recordings always retain the definition they used.
  const definitions = {
    prep: {id:'prep',version:'prep-v1',label:'PREP',purpose:'表达观点、判断和建议',
      structure:'观点 → 理由 → 例子 → 回扣观点',
      guidance:'先说清楚你的观点，再解释理由，举一个具体例子，最后回到主张。无需逐项填写。',
      example:'我建议每周留一天不开会，因为连续时间更利于专注。上周我用一个完整上午完成了拖延的方案。因此，可以先试行一个月。',
      checks:['核心观点是否清楚','理由是否支持观点','例子是否具体且与理由相关','结尾是否回到主张，前后是否一致'],
      limits:'按语义判断，不要求固定关键词、四个段落或机械重复观点。'},
    star: {id:'star',version:'star-v1',label:'STAR',purpose:'讲述经历、面试和复盘',
      structure:'情境 → 任务 → 行动 → 结果与收获',
      guidance:'交代发生了什么、你要完成什么，重点讲自己的行动，再说明结果和收获。',
      example:'上线前发现接口故障，我负责确保当天交付。我先定位受影响功能，再协调回退并补上监控。最终按时恢复服务，也发现了发布检查的缺口。',
      checks:['情境与任务是否清楚且可区分','本人的具体行动是否明确','行动是否回应任务','是否交代结果或收获，以及与行动的关系'],
      limits:'不强求积极结果、量化成绩或固定时间比例；失败及反思也可以构成结果。'},
    pyramid: {id:'pyramid',version:'pyramid-v1',label:'金字塔',purpose:'汇报、提案和复杂信息说明',
      structure:'核心结论 → 分组要点 → 逐层事实支撑',
      guidance:'先回答听者最关心的问题，再按清晰的分组展开理由，并给出对应事实。',
      example:'我建议把发布推迟两天，原因是稳定性风险和准备不足。稳定性方面有两项关键缺陷；准备方面还缺回滚演练。两天内可以完成修复和演练。',
      checks:['顶层结论是否回答表达目标','同层要点是否围绕一致的分组逻辑','上下层之间是否构成解释或支撑','是否有明显重复、层次混杂或缺少支撑'],
      limits:'这是层级结构，不是固定槽位；不强制三个分支或 SCQA，不能仅凭转写断言事实穷尽或客观正确。'}
  };
  const prompts = {
    topic:[
      {id:'meeting-free-day',label:'每周无会日',title:'每周是否应设一天无会议日',text:'你是否赞成每周安排一天不举行会议？说明理由。'},
      {id:'learning',label:'学习新技能',title:'学新技能先实践还是先系统学习',text:'学习一项新技能时，应该先实践还是先系统学习？'},
      {id:'retrospective',label:'团队定期复盘',title:'团队是否应固定安排复盘',text:'你是否建议团队固定安排复盘时间？为什么？'},
      {id:'habit',label:'一个值得推荐的习惯',text:'你会推荐别人养成什么习惯？用具体例子说明。'},
      {id:'unexpected',label:'处理突发问题的经历',text:'讲一次你处理突发问题的经历，以及你从中得到的经验。'},
      {id:'release',label:'是否推迟项目上线',text:'项目上线前仍有问题尚未解决，你是否建议延期？说明你的判断。'}
    ],
    scenario:[
      {id:'work-report',label:'工作汇报',text:'向负责人汇报，帮助对方了解现状、主要问题和下一步建议。'},
      {id:'interview',label:'面试交流',text:'面对面试官，结合自身经历说明你的判断、贡献与收获。'},
      {id:'team-proposal',label:'团队提案',text:'在团队讨论中提出建议，解释依据，并回应可能的顾虑。'},
      {id:'peer-sharing',label:'经验分享',text:'向同事分享经验，帮助对方理解可复用的方法和注意事项。'},
      {id:'friend-chat',label:'朋友交流',text:'与朋友自然交流，说明自己的想法，也为对方的不同意见留出空间。'},
      {id:'public-speaking',label:'公开分享',text:'面向不熟悉背景的听众作简短分享，让对方理解重点并记住核心信息。'}
    ]
  };
  function getFramework(id, version) {
    if (!Object.hasOwn(definitions,id)) return null;
    const value = definitions[id];
    return version != null && version !== value.version ? null : JSON.parse(JSON.stringify(value));
  }
  function getPromptOptions(kind) { return JSON.parse(JSON.stringify(prompts[kind] || [])); }
  function getBankTopicTitle(text) {
    const topic = prompts.topic.find(item => item.text === text);
    return topic?.title ?? topic?.label;
  }
  return {getFramework,getPromptOptions,getBankTopicTitle};
});
