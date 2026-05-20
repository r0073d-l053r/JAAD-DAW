# ADR-0006: Cloud Headless Rendering & Remote App Ecosystem

- **Status**: 🟡 Proposed
- **Date**: 2026-05-20
- **Author**: Antigravity & USER

## Context & Problem Statement

As projects grow in size—incorporating dozens of tracks, heavy automation lanes, real-time filters, and generative clips—local browser environments can struggle during the final export mixdown stage. A client-side render can take minutes and lock the browser main thread, or even crash due to Web Audio allocation limitations on low-end hardware.

Additionally, studio workflows benefit from multi-surface controls: users want to adjust faders, hit record, or toggle mute buttons from a mobile device while sitting in front of a microphone, separate from their primary desktop screen.

We need a strategy for:
1. **Cloud Headless Rendering**: Offloading massive project rendering to server instances.
2. **Project Bundling (.JAAD)**: (Accepted/Active) Unified single-file archives containing the JSON project state and binary assets.
3. **Mobile Remote App**: A secondary responsive viewport acting as a wireless transport controller.

## Proposed Decision

We will address scalability and workflow control through cloud render nodes, WebSocket telemetry sync, and unified file bundling.

### 1. Cloud Headless Rendering

For heavy projects, users can choose "Export via Cloud":
- **Serialization**: The client bundle (.jaad) containing Firestore metadata, track schemas, and source audio files is packaged.
- **Microservice Render**: The bundle is posted to a Node.js/C++ cloud server utilizing `Web Audio API` headless servers or a JUCE-based command-line renderer.
- **Return**: The server processes the mixdown 10x faster using high-capacity processors, uploads the finished `.wav` to Firebase Storage, and returns a secure download link.

### 2. Project Bundling (.JAAD) - *Accepted & Implemented*

We have implemented a unified single-file archive using `JSZip`:
- **File Format**: The `.jaad` archive is generated client-side by packaging a project state metadata file (`project.json`) and a dedicated folder for all audio clips (`/assets/[asset_id].audio`).
- **Deep Link Restorations**: Deep-linking project IDs directly pull this bundled zip from Firebase Storage, unpack the assets local-first into IndexedDB, and route them to the Web Audio engine in a single pipeline.

### 3. Mobile Remote App

To create a second-screen controller, we will deploy a responsive mobile-optimized sub-client:
- **WebSocket Synchronization**: The mobile app links to the active project session using a QR code (matching the current project ID: `?project=PROJECT_ID`).
- **Transport controls**: The interface exposes large, tactile buttons for Play, Stop, Record, Loop, and individual track faders.
- **Low-Latency Communication**: Interaction events are pushed over the WebSocket signaling room, immediately updating the primary desktop client's faders and playhead position.

## Alternatives Considered

- **Peer-to-Peer Mobile Remote**: Syncing mobile devices and desktops via WebRTC data channels directly. *Rejected* due to complex local network discovery hurdles (NAT traversal). WebSocket rooms on our cloud signaling server are more reliable and function across different networks.

## Consequences

- **Positive / What We Gain**:
  - Massive project exports are guaranteed to succeed, regardless of client-side device constraints.
  - Excellent workflow mobility: remote control allows vocalists to track and record without standing next to their laptop.
  - Clear, unified file representation (.jaad) makes sharing projects across different installations simple and safe.
- **Negative / Trade-offs**:
  - Cloud rendering requires server maintenance and creates processing queues if demand is high.
  - Storing massive binary `.jaad` bundles on cloud storage increases Firestore/Firebase storage cost (mitigated by template demo restrictions and user quotas).
  - The Mobile Remote requires active WebSocket connections, which can experience packet loss on unstable Wi-Fi networks.
