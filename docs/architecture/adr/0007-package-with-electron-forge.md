# ADR-0007: 使用 Electron Forge 形成发布制品

- Status: Accepted
- Date: 2026-08-19
- Accepted: 2026-08-29

## Context

当前项目的安装、native module、模型放置和升级尚未形成可复现闭环。普通用户不应安装 Node、npm、Sherpa、Python 或编译器。项目需要统一 package/make 入口，并按真实支持矩阵生成平台制品。

## Decision

采用 Electron Forge 管理 Electron packaging、native module rebuild 和平台 makers。先选定一个 Tier 1 平台打通：干净构建、安装、首次模型下载、升级保留数据、卸载和启动 smoke；通过后再扩展平台矩阵。

模型默认与应用制品解耦。签名、公证、自动发布和自动更新作为后续 release gates，只有在凭据、平台和维护责任明确后启用。

## Alternatives

1. **手写打包脚本**：依赖少但容易遗漏 native rebuild、资源和平台差异。
2. **electron-builder**：成熟可行，但当前没有证据表明它比已推荐的 Forge 更能降低本项目成本。
3. **只发布源码**：不满足普通用户安装目标。

## Consequences

### Positive

- package/make/rebuild/maker 配置集中，便于 CI 和复现。
- 官方 makers 可生成平台特定制品。
- 可以逐步加入签名和发布，而不自建完整流水线。

### Negative

- 增加 Forge 及对应 makers 的开发依赖。
- 不同平台通常仍应在对应平台构建和签名。
- `sherpa-onnx-node` 共享库、ASAR unpack 和外部模型路径必须显式验证。

## Validation and follow-up

- [x] 干净环境 `npm ci` 后执行 Forge package/make 成功；packaged Fake smoke 和 utility-only Sherpa native-load smoke 通过。
- [x] 安装制品在当前 Windows 11 25H2+ x64 开发机启动并加载 native addon；接近最低资格线环境保留为非阻塞 follow-up。
- [x] 首次模型下载、完整性门禁、native 初始化和强制离线二次启动通过；中途网络错误支持严格 Range 续传。
- [ ] 覆盖安装/升级保留设置与模型；卸载行为有文档。
- [x] SBOM/许可证清单延后到正式发布阶段；内部测试制品不增加独立审计流程。

## References

- [Electron Forge configuration](https://www.electronforge.io/config/configuration)
- [Electron Forge makers](https://www.electronforge.io/config/makers)
