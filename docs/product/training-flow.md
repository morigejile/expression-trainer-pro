# Training and Report Flow

> **Status:** M0 target product-flow baseline
> **Date:** 2026-09-16
> **Applies to:** M1 voice-only entry cleanup, M2 Speech Evidence/default AI report foundation, and M4 Structured Training extension
> **Does not describe:** the currently implemented Renderer state; see [Current Architecture](../architecture/current.md). The dated [UI state audit](../reviews/ui-state-audit-2026-09-02.md) is historical review evidence, not a current-state authority.

## 1. Purpose and authority

This document is the canonical interaction definition for choosing how to train, freezing a session, presenting framework guidance, composing the report, and moving from one attempt to the next.

- Verifiable product outcomes and priority belong in [Requirements](../requirements/requirements.md).
- Field ownership, immutability, and comparison invariants belong in [Training Data Model](../architecture/data-model.md).
- Component ownership and analysis boundaries belong in [Target Architecture](../architecture/target.md).
- This document owns the user-visible flow between those definitions.

It is a target baseline, not a claim that PREP, STAR, Pyramid, re-analysis, or the report structure already exists.

## 2. Expression mode model

The product has one training flow with two training modes:

```text
Expression Training
├── Free                              default
└── Structured
    ├── PREP
    ├── STAR
    └── Pyramid                       displayed as 金字塔 in Chinese UI
```

Free is the no-configuration default. PREP, STAR, and Pyramid are frameworks inside Structured; they are not independent applications or separate session types.

The setup UI may present the choices in one compact selector, but the conceptual grouping must remain visible. Adding frameworks must not turn the page into an ever-growing row of top-level modes.

## 3. Training setup

### 3.1 Default state

On entry:

```text
trainingMode = free
framework = none
trainingPrompt = none
input = microphone
```

The primary start action is available in that state. The user does not need to understand a framework or provide a topic before practising. M1 exposes no topic/scenario input and therefore persists `trainingPrompt = null`; user-supplied or generated training prompts begin with the accepted M4 flow.

The target product has no pasted-text entry. The homepage also omits the current “复制”“保存”“清空” controls. Deleting a durable Session is a distinct history/detail action and is never represented by a generic homepage clear button.

### 3.2 Training prompt and framework are independent

A training prompt is optional user-visible context, not an LLM instruction and not a prerequisite. It can be:

- absent, which is the default;
- a user-supplied topic;
- a user-supplied scenario;
- an application-generated topic requested by the user;
- an application-generated scenario requested by the user.

Valid combinations include Free with no training prompt, Free with a generated topic, PREP with no training prompt, PREP with a user topic, and STAR with a generated scenario. Choosing a framework must not silently create or require a training prompt; requesting a training prompt must not silently choose a framework.

Training-prompt generation is an optional action such as “给我一个题目” or “给我一个场景”. If generation is unavailable or fails, the user can still start without it.

### 3.3 Framework suitability is guidance

Framework definitions may explain typical uses:

| Framework | Typical fit |
|---|---|
| PREP | viewpoints, judgements, and answers to “why” |
| STAR | experiences, behaviour, interviews, and retrospectives |
| Pyramid | reports, proposals, complex information, and layered arguments |

These descriptions guide selection. They are not routing rules: an interview prompt does not force STAR, and the application does not infer a framework and start it without user confirmation.

## 4. Guidance before training

When the user selects Structured, the page may add a lightweight Guidance card. For example, PREP may show `Point → Reason → Example → Point`, and STAR may show `Situation → Task → Action → Result`.

Guidance:

- explains the framework goal and sequence;
- may offer a short example or preparation cue;
- does not require the user to fill one input for every framework step;
- does not generate assessment findings before evidence exists;
- uses preparation language rather than report language.

A future step-by-step form would be a separately accepted training experience. It must not be introduced by turning the baseline Guidance card into mandatory fields.

## 5. Session state and frozen choices

```text
Preparing
  ├── choose Free or Structured framework
  ├── add, generate, replace, or remove training prompt
  └── start recording
          ↓ snapshots and freezes training context
Recording (Paused is a substate) → Processing
          ↓
Report
```

- Mode, framework, and training prompt can change in Preparing.
- Microphone training freezes them when recording starts.
- Recording, Paused, Processing, and the completed Session never mutate those choices.
- Choosing a different framework after start means stopping/cancelling as currently allowed and creating a new Session; it never relabels the active or completed Session.

The persisted invariants are defined in [Training Data Model](../architecture/data-model.md).

## 6. Analysis layers

How the user trained and how the product analyses the result are separate concepts.

### 6.1 Common Analysis

Every analyzable Session receives the Common Analysis layer. It answers how well the expression worked on shared dimensions such as fluency/rhythm, clarity/precision, concision/focus, and organisation/coherence, subject to the definitions accepted for M2.

