# ADR-0008: Wine VST Server — Real Parameter Knobs & noVNC Plugin GUI

- **Status**: 🟡 Proposed (client + protocol landed; Carla/JACK/noVNC runtime needs hardware verification)
- **Date**: 2026-07-04
- **Author**: USER & Claude

## Context & Problem Statement

The DSP sidecar (ADR-0005) can host native Windows VST/DLL plugins under Wine +
Carla, but the DAW-side experience was a stub:

1. The VST editor showed **four hardcoded generic knobs** (`cutoff/drive/feedback/mix`)
   that had nothing to do with the real plugin's parameters.
2. The client sent `{type:'parameters'}` while the server listened for `param_change`
   — a **protocol mismatch**, so knob moves never reached the plugin.
3. There was **no way to see the plugin's own GUI**, so any parameter the generic
   knobs didn't model was simply unreachable.

We want: knobs in JAAD that are **auto-populated from the loaded plugin's actual
parameters**, and a **live view of the plugin's real editor** as a fallback for
controls the auto-knobs don't cover.

## Decision

### 1. Aligned control protocol (WebSocket JSON)
| Message | Direction | Purpose |
| :-- | :-- | :-- |
| `{type:'load_plugin', path}` | client → server | Load a plugin from the mounted `/vst` dir |
| `{type:'param_list', parameters:[...]}` | server → clients | The plugin's real parameters (index, name, unit, min, max, normalized value) |
| `{type:'param_change', key, value}` | both | `key` = parameter index; `value` normalized 0..1 |

`param_list` drives the UI: the editor already renders `Object.keys(bridge.parameters)`,
so replacing that map with the enumerated list makes the knobs match the plugin with
no UI rewrite.

### 2. Real parameter enumeration (Carla backend host)
The server moves from the fire-and-forget `carla-single` subprocess to the **Carla
backend host** (`libcarla`, Python `carla_backend`), which can introspect a loaded
plugin: `get_parameter_count` / `get_parameter_info` / `get_parameter_ranges` /
`get_current_parameter_value` / `set_parameter_value`. Values are normalized 0..1 on
the wire and de-normalized against the cached ranges when applied. If the Carla
bindings aren't importable, it **falls back** to `carla-single` (audio works; knob
list is empty) so the pipeline degrades gracefully.

### 3. noVNC live plugin GUI
`x11vnc` captures the sidecar's existing Xvfb display (`:99`); `websockify` serves the
`novnc` web client on **:6080**. The plugin's native editor is shown on that display
via `host.show_custom_ui(0, True)`. JAAD embeds `http://<host>:6080/vnc.html` in a
side panel toggled from the VST editor, so the user can drive the plugin's own knobs.

### 4. Security posture
- 8080 (DSP) and 6080 (noVNC) are **loopback-bound** in compose; expose only behind an
  authenticated reverse proxy.
- x11vnc runs with `-localhost` and honors `JAAD_VNC_PASSWORD` when set.
- Plugin paths remain sandboxed to `/vst` (`safe_plugin_path`), which is mounted `:ro`.
- The existing token + Origin allow-list on the DSP socket is unchanged.

## Alternatives Considered
- **Keep hardcoded knobs** — rejected; they don't reflect the plugin, so automation is
  meaningless.
- **OSC-only parameter reporting from carla-single** — rejected; brittle and limited
  introspection vs. the backend host API.
- **Screen-scrape the GUI instead of enumerating** — rejected; noVNC is the *fallback*,
  not the primary control surface. We want native automatable knobs first.

## Consequences
- **Positive**: knobs match any loaded plugin; full control via the real GUI when
  needed; one clean protocol; graceful fallback when Carla bindings are absent.
- **Negative / risk**: the Carla backend host + JACK port wiring and `show_custom_ui`
  behavior **must be verified on real hardware with real plugins** — they cannot be
  exercised in CI (no VSTs, no audio device). JACK port names and the exact
  `carla_backend` API surface may need adjustment per Carla build.
- noVNC adds an attack surface; the loopback binding + optional VNC password mitigate it.

## Verification checklist (on a machine with Docker + a real VST)
1. Drop a `.dll`/`.vst3` into `./vst`, `docker-compose up dsp -d`.
2. In JAAD, open a track's VST Cloud Bridge, Connect, type the plugin filename, **Load**.
3. Confirm the knobs repopulate to the plugin's real parameters and moving them changes
   the sound.
4. Click **Show Plugin GUI** and confirm the plugin's native editor streams in the panel
   and its controls work.
5. If knobs stay empty, check the sidecar logs for `Carla backend host unavailable` and
   adjust `JAAD_CARLA_LIB` / `carla_backend` import path for your image.
