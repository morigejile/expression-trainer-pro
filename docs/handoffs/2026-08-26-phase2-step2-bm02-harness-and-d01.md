# Phase 2 Step 2 Handoff: BM-02 三候选公平 harness 与 D-01

- Status: Blocked until Step 1 freeze evidence exists
- Date: 2026-08-26
- Working tree: `D:\Codex_projects\expression-trainer-pro-bm02`
- Branch: `codex/benchmark/bm02-harness`
- Known starting HEAD: `4113b9d20d77b33211950fd2a88c9d33d853df76`
- Canonical architecture decision: `D:\Codex_projects\expression-trainer-pro\docs\architecture\adr\0008-keep-benchmark-as-isolated-non-shipping-tool.md`

## Entry condition

Step 1 必须已经给出：100 条全部人工确认的 frozen manifest、manifest digest、生成 commit SHA、三候选预测/失败字段契约。若缺少任一项，只做只读核对并报告，不用临时数据替代，也不提前跑正式排名。

## Objective

把 BM-02 从 fake adapter 骨架收敛为 Paraformer、small Zipformer、SenseVoiceSmall 的公平、可复跑 harness；在查看正式汇总结果前冻结 D-01 选型规则。完成实现与 dry-run，但不发布排名。

## Read first

1. 本 handoff、Step 1 完成报告和 ADR-0008。
2. `D:\Codex_projects\expression-trainer-pro-bm02\docs\superpowers\plans\2026-08-25-bm02-reproducible-harness.md`
3. 当前 `benchmark\run.js`、`benchmark\adapters\fake.js` 和 `benchmark\lib\`。
4. `D:\Codex_projects\expression-trainer-pro-model-prep\benchmark\models\` 下的 candidate registry 与验证工具。
5. Step 1 的 frozen manifest schema 和 digest 证据。

先核对 branch/HEAD/cleanliness。不要 reset，不要把 BM-01 或 model-prep 的整个目录手工复制进 BM-02；只实现或复用稳定契约，并在最终 integration 方案中说明来源 commit。

## Fixed D-01 policy

D-01 必须在正式聚合结果可见前写入版本化文档并记录 commit/hash：

- 基本门槛：Failure rate ≤ 5%，RTF ≤ 1。
- CER 是首要选型指标。
- CER 接近、差异落在重复运行波动范围内时，才以性能和资源占用作次级判断。
- Streaming UX 独立记录，不混入离线 CER 排名。
- License 不阻塞内部 benchmark；D-02 决定发布默认模型时是硬门槛。
- 不添加未经批准的综合加权分、多人审批或新候选。

建议 canonical 路径为 `docs\benchmark\d01-model-selection-policy.md`；若目录不存在可创建，但不要复制一套 Roadmap。

## Tasks

### 1. 统一候选与输入契约

- registry 中只激活三个候选，并锁定 model ID/version/hash、推理配置和模型根目录解析。
- 验证 frozen manifest digest；运行结果中记录 dataset digest、candidate digest、代码 commit、环境和命令参数。
- 不把 benchmark manifest 改造成产品 Model Manager schema。

### 2. 实现三个真实 adapter

- Paraformer、small Zipformer、SenseVoiceSmall 使用各自必要的 decode 路径。
- 共同实现同一 adapter contract、文本规范化、错误分类和超时语义。
- 一条样本或一个候选失败时仍写结果行，不中断并吞掉剩余证据。
- 不以“统一接口”为理由抽象插件平台、动态发现系统或独立 package。

### 3. 补齐公平运行控制

- CLI 明确接收 registry、model root、dataset manifest、output root、threads、timeout、repetitions 和 warm/cold 模式。
- 固定机器与线程；候选串行运行；每个候选有相同 repetitions 与超时策略。
- 每个 sample × candidate × repetition 都产生一条成功或失败记录。
- 记录 wall time、audio duration、RTF、CER 所需字段、peak memory/可获得资源指标；无法可靠采集的指标标为 unavailable，不伪造。
- 输出采用 create-new 语义，避免覆盖历史运行。

### 4. Dry-run

- 用少量 frozen 样本验证真实三个 adapter、失败保持、digest、重复性和结果 schema。
- dry-run 只用于修正 harness；不得据此发布排名或提前选择模型。

## Verification

以 TDD 实现 adapter/CLI/结果契约。至少执行：

1. adapter、candidate config、digest、timeout/failure、metrics/output 的聚焦测试。
2. 三候选真实最小 dry-run。
3. `npm test`、`npm run check`、`git diff --check`。
4. 检查产品运行时没有 import/require `benchmark/`。

验证应覆盖真实风险，不增加旧的双人审核、审计链或 approve-policy 门禁。

## Commit and stop rules

- 允许在 BM-02 分支本地提交实现、测试和 D-01。
- 不 merge、push、创建 PR，不发布候选排名。
- BM-03 不是本步骤依赖，不得阻塞推进。
- 完成后报告新 HEAD、D-01 path/hash、dataset digest、candidate digests、dry-run 证据以及 Step 3 的正式命令。

## Copy-paste prompt for the next session

```text
在 D:\Codex_projects\expression-trainer-pro-bm02 的 codex/benchmark/bm02-harness 分支执行 Phase 2 Step 2。先完整阅读 D:\Codex_projects\expression-trainer-pro\docs\handoffs\2026-08-26-phase2-step2-bm02-harness-and-d01.md、ADR-0008 和 Step 1 完成证据。只有 100 条 frozen manifest 与 digest 完整时才继续。实现 Paraformer、small Zipformer、SenseVoiceSmall 三个真实 adapter 和公平、可复跑 harness；在查看正式聚合结果前冻结 D-01：Failure≤5%、RTF≤1、CER 优先、性能/资源只作 CER 接近时次级判断、Streaming UX 单列、License 仅在 D-02 发布默认模型时成为硬门槛。完成真实小规模 dry-run，不发布排名。可本地提交，但不要 merge、push 或 PR，不让 BM-03 阻塞。
```
