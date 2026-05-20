# ADR-0005: Professional DSP Tools & Outer Platform Bridges

- **Status**: 🟡 Proposed
- **Date**: 2026-05-20
- **Author**: Antigravity & USER

## Context & Problem Statement

To transition from a creative hobbyist tool to a professional-grade DAW, JAAD must implement advanced visualization, multimedia capability, and hardware/software interoperability:
1. **Spectrogram Analysis View**: High-resolution spectral analysis of audio clips.
2. **Video-to-Audio Sync**: A dedicated video track allowing scoring and sound design.
3. **VST/AU Cloud Bridge**: Access desktop plugins from our web client.
4. **Advanced Sidechaining UI**: A routing patch bay for dynamic interaction (e.g. Kick ducking Bass volume).

These features push the boundaries of browser memory, graphics processing, and standard Web Audio limits.

## Proposed Decision

We will address these advanced DSP requirements through WebGL acceleration, HTML5 multimedia integration, and server-side VST processing sidecars.

### 1. Spectrogram Analysis View

To render high-resolution spectrograms without lagging the main thread, we will use a **WebGL Shader Pipeline**:
- *DSP Analysis*: Clip audio buffers are segmented and processed using an offline Fast Fourier Transform (FFT) in a Web Worker.
- *Visual Rendering*: The output matrix of FFT magnitude bins is converted into a floating-point texture and passed to a WebGL fragment shader.
- *Performance*: GPU-bound texture interpolation generates ultra-smooth, responsive frequency-time-amplitude heatmaps directly overlaying the timeline clip items.

### 2. Video-to-Audio Sync

We will introduce a specialized `<video>` synchronizer in `audioEngine.ts`:
- *Timeline Integration*: A new `VideoTrack` contains a pointer to an uploaded MP4/WebM file stored locally in IndexDB or our asset cache.
- *Synchronization Loop*: The HTML5 `<video>` element is muted, and its `currentTime` is strictly bound to the DAW `audioEngine` playhead time using a high-precision `requestAnimationFrame` timing loop:
  ```javascript
  video.currentTime = audioEngine.getCurrentTime();
  ```
- *Audio Routing*: The audio track of the video (if used) is extracted via `MediaElementAudioSourceNode` and routed into the Mixer.

### 3. VST/AU Cloud Bridge

Since web browsers cannot natively execute compiled `.vst` or `.component` desktop binaries due to sandbox restrictions, we will construct a **Dockerized Remote VST Processor**:

```
┌────────────────────────────────┐
│           Client DAW           │
│  - Sends raw audio chunks      │
│  - Sends automation params     │
└──────────────┬─────────────────┘
               │ WebSockets (low latency)
               ▼
┌────────────────────────────────┐
│      Docker Cloud DSP Node     │
│  - Headless JUCE host wrapper  │
│  - Loads native VST/AU plugins │
│  - Renders audio & sends back  │
└────────────────────────────────┘
```
- *Signaling*: Automation sliders in the DAW UI transmit parameter changes via WebSockets.
- *Audio Transport*: Audio chunks are sent to the sidecar, processed through the hosted plugin, and returned to the client, utilizing a custom latency-compensation buffer.

### 4. Advanced Sidechaining Routing

We will implement a virtual **Patch Bay Route Matrix**:
- In the Mixer UI, users can expand a track's FX panel and select a "Sidechain Source" dropdown.
- *Web Audio Routing*: The source track's Web Audio output node is split using a `ChannelSplitterNode` or connected directly into the `DynamicsCompressorNode` sidechain input port (the `.gain` or `reduction` sidechain connector) of the target track.

## Alternatives Considered

- **Wasm Compilation of VSTs**: Porting native C++ plugins to WebAssembly. *Rejected* because commercial plugins are closed-source and cannot be compiled to WASM. A headless cloud-side DSP node is the only viable method for standard third-party plugins.

## Consequences

- **Positive / What We Gain**:
  - Unmatched web DAW capabilities, enabling film scoring and advanced professional audio analysis.
  - Integration with professional desktop plugins (VST/AU) directly from a Chromebook or tablet.
  - Dynamic sidechaining is accomplished entirely on the client-side utilizing native Web Audio biquad/compressor hooks, ensuring zero-latency ducking.
- **Negative / Trade-offs**:
  - The VST Cloud Bridge introduces network latency and requires high-bandwidth internet connections.
  - Substantial cloud hosting costs for GPU/CPU intensive sidecar servers.
  - Video rendering is dependent on client browser decoding capabilities (e.g. lack of native HEVC support in Chrome on some platforms).
