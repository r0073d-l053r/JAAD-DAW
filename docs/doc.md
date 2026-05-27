# JAAD Documentation

Welcome to **JAAD** (Just Another AI DAW), a high-fidelity, local-first Digital Audio Workstation built for the modern web. This project combines professional-grade audio processing with a stunning "Liquid Glass" aesthetic.

## 🚀 Quick Start & Installation

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)

### Installation Steps
1. **Clone the repository**:
    ```bash
    git clone https://github.com/r0073d-l053r/JAAD-DAW.git
    cd JAAD-DAW
    ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **First Time Build & Updates**:
   ```bash
   npm run build
   ```

4. **Run the development server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000/JAAD-DAW/] in your browser.

---

## 🛠 Setup & Environment Variables

JAAD uses environment variables for its AI and Cloud features. Create a `.env` file in the root directory:

```env
# Gemini AI (For Auto-Tagging and Intelligent Features)
VITE_GEMINI_API_KEY=your_gemini_api_key_here

# Firebase Configuration (For Cloud Sync/Projects)
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

### Firebase Setup
If you want to use cloud saving, you'll need to create a Firebase project at the [Firebase Console](https://console.firebase.google.com/).
1. Enable **Authentication** (Google or Email).
2. Create a **Firestore Database**.
3. Create a **Storage Bucket**.
4. Copy your Web App configuration into your `.env` file.

---

## ✨ Core Features

### 🎧 High-Fidelity Audio Engine
- **AudioWorklet Playback Engine**: Uses a robust `soundtouch-processor` AudioWorklet for non-unity playback rates, eliminating audio glitches and improving performance.
- **Pitch-Preserving Time-Stretch**: Professional-grade tempo changes without changing the pitch.
- **Native Fallback**: Automatically switches to high-performance native `AudioBufferSourceNodes` when at 1.0x speed to eliminate latency and phasing.
- **Sample-Accurate Sync**: Perfectly aligned playback across dozens of tracks.

### ☁️ Cloud Sync & Sharing
- **Cloud Project Browser**: Browse, load, and fork projects directly from Firebase.
- **Portable .jaad Bundles**: Export your entire project (including all audio assets) as a `.jaad` zip bundle and import it anywhere.
- **Deep Link Sharing**: Generate unique URLs (`?project=PROJECT_ID`) to share your project. Includes one-click Discord integration!
- **Offline Persistence**: Local IndexedDB caching ensures your audio assets survive browser refreshes and offline states.

### ⏱️ Intelligent BPM Engine
- **Hybrid BPM Detection Engine**: Powered by `Essentia.js` for fast offline tempo analysis with an automatic Gemini AI fallback.
- **Resampling Pipeline**: High-quality offline resampling ensures accurate analysis regardless of source sample rate (44.1k, 48k, etc.).

### 🎹 Workflow & Editing
- **Alternate Lanes**: Stash alternate takes or ideas in hidden lanes. Use "Add to Alternate Lane" to version your stems.
- **Magnetic Snapping**: Clips "stick" to each other and the playhead for perfect alignment.
- **Vertical Lock**: Hold `Shift` while dragging a stem up/down to lock its horizontal timing.
- **Volume Envelopes**: Double-click on any clip to add automation points for smooth fades and volume control.
- **Multi-Selection**: Lasso or `Ctrl+Click` multiple stems to move, delete, or duplicate them as a group.

### 🤖 AI Integration
- **Auto-Tagging**: Use the "AI Auto-Tag" feature to have the DAW analyze and name your stems based on their content (Drums, Bass, Vocal, etc.).
- **Smart Stems**: Intelligent cleanup and processing options available via the right-click menu.
- **Authenticity Processor**: Ensure loops and stems are authentic with an intelligent scoring and AI variation system.

---

## 🔌 Headless VSTs (Carla Sidecar)

J.A.A.D supports professional Windows VSTs (like Waves) via a robust headless Docker sidecar utilizing Carla and Wine.

### Setting up the Sidecar
1. Place your Windows VST plugins (`.dll` files) inside the `/vst` directory located in the project's root folder.
2. Ensure you have Docker and Docker Compose installed on your system.
3. Open a terminal in the project directory and run the following command to boot the DSP Sidecar:
   ```bash
   docker-compose up dsp -d
   ```
4. This will build and start an Ubuntu-based environment with Wine, KXStudio/Carla, and a Python WebSocket bridge that seamlessly connects the DAW frontend to your VSTs.

### How to Use VSTs
- Once the sidecar is running, J.A.A.D will detect it.
- You can route your stems to specific VST effects, and the audio will be streamed to the container and processed in real-time.
- Adjust parameters in the DAW UI to send OSC commands to Carla.

---

## 🎹 Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Space` | Toggle Play/Pause |
| `R` | Toggle Record |
| `S` | Split Clip at playhead |
| `Backspace` / `Del` | Delete selected clips |
| `Ctrl + S` | Save Project to Cloud |
| `Ctrl + Z` | Undo |
| `Ctrl + Y` / `Ctrl + Shift + Z` | Redo |
| `Ctrl + A` | Select All Clips |
| `Ctrl + C` | Copy Clips |
| `Ctrl + X` | Cut Clips |
| `Ctrl + V` | Paste Clips |
| `Ctrl + D` | Duplicate selection |
| `Ctrl + Shift + S` | Cleanup Stems (AI Process) |
| `Shift + Drag` | Lock movement to vertical only |
| `F9` / `Tab` | Toggle between Timeline and Mixer |
| `Ctrl + Shift + Scroll` | Zoom In / Out |

---

## 📂 Project Structure

- `/src/lib/audioEngine.ts`: The core Web Audio API logic.
- `/src/lib/store.tsx`: Global state management and track logic.
- `/src/components/Timeline.tsx`: The main visual editor.
- `/src/components/ClipItem.tsx`: Individual audio stem logic and interaction.

---

## 🤝 Contributing

We welcome contributions! Please see our [Architecture Decision Records](adr/README.md) for active designs, roadmaps, and technical proposals.
