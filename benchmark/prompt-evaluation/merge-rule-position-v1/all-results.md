# 合并规则位置对照：全部 8 次结果

以下按真实调用顺序展示全部模型原始返回，未改写、删选或合并。baseline 为当前 v9；moved 只把同一合并规则块移至系统提示末尾。内容评阅与模型原文分开；详见 [结论](summary.md)、[逐次评阅](review.json)、[完整请求及原始结果](results.json)。

## 固定输入 E05

题目：向团队解释为什么应全面推广一次改版，完整论证。

场景字段：null；框架：Free / null；范围：完整答复。

> 试点组上月订单增加了。同期我们更换了首页。
>
> 因此，可以确定订单增长完全是首页改版带来的，应该立即全量推广。

## 固定输入 E07

题目：只练汇报开头，要求先确定本段讲哪一点；不评价整篇完整性。

场景字段：null；框架：Free / null；范围：segment。

> 我先说上线时间，先说功能，不，还是说上线时间，刚才那个先不说，我们，还是先说功能……

## 1/8 · E05 · baseline · 第 1 次

状态：completed；HTTP：200；响应模型：deepseek-flash；耗时：7077 ms。

**助手评阅（不是模型返回）**

因果依据与推广依据分别保留；绝对化措辞项与因果依据项重复。

- 建议中的‘主要原因之一’仍暗含影响大小，现有材料不足以支持这一程度；这是建议示例风险，并非已生成的新事实。

**模型原始返回（逐字保留）**

```json
{"schemaVersion":1,"assessment":{"status":"analyzable","reason":"材料虽短，但已包含明确主张（应全量推广）和理由（订单增长与首页改版同期），足以评价论证与措辞；无音频，无法评价节奏与声音表现。","categories":["argument","wording"],"frameworkAssessable":false,"evidenceRefs":["s1","s2"]},"summary":"表达有明确结论和依据，但把同期发生直接说成确定因果，并据此要求立即全量推广，论证跳跃明显。最值得关注的是区分相关与因果、说明其他可能解释。无音频，本次不评价节奏与声音。","findings":[{"id":"common-1","category":"argument","observation":"原文由“订单增加了”和“同期我们更换了首页”直接推出“订单增长完全是首页改版带来的”，中间没有排除其他可能原因。","interpretation":"听者无法判断这一因果结论的依据，也难以评估全量推广的风险。","recommendation":"补充能区分首页改版与其他因素的信息，或把结论改为有条件的判断，并说明还需哪些验证。","example":null,"exampleEvidenceRefs":[],"evidenceRefs":["s1","s2"]},{"id":"common-2","category":"argument","observation":"在因果尚未确认时，原文直接说“应该立即全量推广”。","interpretation":"推广建议缺少与证据强度匹配的取舍说明，听者难以理解为何要立即全量而非先验证。","recommendation":"说明选择立即全量推广的理由，或改为先小范围验证再决定推广范围。","example":null,"exampleEvidenceRefs":[],"evidenceRefs":["s1","s2"]},{"id":"common-3","category":"wording","observation":"“完全是”把有限依据说成排他性结论。","interpretation":"这一绝对化措辞掩盖了不确定性，容易让听者高估证据强度。","recommendation":"按实际把握程度调整表述，如说明首页改版可能是主要原因之一，并保留待验证部分。","example":null,"exampleEvidenceRefs":[],"evidenceRefs":["s2"]}],"frameworkSummary":null,"frameworkFindings":[],"frameworkRecommendation":{"framework":"prep","reason":"本次已有观点和理由，适合用观点—理由—例子—观点回扣的结构练习，把因果依据和推广建议讲清楚。","evidenceRefs":["s1","s2"]}}
```

## 2/8 · E05 · moved · 第 1 次

状态：completed；HTTP：200；响应模型：deepseek-flash；耗时：4523 ms。

**助手评阅（不是模型返回）**

因果依据与推广依据分别保留；第三条组织反馈重复因果关系缺口。

- 第三条解释说需猜测第二句是原因、背景还是并列信息，但原文已用‘因此’表达因果推断；没有论证依据不等于没有表达推断关系。
- ‘可能主要来自’仍需要相应证据支持，不能只把‘完全’替换成‘主要’就认为保真。

**模型原始返回（逐字保留）**

