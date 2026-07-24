# ADR-0003: Generative AI Music Composition Pipelines

- **Status**: 🟢 Accepted
- **Date**: 2026-05-20
- **Author**: Antigravity & USER

## Context & Problem Statement

JAAD is designed as an AI-powered DAW ("The GAW Experience"). While it currently supports simple chatbot instructions and basic tempo detection, we must build creative generative tools to empower first-time and professional musicians alike:
1. **AI Vocal Harmony Generator**: Generate background harmonies for loaded vocal clips.
2. **Sonic Style Transfer**: Adjust project EQ/compression curves based on a reference track's acoustic signature.
3. **Intelligent Arrangement Engine**: Structure basic loops into standard song structures.
4. **Lyric-to-Vocal Guide Synthesis**: Generate realistic vocal guides from text and voice profiles.

We need a scalable pipeline that coordinates browser-side client interactions with high-performance model inferences.

## Proposed Decision

We will implement a hybrid architecture that splits generative tasks between local low-latency operations and high-fidelity cloud-based microservices using the Gemini API.

```
┌────────────────────────────────────────────────────────┐
│                      Client Browser                    │
│  - Captures parameters & sends requests                │
│  - Restores track structures via Redux-style store      │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTPS / WebSockets
                           ▼
┌────────────────────────────────────────────────────────┐
│               Gemini API / Cloud Backend               │
│  - Audio Isolation Models (Stem Extraction)            │
│  - Text-to-Speech / Lyric-to-Vocal Synthesis           │
│  - Acoustic Feature Extractor (Sonic Style Transfer)   │
└────────────────────────────────────────────────────────┘
```

### 1. Generative Features Specification

- **AI Vocal Harmony Generator**:
  - *Client*: Extracts selected vocal clip, isolates audio buffer, and triggers the harmony generation request.
  - *Backend*: Passes the source vocal and target scale/harmony profile (e.g. "Major 3rd Up + Perfect 5th Down") to a cloud pitch-shifting DSP service or an AI polyphonic vocal generation model, returning high-quality shifted stems.
- **Sonic Style Transfer**:
  - *Client*: User uploads a reference track.
  - *Backend*: Runs a Mel-Frequency Cepstral Coefficients (MFCC) feature extraction model to calculate average spectral balance, dynamic range, and reverb profiles.
  - *Integration*: Returns a JSON patch file representing recommended target EQ bands and master compressor ratios.
- **Intelligent Arrangement Engine**:
  - *Client*: Sends loop metadata (instrument tracks, midi patterns).
  - *AI Agent (Gemini)*: Analyzes composition structure and responds with a JSON-formatted template indicating where tracks should fade in/out, add transitions, or silence instruments to build standard song structures (e.g. Intro -> Verse -> Chorus).
- **Lyric-to-Vocal Synthesis**:
  - *Client*: Receives user text input and selected vocal profile.
  - *Backend*: Generates vocal synthesis using a text-to-speech voice clone trained for musical phrasing, outputting a transient WAV file returned directly to the timeline.

## Alternatives Considered

- **Fully Client-Side AI (Wasm WebNN)**: Running models like style transfer or vocal synthesis inside the user's browser using ONNX runtime. *Rejected* for heavy features due to download sizes (GBs of model weights) and lack of unified hardware acceleration on client browsers.
- **Pure Cloud Microservices**: Routing all metadata and raw stems immediately. *Accepted* as the primary pipeline, utilizing Firebase cloud storage for high-bandwidth audio transfers.

## Consequences

- **Positive / What We Gain**:
  - Minimal local CPU/GPU consumption; compatible with low-end laptops and mobile browsers.
  - Highly robust synthesis quality by utilizing state-of-the-art models in high-performance cloud server environments.
  - Seamless timeline integration: outputs are returned as standard `.wav` stems placed automatically on newly created track lanes.
- **Negative / Trade-offs**:
  - Cost overhead associated with cloud server processing and GPU runtimes.
  - Latency: vocal synthesis and harmony generation will not be instantaneous; requires high-fidelity loading overlays and progress indicators.
  - Requires reliable internet connection (mitigated by caching and read-only templates for offline modes).
