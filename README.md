# 🚀 宇宙无敌表达训练系统 - 本地桌面版

## 项目文档

- [需求基线](docs/product/requirements.md)
- [文档职责矩阵与治理](docs/README.md)
- [当前架构（As-Is）](docs/architecture/current.md)
- [架构决策记录（ADR）](docs/architecture/adr/README.md)
- [开发路线图](docs/roadmap.md)
- [开发与可复现安装](docs/development.md)
- [版本变更记录](CHANGELOG.md)

一个帮你训练口语表达精准度的本地桌面应用。语音识别与词库分析在本地完成；AI 诊断是可选能力，在设置中为所选服务明确启用。AI 是否需要联网取决于实际服务地址。

## 当前已实现功能

本节是快速上手摘要；完整实现边界以 [Current As-Is](docs/architecture/current.md) 为准，目标产品不由本清单定义。

- 🎤 **实时语音识别**：基于 Sherpa-ONNX，模型安装后可完全离线识别，中文优化
- 📦 **模型管理**：三款流式 ASR 与可选 SenseVoice 整段识别，支持安装、取消、重试和切换；整段识别最长 5 分钟、结束后转写
- 🎨 **外观与布局**：四套主题及 coach-rail/focus-hud 两种响应式布局
- 📝 **全屏字幕显示**：黑底大字，实时显示你说的每一句话
- 🔍 **词库分析**：自动检测填充词、犹豫词、笼统词，给出精准替代
- 🤖 **AI反馈**：支持 OpenAI、DeepSeek、Ollama 与自定义 OpenAI-compatible 后端
- 🎧 **训练历史与回放**：录音、逐字稿和结果保存在本机，重启后可读取、播放和明确删除
- 🔁 **多组 LLM 配置**：保存并快速切换多组模型配置；切换后可主动重新分析同一条录音
- 📊 **分析报告**：独立语音活动区间、本地客观指标和带证据的四类 AI 发现；缺失结果明确显示，未校准雷达不生成分数
- 🩺 **诊断导出**：主动导出不含密钥、路径、音频或逐字稿的运行环境与 ASR 诊断 JSON
- 🆘 **应用内帮助与反馈**：提供快速使用说明、诊断导出和统一的在线“问题和建议”文档入口

## 安装

### 1. 克隆项目 & 安装依赖

```powershell
cd expression-trainer-pro
node --version  # 期望 24.20.x
npm --version   # 期望 11.19.x
npm ci
```

完整的版本、install-script 策略、验证证据与 TBD 见[开发与可复现安装](docs/development.md)。

### 2. 启动应用

```bash
npm start
```

首次使用默认模型时，应用会下载并校验 Catalog 中的 Zipformer Large；也可在设置页安装并选择 Paraformer 或 Zipformer Small。模型安装到 Electron `appData/expression-trainer-pro-models`（Windows 为 `%APPDATA%\expression-trainer-pro-models`），请预留下载与解包空间；内部开发阶段需要系统提供 `tar`。模型文件不进入 Git，详细边界见[开发与可复现安装](docs/development.md)。

### 3. 配置 AI 后端

启动后点击右上角 ⚙️ 进入设置页面。

推荐配置：

| 后端 | 费用 | 速度 | 获取方式 |
|------|------|------|----------|
| DeepSeek | 极低 | 快 | [platform.deepseek.com](https://platform.deepseek.com) |
| OpenAI | 中等 | 快 | [platform.openai.com](https://platform.openai.com) |
| Ollama | 免费 | 取决于硬件 | [ollama.com](https://ollama.com) 本地运行 |

**推荐 deepseek**：生成报告质量高，且成本极低。

## 使用说明

1. **点击「开始录制」** → 对着麦克风说话
2. **实时字幕**会在屏幕中央显示你说的内容
3. **左侧面板**实时统计填充词/犹豫词/笼统词
4. **右侧面板**每新增约30字会给出AI实时反馈
5. **说完后点击「结束」** → 可回放录音、按播放进度查看片段建议，也可以点「生成报告」获取完整分析

### 录音保留与云端分析说明

普通录音自动保存在本机，直到明确删除；关闭应用不删除记录，也没有五条上限。原始音频不发给远程 AI；自动诊断须单独启用，可发送当前逐字稿、证据区间、指标、质量和分析指令。VAD 首次分析按需安装模型，后续可离线复用。实现与验证边界见 [Current §13](docs/architecture/current.md#13-m2-analysis-pipeline)，仍待代表性语音校准、设备及外部服务联调。

## 字幕颜色含义

| 颜色 | 含义 |
|------|------|
| 🔴 红色波浪下划线 | 填充词（嗯、啊、那个、然后…） |
| 🟠 橙色 | 犹豫词（可能、也许、我觉得…） |
| 🟡 黄色虚线 | 笼统词（有精准替代建议） |
| 🟢 绿色 | 有力表达（好句子！） |

## 技术架构

运行边界与数据流统一见 [Current As-Is](docs/architecture/current.md)，目标组件见 [Target](docs/architecture/target.md)。架构选择理由见 [ADR](docs/architecture/adr/README.md)。

## 词库说明

情绪词数据位于 `data/emotion-lexicon.json`，填充词、犹豫词和笼统词规则位于 `shared/expression-rules.js`，Renderer 高亮与 Main 分析共用同一规则源。

## 开发

```bash
# 开发模式（带DevTools）
npm run dev

# 测试
npm test
```

运行时代码位于 `main.js`、`preload.js`、`src/`、`lib/`、`shared/`、`data/` 和 `models/`；`test/`、`benchmark/`、`scripts/` 与 `docs/` 不进入普通发布包。完整命令、版本和验证规则见[开发与可复现安装](docs/development.md)。

## 运行要求

- 当前 Tier 1 目标：Windows 11 25H2+ x64；
- 可被 Chromium 访问的麦克风权限；
- 首次安装模型需要网络；LLM 联网需求取决于所选后端，本地词库分析可离线。

具体已验证范围和 Experimental 平台见[平台与硬件支持矩阵](docs/support-matrix.md)。

## License

MIT
