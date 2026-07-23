# Architecture Decision Records (ADRs)

Welcome to the **JAAD Architecture Decision Records (ADRs)** index. 

Rather than relying on a flat, low-context checklist, JAAD-DAW utilizes Architecture Decision Records to capture significant technical and design choices. Each ADR details the context of a feature or architecture area, the proposed/accepted solution, its status, and the consequences (trade-offs) of that choice.

This directory serves as the source of truth for the architectural evolution of this DAW.

---

## 🚦 Status Definitions

- 🟡 **Proposed**: Under discussion, active design exploration.
- 🟢 **Accepted**: Approved, actively being implemented or in production.
- 🔴 **Rejected**: Explored but discarded due to technical or design trade-offs.
- 🔵 **Superseded**: Replaced by a newer architectural choice or ADR.
- ⚪ **Deprecated**: No longer recommended, planned for removal.

---

## 📂 Active Records Index

| ID | Title | Status | Primary Component | Last Updated |
| :--- | :--- | :---: | :--- | :--- |
| **0001** | [Adopt Architecture Decision Records](0001-record-architecture-decisions.md) | 🟢 Accepted | Architecture / Docs | 2026-05-20 |
| **0002** | [Web Audio API Real-time FX Pipeline](0002-web-audio-api-fx-pipeline.md) | 🟢 Accepted | DSP / Audio Engine | 2026-06-11 |
| **0003** | [Generative AI Music Composition Pipelines](0003-generative-ai-composition.md) | 🟢 Accepted | AI Copilot / Gemini API | 2026-06-11 |
| **0004** | [Real-time Multiplayer Collaboration Engine](0004-real-time-collaboration.md) | 🟡 Proposed | Sync / Networking | 2026-05-20 |
| **0005** | [Professional DSP Tools & Outer Platform Bridges](0005-professional-tools-and-dsp.md) | 🟢 Accepted | DSP / Visuals / Cloud | 2026-06-11 |
| **0006** | [Cloud Headless Rendering & Remote App Ecosystem](0006-cloud-rendering-and-ecosystem.md) | 🟡 Proposed | Render Engine / Mobile | 2026-05-20 |
| **0007** | [Unit Testing Framework & Component Mocking Strategy](0007-unit-testing-framework-and-component-strategy.md) | 🟢 Accepted | Testing / QA | 2026-05-20 |
| **0008** | [Wine VST Server — Real Parameter Knobs & noVNC Plugin GUI](0008-vst-server-knobs-and-novnc.md) | 🟡 Proposed | DSP / VST Bridge | 2026-07-04 |
| **0009** | [Suno-Grade Stem Separation via a Self-Hosted Demucs Sidecar](0009-demucs-stem-separation.md) | 🟢 Accepted | AI / Stems | 2026-07-04 |
| **0010** | [On-Device (WebGPU/WASM) Stem Separation Tier](0010-browser-webgpu-stem-separation.md) | 🟢 Accepted | AI / Stems | 2026-07-07 |

---

## 🛠 Contributing a New ADR

When suggesting a significant change or planning a new module, please create a new ADR using the following template:

```markdown
# ADR-[Number]: [Title]

- **Status**: [Proposed / Accepted / Rejected / Superseded]
- **Date**: YYYY-MM-DD
- **Author**: [Your Name]

## Context & Problem Statement
Describe the problem we are solving, the context, technical constraints, and user experience requirements.

## Proposed Decision
Detail the chosen solution, architectural patterns, schemas, or tech stack items.

## Alternative Options Considered
What other choices did we have? Why did we choose this one over the others?

## Consequences
- **Positive / What We Gain**: Good outcomes, easier paths.
- **Negative / Trade-offs**: Tech debt, performance overhead, maintenance costs.
- **Risks**: Potential issues, Web Audio API limitations, browser support.
```