```json
{"schemaVersion":1,"assessment":{"status":"analyzable","reason":"材料虽短，但已包含明确主张（应全量推广首页改版）和一条因果依据，足以评价论点与组织；无音频与逐字时间证据，不评价节奏、停顿或声音表现。","categories":["organization","argument"],"frameworkAssessable":false,"evidenceRefs":["s1","s2"]},"summary":"表达有明确结论，但把同期发生直接当成唯一原因，论证的确定程度超出依据。最值得关注的是补上因果判断所需的对照或排除说明，并如实保留不确定性。","findings":[{"id":"common-1","category":"argument","observation":"原文只给出“订单增加”与“更换首页”同期发生，随后称“可以确定订单增长完全是首页改版带来的”。","interpretation":"同期发生不足以支持排他性因果，听者无法判断是否还有其他因素，结论的确定程度超出依据。","recommendation":"下一轮先说明除首页改版外是否还有同期变化，并把结论改为与证据相符的程度，例如“可能主要来自”或“需要进一步验证”。","example":null,"exampleEvidenceRefs":[],"evidenceRefs":["s1","s2"]},{"id":"common-2","category":"argument","observation":"从“试点组订单增加”直接推到“应该立即全量推广”，中间没有交代试点范围、可比对象或推广条件。","interpretation":"听者难以评估试点结果能否外推到全量场景，推广建议缺少可检验的前提。","recommendation":"补充试点的对象与范围，并说明全量推广前需要确认的一项条件或验证方式；信息未定时用[待补充信息]标明。","example":null,"exampleEvidenceRefs":[],"evidenceRefs":["s1","s2"]},{"id":"common-3","category":"organization","observation":"先陈述订单增加，再补一句“同期我们更换了首页”，随后直接给出结论，两句之间没有说明二者关系的引导。","interpretation":"听者需要自行猜测第二句是作为原因、背景还是并列信息，影响对论证走向的把握。","recommendation":"把首页改版明确标为待验证的原因，并说明它与订单变化的关系，再给出结论。","example":null,"exampleEvidenceRefs":[],"evidenceRefs":["s1","s2"]}],"frameworkSummary":null,"frameworkFindings":[],"frameworkRecommendation":{"framework":"prep","reason":"本次任务是向团队完整论证一项推广建议，PREP 能帮助先亮明观点，再用理由和依据支撑，最后回到推广建议，正好对应本次需要补强的因果论证。","evidenceRefs":["s1","s2"]}}
```

## 3/8 · E07 · moved · 第 1 次

状态：completed；HTTP：200；响应模型：deepseek-flash；耗时：4564 ms。

**助手评阅（不是模型返回）**

同一组改口被分别列为重启、组织、措辞，围绕一个主要障碍产生三条反馈。

- 第三条解释称‘使真正的主题迟迟没有出现’，忽略原文已反复提到上线时间与功能；不能把方向不稳定说成主题未出现。
- ‘始终没有确定’‘最终仍未形成确定的说法’相对片段证据过强；最终是否选定仍未知。
- 观察中的引语含省略号，属于转写摘录而非完整原话；未发现关键选择方向被改换，但仍不宜将截取包装成完整引语。

**模型原始返回（逐字保留）**

```json
{"schemaVersion":1,"assessment":{"status":"analyzable","reason":"本次是局部练习，只练汇报开头，要求先确定本段讲哪一点。转写虽短，但能清楚看出说话人在“上线时间”和“功能”之间反复切换，足以评价这一范围内的表达表现。音频与时间信息不可用，因此只评文字中保留的表现，不评价停顿、语速或情绪。","categories":["organization","delivery","wording"],"frameworkAssessable":false,"evidenceRefs":["s1"]},"summary":"这段开头在“上线时间”和“功能”之间来回切换，始终没有确定先讲哪一点，听者难以确认本段主题。最值得关注的是先选定一个要点并把它讲完，而不是继续在两者之间反复起句。本次只有局部开头文字，音频不可用，评价限于文字表现。","findings":[{"id":"common-1","category":"delivery","observation":"同一句里多次重启：“我先说上线时间，先说功能，不，还是说上线时间……还是先说功能”，最终仍未形成确定的说法。","interpretation":"听者无法确认本段究竟先讲哪一点，开头没有完成交代主题的作用。","recommendation":"下一轮先在心里选定“上线时间”或“功能”其中一个，开口后直接把这个要点说完，不再中途撤回。","example":null,"exampleEvidenceRefs":[],"evidenceRefs":["s1"]},{"id":"common-2","category":"organization","observation":"“上线时间”和“功能”两个话题在开头交替出现，中间用“刚才那个先不说”带过，没有说明两者的先后关系。","interpretation":"听者难以判断这两点在本段中的主次和顺序，开头缺少可跟随的推进方向。","recommendation":"先明确本段只讲哪一点，若两点都要讲，就用一句话交代先后，例如先说其中一点，再引出另一点。","example":null,"exampleEvidenceRefs":[],"evidenceRefs":["s1"]},{"id":"common-3","category":"wording","observation":"“先说”“还是说”“先不说”在同一处密集出现，反复占位而没有推进内容。","interpretation":"这些词挤占了开头的表达空间，使真正的主题迟迟没有出现。","recommendation":"删去这些反复的选择性表述，只保留一次明确的话题引入，然后直接进入内容。","example":null,"exampleEvidenceRefs":[],"evidenceRefs":["s1"]}],"frameworkSummary":null,"frameworkFindings":[],"frameworkRecommendation":null,"practiceFeedback":{"status":"unavailable","summary":"本次未提供可比较的前一轮转写，无法判断开头是否较前轮改善。","comparisonStatus":"unavailable","comparisonReason":"practiceComparison 的来源不可用，缺少前一轮转写内容，无法针对“确定本段要点并完成它”这一目标做前后对比。","previousEvidenceRefs":[],"currentEvidenceRefs":[]}}
```

