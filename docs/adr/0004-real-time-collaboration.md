# ADR-0004: Real-time Multiplayer Collaboration Engine

- **Status**: 🟡 Proposed
- **Date**: 2026-05-20
- **Author**: Antigravity & USER

## Context & Problem Statement

Modern creative tools are shifting toward real-time collaboration (e.g. Figma, Google Docs). For JAAD-DAW, users want to co-create music synchronously:
1. **Live Presence Cursors**: See collaborator cursors and names moving across the timeline.
2. **In-Project Version Comments**: Leave timestamped comments on specific tracks/times (e.g., "Adjust vocals at 01:23").
3. **Synchronous Timeline State**: Seamlessly propagate moving, deleting, splitting, or volume changes of clips across all connected clients.

This requires a fast, conflict-free state synchronization engine.

## Proposed Decision

We will implement a synchronous collaboration engine based on **Conflict-Free Replicated Data Types (CRDTs)** combined with a lightweight **WebSocket Signaling Service**.

```
                           ┌─────────────────────────┐
                           │   WebSocket Gateway     │
                           │  - Relays mouse coordinates │
                           │  - Transmits sync signals│
                           └──────────┬───┬──────────┘
                                      │   │
                ┌─────────────────────┘   └─────────────────────┐
                ▼                                               ▼
   ┌─────────────────────────┐                     ┌─────────────────────────┐
   │        Client A         │                     │        Client B         │
   │  - Local CRDT state doc │                     │  - Local CRDT state doc │
   │  - Cursor tracker (DOM) │                     │  - Cursor tracker (DOM) │
   └─────────────────────────┘                     └─────────────────────────┘
```

### 1. Synchronization Architecture

- **State Sync (Yjs + WebSockets)**:
  - We will represent the DAW project state (tracks, clips, mixer settings) as a shared `Y.Doc` using **Yjs**, a high-performance CRDT library.
  - Transactions on the React/Zustand store will apply local updates to the `Y.Doc`. Yjs automatically merges conflicts deterministically (e.g., two users modifying the same fader at the same time).
  - Updates will be broadcasted to peers via a WebSocket provider connected to our backend server.
- **Live Presence (Ephemeral WS Room)**:
  - Cursor coordinates and timeline view selections will bypass the heavy CRDT layer.
  - Instead, mouse coordinates (`x`, `y` on the timeline grid) will be piped directly through an ephemeral WebSocket broadcast channel (`presence` state).
  - Cursors will be rendered as lightweight absolute-positioned overlays on the timeline component.
- **Timestamped Comments**:
  - Comments will be modeled as a persistent array in the project document:
    ```typescript
    interface TimelineComment {
      id: string;
      author: string;
      timestamp: number; // Time in seconds on timeline
      trackId?: string;  // Optional specific track association
      content: string;
      createdAt: number;
    }
    ```
  - Comments will be displayed as indicators on the timeline ruler; clicking an indicator opens a popup thread.

## Alternatives Considered

- **Operational Transformation (OT)**: Similar to Google Docs, where a central server resolves conflicting edits. *Rejected* due to complex server-side implementation and latency. CRDTs operate client-side, making server-side architecture simpler and enabling local-first editing.
- **Simple Firestore Real-time Polling**: Relying on Firestore listeners to update state. *Rejected* for live faders and cursor movements due to high database latency and cost. WebSocket streaming is required for sub-100ms real-time feedback.

## Consequences

- **Positive / What We Gain**:
  - Truly collaborative, multiplayer music creation with near-zero latency for presence tracking.
  - Bulletproof conflict resolution via CRDTs; no overwrite wars.
  - Retains local-first offline support: edits made offline are merged seamlessly when reconnected.
- **Negative / Trade-offs**:
  - Increased complexity in application state management. The React store must coordinate local edits, CRDT synchronization, and remote event processing.
  - Collaborative audio playback coordination: if Client A presses play, does Client B's audio play too? We must implement a "Solo / Join Playback" toggle to allow independent editing or synced auditions.
