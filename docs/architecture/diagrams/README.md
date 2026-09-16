# 架构图集（Archify 交付）

本目录由 [archify](https://github.com/tt-a1i/archify) 技能生成，规格（JSON）与制品（HTML）成对保存。
每张图都按 `--quality showcase` 校验通过 9/9 项制品检查（single_svg、finite_svg、orthogonal_arrows、
label_route_clearance、relationship_crossings、relationship_corridors、container_border_runs、
route_rhythm、legend_clearance）。单文件 HTML 内含明暗主题、平移缩放、搜索、聚焦、关系追踪与导出。

## 源文件与再生成策略

- `*.json` 是可编辑规格，`*.html` 是提交到仓库的可浏览发布制品；保留 HTML 使阅读者不必安装生成工具。
- 修改图时，以同名 JSON 作为输入，通过 Archify 技能重新生成并覆盖 HTML，然后执行其制品检查和桌面尺寸 visual check。
- `*.visual-check.*` 截图、回执和联系表只用于本地验收，属于可再生成的临时输出，已由 `.gitignore` 排除，不进入文档源树。
- As-Is 图必须在源码边界变化后重新生成或在本页明确标为历史快照；不能仅修改文字说明而继续把旧图称为当前架构。

| 图 | 类型 | 规格 | 制品 | 画布 | 首屏包含性（1440/1600/1920/2048） |
|---|---|---|---|---|---|
| 当前架构（As-Is） | architecture | `architecture.json` | `architecture.html` | 1530 × 664 | 全部通过 |
| 系统总览 | architecture | `system-overview.json` | `system-overview.html` | 1550 × 654 | 全部通过 |
| 一次录音训练流程 | workflow | `workflow.json` | `workflow.html` | 720 × 1024 | **未通过**（见下） |
| 本地交付流程 | workflow | `delivery-workflow.json` | `delivery-workflow.html` | 720 × 776 | **未通过**（见下） |
| 音频块调用链 | sequence | `sequence.json` | `sequence.html` | 1900 × 1040 | 全部通过 |
| 训练会话与界面状态 | lifecycle | `lifecycle.json` | `lifecycle.html` | 1100 × 630 | 全部通过 |
| ASR 模型服务状态机 | lifecycle | `asr-model-state-machine.json` | `asr-model-state-machine.html` | 1200 × 655 | 全部通过 |
| 从音频到报告的数据流 | dataflow | `dataflow.json` | `dataflow.html` | 1140 × 610 | 全部通过 |

## 事实来源

| 图 | 主要证据 |
|---|---|
| 当前架构 | `main.js`、`preload.js`、`lib/asr-*.js`、`lib/model-*.js`、`docs/architecture/current.md` |
| 系统总览 | `main.js`、`preload.js`、`models/registry.json`、`docs/architecture/current.md` §3、`docs/development.md` |
| 一次录音训练流程 | `src/app.js` 的 `startRecording` / `completeRecordingStop` / `generateReport`、`docs/reviews/ui-state-audit-2026-09-02.md`（历史审计） |
| 本地交付流程 | `package.json` scripts、`forge.config.js`、`scripts/verify-*.js`、`docs/development.md`、`docs/roadmap.md`（OPS-01 / PKG-05） |
| 音频块调用链 | `lib/asr-ipc.js`、`lib/asr-process-controller.js`、`lib/asr-session.js`、`lib/asr-utility-process.js`、`preload.js` |
| 训练会话与界面状态 | `docs/reviews/ui-state-audit-2026-09-02.md`（历史审计中的 S0–S5 与失败回退）、`src/app.js` |
| ASR 模型服务状态机 | `lib/asr-model-service.js`（idle / initializing / ready / switching / unavailable / disposed 与回滚路径） |
| 从音频到报告的数据流 | `docs/architecture/current.md` §6、`lib/lexicon.js`、`lib/ai-feedback.js`、`models/registry.json` |

## 两张流程图未通过首屏包含性（如实记录）

`workflow.html` 与 `delivery-workflow.html` 在四个桌面尺寸下页面高度均大于视口高度，因此
`visual-check` 的 `containment` 为 `fail`（退出码 1）：

| 制品 | 1440×900 | 1600×1000 | 1920×1080 | 2048×1320 |
|---|---|---|---|---|
| `workflow.html` | 2263 ✗ | 2360 ✗ | 2360 ✗ | 2384 ✗ |
| `delivery-workflow.html` | 1800 ✗ | 1875 ✗ | 1875 ✗ | 1905 ✗ |

原因是 workflow 渲染器的画布固定：泳道宽 640px、每泳道高 104px。7 条泳道的画布纵横比只能是
720×1024 ≈ 0.70，5 条泳道是 720×776 ≈ 0.93；而响应式阅读宽度最小值为 960px，要把页面压进
900px 高的视口需要约 1.64 的纵横比。合并泳道或把画布人为加宽（右侧留 40%–60% 空白）才能换来
包含性，但会牺牲职责边界的真实性与版面平衡，因此保留现状。两张图仍可正常浏览、导出与打印，
只是首屏需要向下滚动。