## 4/8 · E07 · baseline · 第 1 次

状态：completed；HTTP：200；响应模型：deepseek-flash；耗时：3258 ms。

**助手评阅（不是模型返回）**

围绕反复改口影响开头清晰度反馈一条，并给出选定要点再讲完的动作。

- ‘最终没有确定’‘没有形成最终说法’仍把无法确认最终选择说得过于确定；因此单条结果不等于全部内容通过。

**模型原始返回（逐字保留）**

```json
{"schemaVersion":1,"assessment":{"status":"limited","reason":"材料只有一段开头练习的转写，能看出说话人在“上线时间”和“功能”之间反复改口，但尚未形成任何实质内容；没有音频和词级时间证据，只能评价文字中保留的起句表现，无法评价整篇组织、论证或声音节奏。","categories":["delivery"],"frameworkAssessable":false,"evidenceRefs":["s1"]},"summary":"这段开头在“上线时间”和“功能”之间来回改口，最终没有确定本段要讲哪一点。最值得练的是先选定一个要点，再把它说完。材料仅覆盖开头局部，未评价整篇完整性。","findings":[{"id":"common-1","category":"delivery","observation":"同一句里先说“上线时间”，随即改说“功能”，又退回“上线时间”，最后仍停在“先说功能”，多次重启没有形成最终说法。","interpretation":"听者无法确认本段到底要讲哪一点，开头没有起到定方向的作用。","recommendation":"开口前先选定“上线时间”或“功能”其中一个要点，只保留一次起句并把它讲完，不再中途换题。","example":null,"exampleEvidenceRefs":[],"evidenceRefs":["s1"]}],"frameworkSummary":null,"frameworkFindings":[],"frameworkRecommendation":null,"practiceFeedback":{"status":"unavailable","summary":"本次没有提供前一轮转写，无法比较所选开头目标的前后变化。","comparisonStatus":"unavailable","comparisonReason":"practiceComparison 的来源不可用，缺少前一轮可对照的转写内容，不能判断是否改善。","previousEvidenceRefs":[],"currentEvidenceRefs":[]}}
```

## 5/8 · E05 · moved · 第 2 次

状态：completed；HTTP：200；响应模型：deepseek-flash；耗时：4012 ms。

**助手评阅（不是模型返回）**

两个独立论证问题保留，但第三条‘关系没有交代’仍重复因果依据不足。

- ‘两件事之间的关系没有交代’混淆了已表达的因果判断与缺少支持该判断的依据；该类偏差在基线也出现，不能全部归因于位置移动。
- 补充样本、时间范围的建议具体，但不据此确认所有此类信息都是本题必要条件。

**模型原始返回（逐字保留）**

