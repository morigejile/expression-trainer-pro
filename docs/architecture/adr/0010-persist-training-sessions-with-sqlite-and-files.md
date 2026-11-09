# ADR-0010: 使用 SQLite 与受管文件持久化训练 Session

- Status: Accepted
- Date: 2026-09-16

## Context

新产品基线要求训练记录跨重启恢复、支持历史查询和删除，并为后续版本化度量、AI 分析和对比保留稳定事实。当前实现只在 Renderer 内存中保存最多五条记录，音频引用是进程内 Blob URL，退出后无法恢复。

Session 元数据、逐字稿、片段、生命周期和来源信息需要事务与查询；音频文件体积较大并适合流式写入。项目仍是本地优先、单用户桌面应用，不需要服务端数据库或本地 HTTP 服务。

## Decision

M1 使用嵌入式 SQLite 保存训练 Session 的身份、状态、逐字稿、稳定片段、Artifact 元数据和来源/版本信息；使用应用数据目录下的受管文件保存音频。

- SQLite schema 带版本并执行受支持的单向迁移。
- 音频通过 staging、关闭/刷新、完整性元数据和原子重命名完成发布。
- 数据库只保存受管相对路径和 Artifact 状态，不把音频 Blob 写入数据库。
- 设置、外观、自定义规则和模型管理继续使用现有版本化 JSON store，不在 M1 搬迁。
- Renderer 只通过 Preload/Application API 获取序列化数据和受控播放能力，不直接访问数据库或任意文件路径。
- M1 存储基础选用当前 Node/Electron 运行时内置的 `node:sqlite`，不增加 npm binding 或 native ABI 重建；具体限制与验证见[训练存储实现](../current.md#10-m1-training-storage-foundation)。

## Alternatives

1. **每个 Session 一个 JSON 文件并扫描目录**：实现启动简单，但历史排序、状态查询、级联删除、迁移和后续版本化派生结果会形成自建索引与事务逻辑。
2. **单一 JSON 索引加音频文件**：沿用现有 store 风格，但并发/中断写、局部更新、查询和损坏隔离会集中在一个持续增长的文件。
3. **把音频作为 SQLite BLOB**：能获得单一事务边界，但会放大数据库、备份、流式读写和损坏恢复成本，当前没有收益证据。
4. **独立本地服务或服务端数据库**：增加端口、协议、生命周期、安装和安全边界，单用户本地 M1 不需要。
5. **继续仅保存在内存中**：不能满足 R-P01–R-P07；入口收敛 R-P08/R-P09 也需要落到同一 M1 用户流程中。

## Consequences

### Positive

- Session 元数据具备事务、迁移和可查询历史。
- 大音频保持流式文件语义，避免数据库膨胀。
- 持久化层仍是本机自包含，不引入账号或服务运维。
- 后续 MetricRun、AIAnalysis 和 Comparison 可以按需要加入，而 M1 不必提前设计完整表结构。
- 桌面运行时和语音执行层可独立替换。

### Negative

- 依赖运行时内置 SQLite API，需要在 Electron 升级时验证打包可用性；若后续运行时不提供兼容 API，再替换 repository 内部 binding，不预建通用适配层。
- 数据库事务与文件系统操作无法形成一个原子事务，需要 staging、状态和启动恢复协议。
- 删除和损坏恢复必须同时处理数据库与 Artifact 文件。

## Validation

M1 完成前必须验证：

- 选定 binding 可在开发和 packaged Electron 环境中打开、迁移和查询数据库；
- 完成 Session 在完整重启后可读取；
- 中断 finalisation 不产生健康的 completed 记录；
- 缺失/损坏音频只降级对应 Artifact，不阻塞健康 Session；
- 删除操作覆盖数据库子项与受管文件，并对部分失败可重试；
- 更高的未知 schema 不被静默降级或覆盖。

## References

- [Product requirements](../../product/requirements.md)
- [Training data model](../data-model.md)
- [Target architecture](../target.md)
- [M1 milestone](../../milestones/m1-training-persistence.md)