Free can identify a late conclusion, weak support, poor order, repetition, or broken transitions as general organisation problems. It must not mark PREP `E` missing, STAR `R` incomplete, or apply another framework template unless the user explicitly requests that framework re-analysis.

### 6.2 Framework Analysis

A Structured Session adds the analysis for the framework selected at training time:

- PREP checks the presence, order, balance, and support of Point/Reason/Example/Point;
- STAR checks Situation/Task/Action/Result and whether actions and outcomes are concrete;
- Pyramid checks conclusion-first organisation, grouping, hierarchy, support, overlap, and omission.

Framework Analysis answers how the selected framework was used. It does not replace Common Analysis and does not re-score unrelated speaking problems.

### 6.3 AI Coaching

AI Coaching is part of the default completed-session path. After required local evidence is ready, the application automatically requests a structured AI diagnosis from the active valid profile. A remote profile is valid for automatic use only after the user has enabled it with a disclosure of the provider and transmitted data categories; a local profile must not be described as cloud transmission. AI Coaching explains important evidence, suggests a concrete improvement, may demonstrate a revision, and recommends a next exercise or framework.

If no valid profile exists, or the provider is unavailable, the report shows a visible setup/failed state and a retry path while retaining local facts and Common Analysis. AI Coaching consumes facts and validated analysis results; it does not become a separate unversioned source of measured scores.

## 7. One report skeleton

Free and Structured use the same report composition:

```text
Report
├── Summary
├── Common Analysis
├── Framework Analysis             only when one has been run
├── Evidence
├── AI Coaching
└── Next Training
```

The first layer prioritises three answers:

1. 这次怎么样？
2. 最需要改什么？
3. 下一轮练什么？

Detailed metrics, framework maps, transcript, timeline, analyzer/model provenance, and extended AI explanation use progressive disclosure below that layer. Structured mode inserts its framework section; it does not switch to a different report application.

A framework section should expose which part worked or failed rather than only a total score. A PREP or STAR sequence map and a Pyramid hierarchy map are valid presentations, but the exact visual form is not frozen here.

## 8. Evidence anchoring

A report finding should link to the strongest available evidence:

```text
finding
  └── transcript segment
        ├── character/token span when available
        ├── timestamp or audio range when available
        └── explanation of the finding-to-evidence relationship
```

Framework findings follow the same rule as Common findings. If precise timing is unavailable, the report links to the transcript segment and labels timing as unavailable or approximate; it never invents precision.

## 9. Recommendation, re-analysis, and re-training

A Free report may recommend a framework when the evidence supports it. The recommendation explains why and waits for the user to choose.

The follow-up actions are distinct:

| Action | Effect |
|---|---|
| “用 PREP 查看分析” | Runs a new PREP Framework Analysis over the existing Session evidence; the Session remains Free |
| “用 PREP 再练一次” | Opens a new Preparing state with PREP selected; starting creates a new Structured Session |

Re-analysis does not edit the original audio, transcript, training prompt, training mode, or framework. Re-training does not reuse or overwrite the original Session identity. The UI must not label both actions as a generic “切换到 PREP”.

## 10. Comparison rules

| Result | Allowed comparison |
|---|---|
| Facts | When the same fact and evidence definitions are meaningful on both Sessions |
| Common metrics/findings | Across Free and Structured when definition/analyzer versions are compatible, or after recomputation with one compatible version |
| Framework-specific results | Only within the same framework and a compatible analyzer version |

PREP, STAR, and Pyramid totals are not a shared quality scale. A difference between their scores must not be presented as improvement or regression.

When versions or evidence are incompatible, the report explains why the result is not comparable instead of forcing a number.

## 11. Framework extension contract

Adding a framework extends the framework layer with:

1. a stable framework ID and versioned definition;
2. selection label and suitability guidance;
3. optional training-time Guidance content;
4. a versioned Framework Analysis contract and evidence mapping;
5. a section contribution to the shared report;
6. same-framework comparison compatibility rules.

It reuses the existing Preparing/Recording/Processing/Report flow, `TrainingSession`, Common Analysis, AI Coaching, evidence model, and report skeleton. A new framework does not justify a new top-level training mode, independent report architecture, or framework-specific persistence subsystem.

## 12. Traceability

- Product requirements: R-P08–R-P09, R-A04, R-A07–R-A11, R-R01/R-R04, and R-F01–R-F08 in [Requirements](../requirements/requirements.md)
- Fact and derived-data ownership: [Training Data Model](../architecture/data-model.md)
- Component boundaries: [Target Architecture](../architecture/target.md)
- Milestone ordering: [Roadmap](../roadmap.md)