```json
{"schemaVersion":1,"assessment":{"status":"analyzable","reason":"材料虽短，但已包含明确主张（应全量推广首页改版）和一条因果依据，足以评价论点与组织；无音频与逐字时间证据，不评价节奏、停顿或声音表现。","categories":["organization","argument"],"frameworkAssessable":false,"evidenceRefs":["s1","s2"]},"summary":"表达有明确结论，但把同期发生的两件事直接当成唯一因果，并据此要求立即全量推广，论证跳跃最值得关注。材料无音频，本次只评文字层面的组织与论证。","findings":[{"id":"common-1","category":"argument","observation":"原文只给出“试点组上月订单增加了”和“同期我们更换了首页”两个事实，随后说“可以确定订单增长完全是首页改版带来的”。","interpretation":"同期发生不等于因果，听者无法排除其他影响因素，也难以接受“完全”这一排他结论。","recommendation":"下一轮先说明订单增长还可能受哪些因素影响，再给出能区分首页改版作用的依据，并把结论改为与证据相符的程度。","example":null,"exampleEvidenceRefs":[],"evidenceRefs":["s1","s2"]},{"id":"common-2","category":"argument","observation":"从试点组的一次增长直接得出“应该立即全量推广”，中间没有交代试点范围、推广条件或风险。","interpretation":"听者难以判断全量推广的依据是否充分，也无法评估立即执行的风险。","recommendation":"补充试点覆盖的样本与时间范围，并说明全量推广前需要确认的条件或验证步骤；若这些信息尚未确定，如实说明待确认。","example":null,"exampleEvidenceRefs":[],"evidenceRefs":["s1","s2"]},{"id":"common-3","category":"organization","observation":"“试点组上月订单增加了”与“同期我们更换了首页”并列陈述后，直接跳到“因此”的结论。","interpretation":"两件事之间的关系没有交代，听者需要自行猜测为何由它们推出结论。","recommendation":"在事实与结论之间加一句说明两者的关联依据，或先交代判断思路再给结论。","example":null,"exampleEvidenceRefs":[],"evidenceRefs":["s1","s2"]}],"frameworkSummary":null,"frameworkFindings":[],"frameworkRecommendation":{"framework":"prep","reason":"本次任务是向团队完整论证一个推广主张，按观点、理由、证据、重申观点的顺序组织，可让结论与依据的对应关系更清楚。","evidenceRefs":["s1","s2"]}}
```

## 6/8 · E05 · baseline · 第 2 次

状态：completed；HTTP：200；响应模型：deepseek-flash；耗时：4157 ms。

**助手评阅（不是模型返回）**

两个独立论证问题保留；第三条组织反馈与因果依据不足重复。

- 用‘缺少把事实与结论连接起来的说明’另列组织问题，仍未区分表达关系与论证支撑；与当前已知重复模式一致。

**模型原始返回（逐字保留）**

```json
{"schemaVersion":1,"assessment":{"status":"analyzable","reason":"材料虽短，但已包含明确的推广主张和一条因果依据，足以评价论证与组织；无音频，无法评价节奏与声音表现。","categories":["organization","argument"],"frameworkAssessable":false,"evidenceRefs":["s1","s2"]},"summary":"表达有明确主张，但把同期发生直接当成唯一原因，并据此要求立即全量推广，论证跳跃明显。最值得关注的是补上因果判断的依据与推广条件，而不是增加篇幅。","findings":[{"id":"common-1","category":"argument","observation":"原文由“试点组订单增加”和“同期更换首页”直接推出“完全是首页改版带来的”，未说明两者之间的因果依据。","interpretation":"听者无法判断订单增长是否可能来自其他因素，结论的确定程度超出已有依据。","recommendation":"补充你实际掌握的因果线索，或把结论改为与证据相符的表述，并说明还需排除哪些其他解释。","example":null,"exampleEvidenceRefs":[],"evidenceRefs":["s1","s2"]},{"id":"common-2","category":"argument","observation":"在因果尚未确认时直接提出“应该立即全量推广”，未交代推广的判断条件或风险考虑。","interpretation":"听者难以评估为何此时全量推广是合理选择，也无法确认是否需要先验证。","recommendation":"说明全量推广前需要满足的条件或验证步骤；若尚未确定，可如实说明待确认信息。","example":null,"exampleEvidenceRefs":[],"evidenceRefs":["s1","s2"]},{"id":"common-3","category":"organization","observation":"先陈述订单增加和首页更换两项事实，随后才给出结论与推广建议，中间缺少把事实与结论连接起来的说明。","interpretation":"听者需要自行猜测两项事实为何共同指向推广决定，理解路径不清晰。","recommendation":"在事实与结论之间加一句说明你的判断依据，再给出推广建议。","example":null,"exampleEvidenceRefs":[],"evidenceRefs":["s1","s2"]}],"frameworkSummary":null,"frameworkFindings":[],"frameworkRecommendation":{"framework":"prep","reason":"本次任务要求完整论证一个推广主张，PREP 能帮助先亮明观点，再给出理由和依据，最后回到推广结论，正好对应目前因果依据不足的问题。","evidenceRefs":["s1","s2"]}}
```

## 7/8 · E07 · baseline · 第 2 次

状态：completed；HTTP：200；响应模型：deepseek-flash；耗时：2937 ms。

**助手评阅（不是模型返回）**

