# Changelog

本文件记录应用版本的维护者可见变化。应用与安装制品版本以 `package.json#version` 为唯一来源；模型版本独立记录，不随应用版本隐式变化。

## Unreleased

- 增加独立 Appearance 配置、四套主题、coach-rail/focus-hud 双布局、跨窗口同步和响应式窗口尺寸；布局切换保留训练 DOM、状态与滚动位置。
- 增加三款 streaming ASR 的受信任 Catalog/Factory、独立选择存储、启动恢复、单 controller 切换与失败回退。
- 增加独立模型安装 utility、受限设置窗口 IPC 和模型管理界面；安装支持进度、取消与重试，Renderer 只提交受信任模型 ID。
- 增加显式 Internal Only 的 Zipformer Large 包内默认构建与离线导入资格路径；内部安装包使用 `ExpressionTrainerInternalOnly` 名称、只接受项目树外的 Catalog 固定归档，普通制品会全局排除并在 ASAR 验收时拒绝已支持的模型权重/归档；同时修复只读模型状态查询创建空 `models` 目录的回归。
- 为文本分析、实时反馈、最终报告统计和 Markdown 保存增加轻量 IPC 类型/大小边界；Markdown 默认文件名只接受普通 `.md` 文件名。
- 收敛当前架构、需求和 Roadmap：删除已完成的实施计划、已吸收的多模型设计规格与临时 benchmark 范围说明，只保留当前事实、稳定需求编号、决策证据、未完成工作和外部门禁。
- 修复升级生命周期验证脚本对旧设置模块的失效引用，并清理已经不存在的发布载荷排除项。

## 1.0.1 - 2026-08-29（内部测试）

- 建立 Windows 11 x64 Electron Forge/Squirrel 安装制品的 1.0.0→1.0.1 升级、旧完整安装器降级边界、当前版本恢复和卸载数据保留证据（基线提交 `7a26b5c`）。
- 修复首次安装 smoke 在应用版本升级后仍查找 `app-1.0.0` 的问题（`cec6099`）。
- 增加用户主动触发的固定白名单诊断 JSON，记录环境、active 模型、采样率、ASR 初始化耗时和错误类别，不导出用户内容（`8e559d4`）。
- 默认产品模型保持 `paraformer-bilingual-zh-en/2024-03-10`，未改变模型选择。
- 相关决策：[ADR-0004](docs/architecture/adr/0004-manage-models-separately.md)、[ADR-0005](docs/architecture/adr/0005-select-default-asr-model-by-benchmark.md)、[ADR-0007](docs/architecture/adr/0007-package-with-electron-forge.md)。

## 1.0.0 - 2026-08-29（内部基线）

- 首个 Windows x64 Squirrel 安装、真实 Paraformer 首次准备和离线二次启动基线（`40a0cf8`）。
- 该版本仅作为内部升级兼容基线，不是公开发布承诺。
