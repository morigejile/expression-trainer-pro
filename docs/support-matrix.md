# 平台与硬件支持矩阵

> 状态：PKG-04 install/upgrade lifecycle baseline
> 更新日期：2026-08-31
> 适用阶段：内部开发/测试；只有完成对应制品验证后才形成公开支持承诺

## 1. 首个 Tier 1 目标

| 维度 | 选择 | 当前证据 |
|---|---|---|
| OS | Windows 11 25H2 或更新的仍受支持版本 | 当前开发机为 Windows 11 Home x64，build 26200；Microsoft 将 build 26200 对应到 25H2 |
| 架构 | x64 | Electron smoke、Sherpa native-load、七候选 benchmark 均在 Windows x64 完成 |
| 应用运行时 | Electron 43.4.1 / sherpa-onnx-node 1.13.3 | lockfile、Electron smoke、D-03 与模型准备证据 |
| 安装形态 | Electron Forge/Squirrel Windows x64 制品 | PKG-03 已执行静默安装、真实 Paraformer 准备/native 初始化和强制离线二次启动；PKG-04 已验证 1.0.0→1.0.1 升级、数据保留、当前版本恢复与卸载策略 |

选择 Windows x64 是维护资源与现有证据的收敛，不代表 Electron 或 Sherpa 只能运行在该平台。Electron 官方说明 v23 起要求 Windows 10 或更高版本；项目进一步选择仍在 Microsoft 服务期内且与当前 build 一致的 Windows 11 25H2+。Electron 43 是最后提供 Windows x86 预构建的系列，因此本项目不为短期兼容增加 x86 制品和验证成本。

参考：

- [Electron Windows 7/8/8.1 removal](https://www.electronjs.org/docs/latest/breaking-changes/)
- [Electron 43 platform notice](https://www.electronjs.org/blog/electron-43-0)
- [Microsoft supported Windows client versions](https://learn.microsoft.com/en-us/windows/release-health/supported-versions-windows-client)

## 2. 支持等级

| 等级 | 平台 | 当前含义 |
|---|---|---|
| Tier 1 target | Windows 11 25H2+ x64 | 未签名内部制品已有安装、真实模型和升级/卸载证据；签名、真实设备与公开支持口径仍待完成 |
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

这是一条待验证下限，不是已证明的性能承诺。当前实测开发机为 Intel Core Ultra 9 185H（16 核/22 线程）、约 32 GB RAM、Windows 11 build 26200，明显高于资格线；BM-02 只证明该环境下 Paraformer 平均 RTF 为 0.0540。PKG-03 在该高配机完成了技术闭环，但不外推最低性能；接近资格线设备上的真实录音、初始化、RTF、峰值 RAM 与 UI 响应继续作为非阻塞环境待办，不达标时优先上调资格线。

## 4. 提升为可发布 Tier 1 的条件

- [x] Windows x64 Forge package/make 在干净环境可重复；
- [x] 制品启动并通过 Electron smoke，utility process 可加载 native addon；
- [x] 首次默认模型下载、校验、native 初始化和离线二次启动成功；
- [x] 1.0.0→1.0.1 升级保留 settings、custom prompt 和已安装模型；Squirrel 卸载保留外部 userData；
- 真实 16/44.1/48 kHz 麦克风至少形成一次设备证据；
- 签名、模型许可和公开隐私说明仍可作为发布待办，但不阻塞前述内部技术闭环。

## 5. 升级与降级边界

支持的更新路径是向前安装当前或更新版本。PKG-04 实测手工运行旧版完整 Squirrel Setup 会以退出码 0 将应用二进制从 1.0.1 降回 1.0.0；旧安装器无法由新版本追溯加固。设置、自定义规则和模型位于安装目录外，安装器降级及卸载过程本身没有删除这些数据；但旧应用随后显式保存配置时仍可能按旧 schema 覆盖未来字段。若误运行旧 Setup，重新运行当前 Setup 可恢复当前应用版本，不能恢复已经被旧应用覆盖的数据。

本矩阵只记录平台、硬件、安装与制品证据。配置 schema 兼容性由 requirements、current architecture 和对应迁移测试维护，不在支持矩阵重复承诺。
