# ADR-0001: 保留 Electron 与原生 Web 技术栈

- Status: Accepted
- Date: 2026-08-19

## Context

应用需要跨平台桌面 UI、麦克风、本地文件、本地 Node native addon 和安装制品。当前实现已使用 Electron 与原生 JS/HTML/CSS，没有 React/Vue、Vite、TypeScript、服务端或数据库。

Electron 的 runtime 体积并非最小，但切换 Tauri/原生实现会引入 Rust/C++/FFI 或多平台构建链。当前首要目标是降低整个项目的长期维护与交付成本，而不是单独优化安装包体积。

## Decision

本轮架构演进保留 Electron + 原生 JavaScript/HTML/CSS。继续使用 Renderer/Preload/Main 权限模型，不引入前端框架或独立 bundler 作为默认方案。

## Alternatives

1. **Tauri/原生桌面**：可能减小 runtime，但显著扩大语言、FFI 和构建矩阵。
2. **纯浏览器 + WASM**：可能消除 native addon 和部分 IPC，但必须验证模型加载、缓存、性能和离线发布；不作为本轮默认路径。
3. **Electron + React/Vite/TypeScript**：可带来大型 UI 工程收益，但当前规模不足以抵消依赖和升级成本。

## Consequences

### Positive

- 保留现有 UI 和团队认知，允许渐进重构。
- Node API 可直接承载设置、模型管理和 Sherpa 集成。
- 一个技术栈覆盖 Windows/macOS/Linux 的主要应用逻辑。

### Negative

- Electron 基础体积和内存开销继续存在。
- 必须持续维护 Chromium/Electron 安全升级与 native module 兼容性。
- 各平台仍需各自构建、签名和安装验证。

## Validation and Revisit

- Electron Forge 的 Tier 1 制品必须可重复构建并通过启动/升级测试。
- 若 Electron + Sherpa native addon 连续无法满足支持矩阵，或 WASM spike 在性能、体积和维护成本上有显著证据优势，新建 ADR 复审，不直接改写本记录。

## References

- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron Forge](https://www.electronforge.io/)
