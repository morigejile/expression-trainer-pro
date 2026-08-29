# 平台与硬件支持矩阵

> 状态：PKG-01 selection baseline
> 更新日期：2026-08-29
> 适用阶段：内部开发/测试；只有完成对应制品验证后才形成公开支持承诺

## 1. 首个 Tier 1 目标

| 维度 | 选择 | 当前证据 |
|---|---|---|
| OS | Windows 11 25H2 或更新的仍受支持版本 | 当前开发机为 Windows 11 Home x64，build 26200；Microsoft 将 build 26200 对应到 25H2 |
| 架构 | x64 | Electron smoke、Sherpa native-load、三候选 benchmark 均在 Windows x64 完成 |
| 应用运行时 | Electron 43.4.1 / sherpa-onnx-node 1.13.3 | lockfile、Electron smoke、D-03 与模型准备证据 |
| 安装形态 | Electron Forge Windows x64 制品 | PKG-02 开始实现；尚无安装包证据 |

选择 Windows x64 是维护资源与现有证据的收敛，不代表 Electron 或 Sherpa 只能运行在该平台。Electron 官方说明 v23 起要求 Windows 10 或更高版本；项目进一步选择仍在 Microsoft 服务期内且与当前 build 一致的 Windows 11 25H2+。Electron 43 是最后提供 Windows x86 预构建的系列，因此本项目不为短期兼容增加 x86 制品和验证成本。

参考：

- [Electron Windows 7/8/8.1 removal](https://www.electronjs.org/docs/latest/breaking-changes/)
- [Electron 43 platform notice](https://www.electronjs.org/blog/electron-43-0)
- [Microsoft supported Windows client versions](https://learn.microsoft.com/en-us/windows/release-health/supported-versions-windows-client)

## 2. 支持等级

| 等级 | 平台 | 当前含义 |
|---|---|---|
| Tier 1 target | Windows 11 25H2+ x64 | PKG-02～PKG-04 的唯一关键路径；当前是开发运行基线，安装/升级支持尚待制品证据 |
| Experimental | Windows on ARM64 | Electron 可提供目标架构，但 Sherpa native addon、Forge 制品、麦克风和模型未验证 |
| Experimental | macOS x64/arm64 | 未验证 native addon、权限、公证、音频设备和制品；不阻塞 Windows 路线 |
| Experimental | Linux x64/arm64 | 未验证发行版依赖、Wayland/X11、native addon、音频设备和制品；不阻塞 Windows 路线 |
| Unsupported | Windows x86、Windows 7/8/8.1、Linux armv7 | 不投入构建和回归资源 |

Experimental 表示源码可能可移植，但项目不承诺可安装、可识别或可升级。PKG-06 必须在对应 OS/arch 上产生 package + smoke + native model 证据后才能提升等级。

## 3. 硬件资格线

首个 Windows x64 制品按以下保守资格线进入 PKG-03 验证：

- x64 CPU，至少 4 个物理核心；
- 8 GB RAM；
- 首次模型准备前至少 3 GB 可用磁盘；
- 可被 Chromium `getUserMedia` 访问的麦克风；
- 首次安装默认模型时可访问 registry 中的 HTTPS 下载源。

这是一条待验证下限，不是已证明的性能承诺。当前实测开发机为 Intel Core Ultra 9 185H（16 核/22 线程）、约 32 GB RAM、Windows 11 build 26200，明显高于资格线；BM-02 只证明该环境下 Paraformer 平均 RTF 为 0.0540。PKG-03 必须在接近资格线的设备或可复核环境测量真实录音、初始化、RTF、峰值 RAM 与 UI 响应；不达标时优先上调资格线，不在没有 profile 的情况下改模型或传输架构。

## 4. 提升为可发布 Tier 1 的条件

- Windows x64 Forge package/make 在干净环境可重复；
- 制品启动并通过 Electron smoke，utility process 可加载 native addon；
- 首次默认模型下载、校验、native 初始化和离线二次启动成功；
- 升级保留 settings、custom prompt 和已安装模型；
- 真实 16/44.1/48 kHz 麦克风至少形成一次设备证据；
- 签名、模型许可和公开隐私说明仍可作为发布待办，但不阻塞前述内部技术闭环。
