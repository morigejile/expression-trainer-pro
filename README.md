# 🚀 宇宙无敌表达训练系统 - 本地桌面版

> 👉 **在线版已上线：[exprtrain.online](https://exprtrain.online)**，无需安装，打开浏览器即用。支持中英双语。

## 项目文档

- [需求基线](docs/requirements/requirements.md)
- [架构入口](docs/architecture/README.md)
- [当前架构（As-Is）](docs/architecture/current.md)
- [架构决策记录（ADR）](docs/architecture/adr/README.md)
- [开发路线图](docs/roadmap.md)
- [开发与可复现安装](docs/development.md)
- [版本变更记录](CHANGELOG.md)

一个帮你训练口语表达精准度的本地桌面应用。实时语音识别与词库分析在本地完成；AI 反馈是可选能力，除 Ollama 外通常需要网络。

## 功能

- 🎤 **实时语音识别**：基于 Sherpa-ONNX，完全离线，中文优化
- 📦 **模型管理**：在设置中安装、取消、重试和切换三款受信任的 streaming ASR 模型
- 🎨 **外观与布局**：四套主题及 coach-rail/focus-hud 两种响应式布局
- 📝 **全屏字幕显示**：黑底大字，实时显示你说的每一句话
- 🔍 **词库分析**：自动检测填充词、犹豫词、笼统词，给出精准替代
- 🤖 **AI反馈**：支持 OpenAI、DeepSeek、Ollama 与自定义 OpenAI-compatible 后端
- 🎧 **录音回放与同步分析**：本次运行期间保留最近五条录音，播放时按片段同步显示已完成的大模型建议
- 🔁 **多组 LLM 配置**：保存并快速切换多组模型配置；切换后可主动重新分析同一条录音
- 📊 **分析报告**：6维度深度分析（逻辑/直接性/填充词/密度/词汇/亮点）
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

- 录音、逐字稿时间轴和回放分析只保存在本次应用运行期间，不写入训练历史文件；关闭应用会释放全部录音资源。
- 应用最多保留五条已完成录音；第六条完成时按先进先出顺序自动释放最老录音及其 Blob URL。
- 单条录音最长 20 分钟；达到上限后按正常结束流程整理尾部文字并生成可回放记录。
- 第一次点击“开始录制”时，应用会在申请麦克风权限前显示上述保留策略；只有确认后才继续。帮助页面会长期保留相同说明。
- 云端 LLM 只接收逐字稿、片段标识和片段起止时间，不接收 PCM、WAV、Blob URL 或原始录音；本地 ASR 和词库分析不依赖云端 LLM。
- 回放区模型下拉框只显示模型名。切换配置不会自动请求；点击“重新分析”后才使用所选配置分析当前录音，成功后替换该录音上一份回放分析，失败时保留旧结果。播放过程本身不会触发推理。

## 字幕颜色含义

| 颜色 | 含义 |
|------|------|
| 🔴 红色波浪下划线 | 填充词（嗯、啊、那个、然后…） |
| 🟠 橙色 | 犹豫词（可能、也许、我觉得…） |
| 🟡 黄色虚线 | 笼统词（有精准替代建议） |
| 🟢 绿色 | 有力表达（好句子！） |

## 技术架构

```
Renderer / Web Audio / UI
        │ 受控 Preload API
        ▼
Electron Main（窗口、设置、分析、LLM 路由、ASR 控制器）
        │ session-aware IPC
        ▼
ASR Utility Process（单一当前 Sherpa Provider）
        │
        ├── 独立短生命周期 Model Install Utility
        └── appData/expression-trainer-pro-models 中的版本化 Catalog 模型
```

Main 不加载 Sherpa native addon，也不执行同步识别；音频采集在 Renderer 的独立 `AudioCapture`/AudioWorklet 中完成，ASR 推理在 utility process 中隔离。完整职责、数据流和已知技术债见[当前架构](docs/architecture/current.md)。

## 词库说明

运行时数据由两个明确的真相源组成：

- `data/emotion-lexicon.json`：146 个情绪词，包含分类、强度和极性；
- `shared/expression-rules.js`：16 个填充词、14 个犹豫词和 20 组笼统词替代映射，Renderer 高亮与 Main 分析共同使用。

未接入运行时的数据不放在活跃 `data/` 目录，避免被误认为产品能力或进入发布包。

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
│   ├── asr.js           # Paraformer adapter
│   ├── asr-provider.js  # ASR provider 契约
│   ├── asr-process-controller.js # Main 到 utility process 的控制边界
│   ├── asr-utility-process.js    # 独立 ASR 执行入口
│   ├── model-manager.js # 模型下载、校验、激活与回退
│   ├── lexicon.js       # 词库匹配
│   ├── ai-feedback.js   # AI反馈
│   └── prompts.js       # Prompt模板
├── shared/              # Renderer/Main 共用的确定性规则
├── data/                # 运行时情绪词数据
├── models/registry.json # 产品模型清单（权重位于 userData）
├── smoke/               # 发布包内使用的最小 Electron smoke 驱动
├── test/                # 不进入发布包的自动测试
├── benchmark/           # 不进入发布包的独立模型评测工具
└── docs/                # 需求、当前架构、ADR、路线图与开发说明
```

## 系统要求

- 已验证开发基线：Windows 11 25H2 build 26200 x64
- Node.js 24.20.x（Active LTS）、npm 11.19.x（该 Node LTS 官方捆绑版本）
- 麦克风权限
- （可选）网络连接（用于AI反馈，词库分析可离线）

首个 Tier 1 目标为 Windows 11 25H2+ x64；当前未签名内部 Squirrel 制品已通过 packaged smoke、静默安装、真实模型首次准备、离线二次启动和 1.0.0→1.0.1 升级/卸载数据保留验证。公开支持仍需签名、真实设备及对应环境待办。Windows ARM64、macOS 和 Linux 为 Experimental，详见[平台与硬件支持矩阵](docs/support-matrix.md)。

## License

MIT