一条反馈保留主要障碍及具体练习动作，没有靠不报告问题达成少条数。

- ‘尚未确定’‘最终没有落到一个要点上’仍超出现有片段对最终选择的证明能力。

**模型原始返回（逐字保留）**

```json
{"schemaVersion":1,"assessment":{"status":"limited","reason":"本次只有一句转写，内容是在两个开头方向之间反复切换，能看出局部开头的表达意图，但尚未形成可评价的完整汇报开头；无音频与时间信息，只能评价文字中保留的重启现象。","categories":["delivery"],"frameworkAssessable":false,"evidenceRefs":["s1"]},"summary":"本次是局部开头练习，转写在“先说上线时间”和“先说功能”之间多次来回，尚未确定本段要点。最值得关注的是先选定一个要点并把它说完。无音频，不评价停顿或语速。","findings":[{"id":"common-1","category":"delivery","observation":"同一句开头在“先说上线时间”和“先说功能”之间反复切换，还夹着“刚才那个先不说”，最终没有落到一个要点上。","interpretation":"听者无法确认本段究竟要讲哪一点，开头没有完成选定方向的作用。","recommendation":"下一轮先在心里选定一个要点，开头只说出这个要点并接着讲完，不再回头改选。","example":null,"exampleEvidenceRefs":[],"evidenceRefs":["s1"]}],"frameworkSummary":null,"frameworkFindings":[],"frameworkRecommendation":null,"practiceFeedback":{"status":"unavailable","summary":"本次没有可用的前一轮转写，无法比较开头重启是否改善。","comparisonStatus":"unavailable","comparisonReason":"practiceComparison 来源不可用，缺少前一轮同目标的开头转写，无法判断变化。","previousEvidenceRefs":[],"currentEvidenceRefs":[]}}
```

## 8/8 · E07 · moved · 第 2 次

状态：completed；HTTP：200；响应模型：deepseek-flash；耗时：3982 ms。

**助手评阅（不是模型返回）**

组织与重启仍是同一开头障碍，两条建议都要求先确定要点再一次讲完。

- 摘要与观察中的‘尚未确定’‘未明确选定’仍说得过满；与基线共有，不能称为本次移动新产生的错误。

**模型原始返回（逐字保留）**

```json
{"schemaVersion":1,"assessment":{"status":"limited","reason":"本次只有一句转写，内容是汇报开头时反复切换“先说上线时间”和“先说功能”，能看出说话人正在确定本段讲哪一点，但尚未形成可评价的完整表达。训练目标明确限定为“只练汇报开头，要求先确定本段讲哪一点”，因此只评价这一局部目标，不检查整篇完整性、论证或结尾。无音频与时间证据，不评价停顿、语速或情绪。","categories":["organization","delivery"],"frameworkAssessable":false,"evidenceRefs":["s1"]},"summary":"本次材料只覆盖汇报开头的局部练习，说话人尚未确定先讲哪一点，开头在“上线时间”和“功能”之间来回切换。最值得关注的是先把本段要点定下来并直接说出，再展开内容。评价仅限该局部目标，不涉及整篇结构。","findings":[{"id":"common-1","category":"organization","observation":"开头在“先说上线时间”和“先说功能”之间来回切换，最后仍以“还是先说功能……”收住，未明确选定本段要点。","interpretation":"听者无法确认这一段究竟先讲哪一点，开头难以起到引导作用。","recommendation":"下一轮先在心里选定一个要点，开头只说出这一句，例如明确“本段先讲功能”或“本段先讲上线时间”，再继续。","example":null,"exampleEvidenceRefs":[],"evidenceRefs":["s1"]},{"id":"common-2","category":"delivery","observation":"同一开头多次重新起句，出现“先说上线时间，先说功能，不，还是说上线时间”等反复撤回，最终说法仍未稳定。","interpretation":"反复重启使开头推进受阻，听者需要等待才能知道最终要讲什么。","recommendation":"练习时先停一下确定要点，再用一句话完整说出开头，不中途改口；可只录这一句开头反复练到一次说定。","example":null,"exampleEvidenceRefs":[],"evidenceRefs":["s1"]}],"frameworkSummary":null,"frameworkFindings":[],"frameworkRecommendation":null,"practiceFeedback":{"status":"unavailable","summary":"本次没有可用的前一轮转写，无法比较所选开头目标是否改善。","comparisonStatus":"unavailable","comparisonReason":"practiceComparison 标注来源不可用，未提供前一轮转写内容，无法与本次开头表现对照。","previousEvidenceRefs":[],"currentEvidenceRefs":[]}}
```
