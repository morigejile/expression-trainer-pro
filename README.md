# 🚀 宇宙无敌表达训练系统 - 本地桌面版

> 👉 **在线版已上线：[exprtrain.online](https://exprtrain.online)**，无需安装，打开浏览器即用。支持中英双语。

## 项目文档

- [需求基线](docs/requirements/requirements.md)
- [架构入口](docs/architecture/README.md)
- [当前架构（As-Is）](docs/architecture/current.md)
- [目标架构（To-Be）](docs/architecture/target.md)
- [架构决策记录（ADR）](docs/architecture/adr/README.md)
- [开发路线图](docs/roadmap.md)
- [开发与可复现安装](docs/development.md)
- [版本变更记录](CHANGELOG.md)

一个帮你训练口语表达精准度的本地桌面应用。实时语音识别与词库分析在本地完成；AI 反馈是可选能力，除 Ollama 外通常需要网络。

## 功能

- 🎤 **实时语音识别**：基于 Sherpa-ONNX，完全离线，中文优化
- 📝 **全屏字幕显示**：黑底大字，实时显示你说的每一句话
- 🔍 **词库分析**：自动检测填充词、犹豫词、笼统词，给出精准替代
- 🤖 **AI反馈**：支持 OpenAI、DeepSeek、Ollama 与自定义 OpenAI-compatible 后端
- 📊 **分析报告**：6维度深度分析（逻辑/直接性/填充词/密度/词汇/亮点）
- 🩺 **诊断导出**：主动导出不含密钥、路径、音频或逐字稿的运行环境与 ASR 诊断 JSON

## 安装

### 1. 克隆项目 & 安装依赖

```powershell
cd expression-trainer-pro
node --version  # 期望 22.23.x
npm --version   # 期望 12.0.x
npm ci
```

完整的版本、install-script 策略、验证证据与 TBD 见[开发与可复现安装](docs/development.md)。

### 2. 启动应用

```bash
npm start
```

首次开始录音时，应用会自动下载并校验 Sherpa-ONNX streaming Paraformer 中英双语模型（archive 约 1.05 GB），安装到 Electron `userData/models`。请预留下载与解包空间；内部开发阶段需要系统提供 `tar`。模型文件不进入 Git，详细边界见[开发与可复现安装](docs/development.md)。

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
5. **说完后点击「结束」** → 可以点「生成报告」获取完整分析

## 字幕颜色含义

| 颜色 | 含义 |
|------|------|
| 🔴 红色波浪下划线 | 填充词（嗯、啊、那个、然后…） |
| 🟠 橙色 | 犹豫词（可能、也许、我觉得…） |
| 🟡 黄色虚线 | 笼统词（有精准替代建议） |
| 🟢 绿色 | 有力表达（好句子！） |

## 技术架构

```
┌─────────────────────────────────────────┐
│ Electron 主进程                          │
│  ├── Sherpa-ONNX (离线语音识别)          │
│  ├── 词库匹配 (emotion-lexicon.json)     │
│  └── AI反馈 (多后端 HTTP API)            │
├─────────────────────────────────────────┤
│ 渲染进程 (Chromium)                      │
│  ├── 全屏字幕显示                        │
│  ├── 实时统计面板                        │
│  └── 分析报告弹窗                        │
└─────────────────────────────────────────┘
```

## 词库说明

`data/emotion-lexicon.json` 基于大连理工情感词库7大类结构，包含：

- **130+ 情绪词**：分类（喜怒哀惧恶惊）+ 强度（1-9）
- **笼统词→精准词映射**：25组高频替代建议
- **填充词表**：24个常见口头禅
- **犹豫词表**：19个弱化表达
- **程度词梯度**：弱→中→强→极 四级
- **画面化描述**：10组「抽象→具象」转换
- **犹豫→直接转换**：8组对照示例

## 开发

```bash
# 开发模式（带DevTools）
npm run dev

# 测试
npm test

# 目录结构
├── main.js              # Electron主进程
├── preload.js           # preload脚本
├── src/
│   ├── index.html       # 主界面
│   ├── settings.html    # 设置页
│   ├── styles.css       # 样式
│   ├── app.js           # 前端逻辑
│   └── settings.js      # 设置逻辑
├── lib/
│   ├── asr.js           # 语音识别
│   ├── asr-provider.js  # ASR provider 契约
│   ├── lexicon.js       # 词库匹配
│   ├── ai-feedback.js   # AI反馈
│   └── prompts.js       # Prompt模板
├── data/
│   ├── emotion-lexicon.json
│   └── tiered-lexicon.json # 候选分层词库，当前未启用
└── models/              # 版本化产品模型 registry（权重位于 userData）
```

`tiered-lexicon.json` 作为候选数据资产保留；其 schema 与当前分析器不同，必须在独立测试任务中设计合并规则后才能启用。

## 系统要求

- 已验证开发基线：Windows 11 25H2 build 26200 x64
- Node.js 22.23.x、npm 12.0.x
- 麦克风权限
- （可选）网络连接（用于AI反馈，词库分析可离线）

首个 Tier 1 目标为 Windows 11 25H2+ x64；当前未签名内部 Squirrel 制品已通过 packaged smoke、静默安装、真实模型首次准备、离线二次启动和 1.0.0→1.0.1 升级/卸载数据保留验证。公开支持仍需签名、真实设备及对应环境待办。Windows ARM64、macOS 和 Linux 为 Experimental，详见[平台与硬件支持矩阵](docs/support-matrix.md)。

## License

MIT

