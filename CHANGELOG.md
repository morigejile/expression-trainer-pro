# Changelog

本文件记录应用版本的维护者可见变化。应用与安装制品版本以 `package.json#version` 为唯一来源；模型版本独立记录，不随应用版本隐式变化。

## Unreleased

- 暂无。

## 1.0.1 - 2026-08-29（内部测试）

- 建立 Windows 11 x64 Electron Forge/Squirrel 安装制品的 1.0.0→1.0.1 升级、旧完整安装器降级边界、当前版本恢复和卸载数据保留证据（基线提交 `7a26b5c`）。
- 修复首次安装 smoke 在应用版本升级后仍查找 `app-1.0.0` 的问题（`cec6099`）。
- 默认产品模型保持 `paraformer-bilingual-zh-en/2024-03-10`，未改变模型选择。
- 相关决策：[ADR-0004](docs/architecture/adr/0004-manage-models-separately.md)、[ADR-0005](docs/architecture/adr/0005-select-default-asr-model-by-benchmark.md)、[ADR-0007](docs/architecture/adr/0007-package-with-electron-forge.md)。

## 1.0.0 - 2026-08-29（内部基线）

- 首个 Windows x64 Squirrel 安装、真实 Paraformer 首次准备和离线二次启动基线（`40a0cf8`）。
- 该版本仅作为内部升级兼容基线，不是公开发布承诺。
