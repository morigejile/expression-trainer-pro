# M3 — Comparison & Review

> **Status:** First release implemented; automated and Windows package verification passed
> **Depends on:** M1 saved Sessions and M2 stable Report / Metric / Evidence contracts
> **Primary requirements:** R-R01–R-R02 first release; semantic Finding changes (B-25), R-R03/R-R04 remain deferred

## Goal and scope

让用户从训练历史选择两次表达，查看有证据支持的变化、原文与音频，并能进入任一侧完整报告后返回原比较。

产品交互只由 [Training Flow §13.2–§13.4](../product/training-flow.md#132-history-与-comparison--review) 定义；数据语义与兼容性由 [Data Model §10](../architecture/data-model.md#10-comparison-invariants) 定义。本文件负责实施切片、依赖与验收映射，不另建导航或指标规则。

## M2 baseline

M2 已于 2026-09-19 关闭，复用其保存事实和 V1 结果契约。设备、SenseVoice 与校准限制继续由原 Owner / Backlog 管理；M3 不回写旧结果，也不以完整雷达校准为前置条件。

## Design direction

现有稳定报告选择已提取为 [shared/report-selection.js](../../shared/report-selection.js)，供 Report 与 Comparison 共用；M3 Core、受控 IPC 和 History / Comparison / Report 产品流已接入。代码现状及验证边界统一见 [Current §14](../architecture/current.md#14-m3-comparison-and-review)。

首版采用 **Application Core 中的只读 Comparison 投影**：加载两侧已保存事实与所选快照，逐项验证兼容性，返回 Renderer 可展示的数据。报告选择规则应复用同一实现；不能在 Core/Renderer 各维护一套。Renderer 管理选择、展开、滚动和返回上下文，职责沿用 [Target §7](../architecture/target.md#7-analysis-architecture)。

这个方向无需新数据库表，也不在打开比较时发起 ASR/VAD/AI 或历史重算。持久化 Comparison 对象只有在确有保存比较的产品任务时才增加；每次使用统一版本重新分析两侧则会改变历史快照与调用成本，不作为首版默认。

用户已选择首版指标与证据复盘。D-13 和 R-R02 的首版范围已在对应 Owner 收敛；自动语义变化判断延期至 B-25。基线/目标与返回交互由 Flow 定义。

## Delivery slices

| 顺序 / ID | 实施内容 | 依赖与完成条件 |
|---|---|---|
| M3-01 | 收敛 D-13 与首版验收边界 | 兼容性矩阵有正常、缺失、不同来源/版本实例；明确 Finding 结论能力与 R-R02 口径；完成：规则与 fixture 已验证 |
| M3-02 | 只读 Comparison 用例与受控 IPC | 固定输入、复用稳定 Report 选择、逐项状态与证据引用；完成：离线 fixture、Application / IPC 和 UI 已验证；不新增存储表或远程调用 |
| M3-03 | History 两条选择、Comparison 与 Report 下钻返回 | 复用既有页面与报告；落实 Flow §13.2–§13.4、§13.6；完成：选择/焦点/滚动/展开恢复已有产品流验证 |
| M3-04 | 异常复核与阶段验收 | 完成：下表自动化、最终全量回归、Windows package / artifact smoke 已通过；边界见 Current §14 |

## Acceptance matrix

以下各项均已通过本轮首版自动化验收；具体执行证据与未验证边界见 Current §14。需求以 [Requirements §7](../product/requirements.md#7-m3历史对比复盘与-ai-对话) 为准。

| ID | 需求 / Owner | 核验重点 | 验证层 |
|---|---|---|---|
| AC-M3-01 | R-R01；Flow §13.2 | 0/1/2/3 条及以上选择；仅恰好两条可显式对比，三条及以上仍可批量删除；取消恢复、单条打开仍可用；跨 Framework 不拒绝整对 | 两条对比首版 Passed：Electron 产品流；多选／批量删除的后续接入证据见 [Current §19](../architecture/current.md#19-i4-history--comparison-接入)；跨 Framework 由 Core fixture 验证 |
| AC-M3-02 | R-R01；Data Model §10 | 两侧角色、Session/revision/Report/Run 固定；较新失败结果不替换既有可用报告；打开比较零分析调用、零事实修改 | Passed：comparison-application / session-comparison / structured-report |
| AC-M3-03 | R-R01/R-R02；Data Model §10.1 | 同口径、版本变化、词表变化/未知、ASR 差异、VAD 配置变化、单位/分母不同、零分母、缺失值；只输出获支持的差值 | Passed：session-comparison |
| AC-M3-04 | R-R02；Flow §13.3 | 两侧 Finding/Evidence 归属正确；局部 ID 冲突不串证据；缺少 Finding/AI 不代表问题消失；首版不生成跨录音语义结论，按已关闭 D-13 / R-R02 验收 | Passed：session-comparison / comparison-renderer |
| AC-M3-05 | R-R01/R-R02；Flow §13.3 | Ready/Partial/Unavailable；旧记录无结构化结果、单侧局部缺损、音频丢失、无 token timing、无 AI/离线时健康项仍可读 | Passed：fixture + Electron degraded/offline 产品流 |
| AC-M3-06 | R-R01；Flow §13.4/§13.6 | 两侧 Report 复用、返回原对象/位置/展开/焦点；Utility 关闭恢复；从 History 改选后新比较不串旧状态 | Passed：Electron 产品流 / comparison-renderer |
| AC-M3-07 | R-R01/R-R02；Data Model §10 | 加载失败可重试；失效/删除输入不替换成另一记录，不复活已删事实；异步迟到响应不污染后来发起的比较 | Passed：Application / Renderer 竞态与产品流 |
| AC-M3-08 | R-R01/R-R02；阶段交付 | 既有录音/保存/报告流程无回归；Windows 制品中可从已保存两条记录完成比较、下钻、返回与局部降级 | Passed：npm test / Windows package / PACKAGED_APP_SMOKE_OK |

## Out of scope

不增加趋势/Progress、Finding 对话、实时 AI、完整雷达校准、主页建议语速、Structured framework 分析、Practice Chain、报告导出或通用比较框架；对应重开条件只由 [Backlog](../product/backlog.md) 和既定后续里程碑维护。双录音 AI 分析和 Finding 语义变化判断明确延期至 B-25。

## Current evidence

实现与自动化/制品证据统一见 [Current §14](../architecture/current.md#14-m3-comparison-and-review)。首版完成不包含 B-25 的跨录音问题语义判断、真实用户人工交互验收或扩展设备资格；既有 M2 人工证据不冒充这些新验证。
