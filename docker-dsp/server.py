import asyncio
import websockets
import json
import base64
import numpy as np
import jack
import queue
import subprocess
import os
import secrets
import threading
from urllib.parse import urlparse, parse_qs
from pythonosc import udp_client

clients = set()
vst_process = None
osc_client = None

# Carla backend host (libcarla) — used to load a plugin AND introspect its real
# parameters so the client can auto-populate matching knobs. Lazily initialized;
# falls back to the fire-and-forget carla-single path if the backend is unavailable.
carla_host = None
param_ranges = {}  # {param_index: (min, max)} kept for de/normalizing wire values
CARLA_LIB = os.environ.get("JAAD_CARLA_LIB", "/usr/lib/carla/libcarla_standalone2.so")
CARLA_BIN = os.environ.get("JAAD_CARLA_BIN", "/usr/lib/carla")

input_queue = queue.Queue(maxsize=20)
output_queue = queue.Queue(maxsize=20)

# --- Security configuration -------------------------------------------------
# Directory that plugins may be loaded from (and uploaded to). Anything outside
# it is rejected.
VST_DIR = os.path.realpath(os.environ.get("JAAD_VST_DIR", "/vst"))

# Drag-and-drop plugin uploads. Cap the size and restrict extensions; the
# WebSocket max message size below is derived from this (base64 is ~1.34x).
MAX_PLUGIN_MB = int(os.environ.get("JAAD_MAX_PLUGIN_MB", "64"))
MAX_PLUGIN_BYTES = MAX_PLUGIN_MB * 1024 * 1024
ALLOWED_PLUGIN_EXT = (".dll", ".vst3", ".so")
# Headroom for base64 expansion (4/3) plus the small JSON envelope.
WS_MAX_SIZE = int(MAX_PLUGIN_BYTES * 4 / 3) + 65536

# Uploading a plugin over the wire writes an attacker-supplied binary that Carla
# then EXECUTES under Wine — arbitrary code execution by design. So it is OFF
# unless a deploy explicitly opts in, and it is trusted-operator-only: never
# enable it on a shared, multi-user, or internet-exposed host. (Loading a plugin
# already present in VST_DIR is unaffected; this gate is only about accepting NEW
# binaries from the browser.)
ENABLE_PLUGIN_UPLOAD = os.environ.get("JAAD_ENABLE_PLUGIN_UPLOAD") == "1"

# Shared secret required to connect. Resolution (see _resolve_auth_token):
#   1. JAAD_DSP_TOKEN if set — use it verbatim.
#   2. else JAAD_DSP_ALLOW_NO_AUTH=1 — explicit, origin-checked, localhost-only
#      opt-out (prints a loud warning).
#   3. else — AUTO-GENERATE a token, persist it to TOKEN_FILE (survives restarts
#      so the app's saved token keeps working), and REQUIRE it.
# Net effect: the bridge is authenticated by default with zero configuration, and
# is never silently open just because nobody set a token.
AUTH_TOKEN = os.environ.get("JAAD_DSP_TOKEN")
ALLOW_NO_AUTH = os.environ.get("JAAD_DSP_ALLOW_NO_AUTH") == "1"
# Auto-generated tokens live inside VST_DIR because that is already a persisted,
# container-writable volume in the shipped compose.
TOKEN_FILE = os.environ.get("JAAD_DSP_TOKEN_FILE", os.path.join(VST_DIR, ".dsp_token"))

# Only browsers served from these origins may connect. This blocks
# DNS-rebinding / CSRF-to-localhost from arbitrary websites. Comma-separated.
ALLOWED_ORIGINS = {
    o.strip()
    for o in os.environ.get(
        "JAAD_DSP_ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if o.strip()
}


def _resolve_auth_token():
    """Decide the token the bridge will require, making 'authenticated' the
    zero-config default. Returns the token string, or None ONLY when the operator
    explicitly opted out with JAAD_DSP_ALLOW_NO_AUTH=1."""
    if AUTH_TOKEN:
        return AUTH_TOKEN
    if ALLOW_NO_AUTH:
        return None
    # Reuse a previously generated token so the app's saved token survives a
    # restart; otherwise mint a fresh one and persist it 0600.
    try:
        with open(TOKEN_FILE, "r") as f:
            existing = f.read().strip()
        if existing:
            return existing
    except OSError:
        pass
    token = secrets.token_hex(24)
    try:
        os.makedirs(os.path.dirname(TOKEN_FILE) or ".", exist_ok=True)
        fd = os.open(TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(token)
    except OSError as e:
        print(f"⚠️ Could not persist auth token to {TOKEN_FILE} ({e}); "
              "it will change on the next restart.")
    return token


try:
    jack_client = jack.Client("JAAD_Bridge")
    inport = jack_client.inports.register("input_1")
    outport = jack_client.outports.register("output_1")
except Exception as e:
    print(f"❌ Failed to initialize JACK Client: {e}")
    jack_client = None


def _request_meta(websocket):
    """Return (headers, path) across websockets library versions."""
    req = getattr(websocket, "request", None)
    if req is not None:
        return req.headers, getattr(req, "path", "")
    return getattr(websocket, "request_headers", {}), getattr(websocket, "path", "")


def _authorize(websocket) -> bool:
    """Validate Origin and shared-token before accepting a connection."""
    headers, path = _request_meta(websocket)

    # Origin allow-list (browsers always send Origin; native clients may not).
    try:
        origin = headers.get("Origin") or headers.get("origin")
    except Exception:
        origin = None
    if origin is not None and origin not in ALLOWED_ORIGINS:
        print(f"🚫 Rejected connection from disallowed origin: {origin}")
        return False

    # Shared-token check.
    if AUTH_TOKEN:
        try:
            token = parse_qs(urlparse(path).query).get("token", [None])[0]
        except Exception:
            token = None
        if token != AUTH_TOKEN:
            print("🚫 Rejected connection: missing/invalid token")
            return False
    elif not ALLOW_NO_AUTH:
        # Fail closed: main() always resolves a token unless ALLOW_NO_AUTH is set,
        # so reaching here means misconfiguration — refuse rather than run open.
        print("🚫 Rejected connection: auth not configured")
        return False

    return True


def safe_plugin_path(path):
    """Resolve a client-supplied plugin path, refusing anything outside VST_DIR."""
    if not path or not isinstance(path, str):
        return None
    candidate = os.path.realpath(os.path.join(VST_DIR, path))
    if candidate != VST_DIR and not candidate.startswith(VST_DIR + os.sep):
        print(f"🚫 Rejected plugin path outside {VST_DIR}: {path}")
        return None
    if not os.path.isfile(candidate):
        print(f"🚫 Plugin not found: {candidate}")
        return None
    return candidate


def save_uploaded_plugin(name, b64data):
    """Validate and write a drag-and-dropped plugin into VST_DIR. Returns the
    stored basename, or raises ValueError with a user-facing reason."""
    # Defense in depth: the message handler already gates on this, but never let
    # a new binary be written unless upload was explicitly enabled.
    if not ENABLE_PLUGIN_UPLOAD:
        raise ValueError("plugin upload is disabled on this server")
    if not name or not isinstance(name, str):
        raise ValueError("missing filename")
    # Strip any path components a client might send; only a bare filename lands.
    base = os.path.basename(name)
    if base != name or base in ("", ".", ".."):
        raise ValueError("invalid filename")
    if not base.lower().endswith(ALLOWED_PLUGIN_EXT):
        raise ValueError("only .dll, .vst3, or .so plugins are allowed")
    try:
        raw = base64.b64decode(b64data or "", validate=True)
    except Exception:
        raise ValueError("corrupt upload data")
    if len(raw) == 0:
        raise ValueError("empty file")
    if len(raw) > MAX_PLUGIN_BYTES:
        raise ValueError(f"plugin exceeds the {MAX_PLUGIN_MB}MB limit")
    # Belt-and-suspenders: the resolved destination must stay inside VST_DIR.
    dest = os.path.realpath(os.path.join(VST_DIR, base))
    if dest != VST_DIR and not dest.startswith(VST_DIR + os.sep):
        raise ValueError("path escapes the plugin directory")
    os.makedirs(VST_DIR, exist_ok=True)
    tmp = dest + ".part"
    with open(tmp, "wb") as f:
        f.write(raw)
    os.replace(tmp, dest)  # atomic: no half-written plugin is ever loadable
    print(f"⬆️ Saved uploaded plugin: {dest} ({len(raw)} bytes)")
    return base


def jack_process(frames):
    try:
        in_data = input_queue.get_nowait()
    except queue.Empty:
        in_data = np.zeros((frames,), dtype=np.float32)

    if len(in_data) < frames:
        in_data = np.pad(in_data, (0, frames - len(in_data)))
    elif len(in_data) > frames:
        in_data = in_data[:frames]

    outport.get_array()[:] = in_data

    out_data = inport.get_array().copy()
    try:
        output_queue.put_nowait(out_data)
    except queue.Full:
        pass

if jack_client:
    jack_client.set_process_callback(jack_process)
    jack_client.activate()
    print("🔊 JACK Client activated.")

async def handle_connection(websocket):
    if not _authorize(websocket):
        await websocket.close(code=1008, reason="unauthorized")
        return

    clients.add(websocket)
    print("🔗 Client connected to Cloud VST Bridge")

    await websocket.send(json.dumps({
        'type': 'sync_params',
        'parameters': {}
    }))

    try:
        async for message in websocket:
            if isinstance(message, bytes) or isinstance(message, bytearray) or isinstance(message, memoryview):
                data = np.frombuffer(message, dtype=np.float32)

                try:
                    input_queue.put_nowait(data)
                except queue.Full:
                    pass

                try:
                    # Very short timeout to avoid blocking asyncio event loop too long
                    # Since websocket is async, blocking here is generally bad, but keeping it brief
                    out_data = output_queue.get(timeout=0.01)
                    await websocket.send(out_data.tobytes())
                except queue.Empty:
                    await websocket.send(np.zeros_like(data).tobytes())
            else:
                try:
                    data = json.loads(message)
                    if data.get('type') == 'ping':
                        await websocket.send(json.dumps({'type': 'pong', 'id': data.get('id')}))
                    elif data.get('type') == 'upload_plugin':
                        # Drag-and-drop: write the plugin into /vst, then the
                        # client follows up with a normal load_plugin by name.
                        # Gated — accepting new executables over the wire is off
                        # unless the operator opted in (trusted hosts only).
                        if not ENABLE_PLUGIN_UPLOAD:
                            await websocket.send(json.dumps({'type': 'upload_error',
                                'error': 'plugin upload is disabled on this server'}))
                        else:
                            try:
                                saved = save_uploaded_plugin(data.get('name'), data.get('data'))
                                await websocket.send(json.dumps({'type': 'upload_complete', 'name': saved}))
                            except Exception as e:
                                await websocket.send(json.dumps({'type': 'upload_error', 'error': str(e)}))
                    elif data.get('type') == 'load_plugin':
                        params = load_carla_plugin(data.get('path'))
                        # Broadcast the plugin's real parameters so every client
                        # repopulates its knobs to match the loaded plugin.
                        if params is not None:
                            msg = json.dumps({'type': 'param_list', 'parameters': params})
                            for client in list(clients):
                                try:
                                    await client.send(msg)
                                except Exception:
                                    pass
                    elif data.get('type') == 'param_change':
                        key = data.get('key')
                        val = data.get('value')
                        # Echo to other clients so multiple editors stay in sync.
                        for client in list(clients):
                            if client != websocket:
                                try:
                                    await client.send(json.dumps({'type': 'param_change', 'key': key, 'value': val}))
                                except Exception:
                                    pass
                        # Apply to the loaded plugin (Carla host, or OSC fallback).
                        apply_param_change(key, val)
                except Exception as e:
                    print(f"⚠️ Error parsing message: {e}")
    finally:
        clients.discard(websocket)
        print("❌ Client disconnected")

def _get_carla_host():
    """Lazily create the Carla backend host with a JACK engine. Returns the host
    or None if the Carla Python bindings aren't available in this image."""
    global carla_host
    if carla_host is not None:
        return carla_host
    try:
        from carla_backend import CarlaHostDLL, ENGINE_OPTION_PATH_BINARIES
        host = CarlaHostDLL(CARLA_LIB, False)
        host.set_engine_option(ENGINE_OPTION_PATH_BINARIES, 0, CARLA_BIN)
        if not host.engine_init("JACK", "JAAD_Carla"):
            print(f"⚠️ Carla engine_init failed: {host.get_last_error()}")
            return None
        carla_host = host
        print("🎛️ Carla backend host initialized (JACK engine).")
        return carla_host
    except Exception as e:
        print(f"⚠️ Carla backend host unavailable ({e}); falling back to carla-single.")
        return None


def _plugin_type_for(path):
    from carla_backend import PLUGIN_VST2, PLUGIN_VST3
    return PLUGIN_VST3 if path.lower().endswith(".vst3") else PLUGIN_VST2


def enumerate_parameters(host, plugin_id=0):
    """Read the loaded plugin's real parameters and return a JSON-friendly list
    the client renders directly as knobs. Values are normalized 0..1."""
    global param_ranges
    params = []
    param_ranges = {}
    try:
        count = host.get_parameter_count(plugin_id)
        for i in range(count):
            info = host.get_parameter_info(plugin_id, i) or {}
            ranges = host.get_parameter_ranges(plugin_id, i) or {}
            pmin = float(ranges.get("min", 0.0))
            pmax = float(ranges.get("max", 1.0))
            cur = float(host.get_current_parameter_value(plugin_id, i))
            span = (pmax - pmin) or 1.0
            param_ranges[i] = (pmin, pmax)
            params.append({
                "index": i,
                "name": info.get("name") or f"Param {i}",
                "unit": info.get("unit") or "",
                "min": pmin,
                "max": pmax,
                "value": max(0.0, min(1.0, (cur - pmin) / span)),  # normalized
            })
    except Exception as e:
        print(f"⚠️ Failed to enumerate parameters: {e}")
    return params


def load_carla_plugin(path):
    """Load a plugin and return its parameter list (or None on rejection/failure).
    Prefers the Carla backend host (real introspection); falls back to carla-single."""
    global vst_process, osc_client

    plugin_path = safe_plugin_path(path)
    if plugin_path is None:
        return None  # rejected: outside /vst, missing, or malformed

    host = _get_carla_host()
    if host is not None:
        try:
            # One plugin at a time: clear any previously loaded plugin.
            try:
                host.remove_all_plugins()
            except Exception:
                pass
            print(f"🚀 Loading VST via Carla backend host: {plugin_path}")
            from carla_backend import BINARY_NATIVE
            ok = host.add_plugin(
                BINARY_NATIVE, _plugin_type_for(plugin_path),
                plugin_path, None, None, 0, None, 0x0,
            )
            if not ok:
                print(f"⚠️ add_plugin failed: {host.get_last_error()}")
                return []
            # Show the plugin's native editor on the virtual display so the
            # noVNC side-panel can stream the real GUI as a fallback for knobs
            # the auto-generated dials don't fully cover.
            try:
                host.show_custom_ui(0, True)
            except Exception:
                pass
            threading.Timer(2.0, connect_jack_ports).start()
            return enumerate_parameters(host, 0)
        except Exception as e:
            print(f"⚠️ Carla host load failed ({e}); falling back to carla-single.")

    # Fallback: fire-and-forget carla-single (no introspection → empty knob list).
    if vst_process:
        print("🛑 Terminating existing Carla instance...")
        vst_process.terminate()
        vst_process.wait()
    print(f"🚀 Loading VST plugin via carla-single: {plugin_path}")
    vst_process = subprocess.Popen(["carla-single", "vst", plugin_path])
    osc_client = udp_client.SimpleUDPClient("127.0.0.1", 22752)
    threading.Timer(3.0, connect_jack_ports).start()
    return []


def apply_param_change(key, value):
    """Set a normalized (0..1) parameter value on the loaded plugin."""
    try:
        index = int(key)
    except (TypeError, ValueError):
        print(f"⚠️ Non-numeric parameter key: {key}")
        return
    if carla_host is not None:
        pmin, pmax = param_ranges.get(index, (0.0, 1.0))
        denorm = pmin + float(value) * (pmax - pmin)
        try:
            carla_host.set_parameter_value(0, index, denorm)
            return
        except Exception as e:
            print(f"⚠️ set_parameter_value failed: {e}")
    if osc_client:
        osc_client.send_message("/Carla/0/set_parameter_value", [index, float(value)])

def connect_jack_ports():
    if not jack_client: return
    try:
        # Match either the backend host (JAAD_Carla:*) or carla-single (carla*:*).
        carla_in = (jack_client.get_ports("JAAD_Carla:.*", is_audio=True, is_input=True)
                    or jack_client.get_ports("carla.*:.*", is_audio=True, is_input=True))
        carla_out = (jack_client.get_ports("JAAD_Carla:.*", is_audio=True, is_output=True)
                     or jack_client.get_ports("carla.*:.*", is_audio=True, is_output=True))
        if carla_in and carla_out:
            jack_client.connect(outport, carla_in[0])
            jack_client.connect(carla_out[0], inport)
            print("🔗 Connected JACK ports to Carla")
        else:
            print("⚠️ Carla JACK ports not found yet.")
    except Exception as e:
        print(f"❌ Failed to connect JACK ports: {e}")

async def main():
    global AUTH_TOKEN
    env_token = os.environ.get("JAAD_DSP_TOKEN")
    AUTH_TOKEN = _resolve_auth_token()
    if AUTH_TOKEN and not env_token:
        # Auto-generated or restored from TOKEN_FILE — surface it so the operator
        # can paste it into JAAD Settings (localStorage 'jaad_dsp_token').
        print("🔐 DSP auth token (set this in JAAD Settings → DSP token):")
        print(f"       {AUTH_TOKEN}")
    elif AUTH_TOKEN:
        print("🔐 DSP auth: using the token from JAAD_DSP_TOKEN.")
    else:
        print("⚠️ JAAD_DSP_ALLOW_NO_AUTH=1 — running WITHOUT token auth "
              "(origin-checked only). Use ONLY on a trusted localhost bind.")
    if ENABLE_PLUGIN_UPLOAD:
        print("⚠️ JAAD_ENABLE_PLUGIN_UPLOAD=1 — over-the-wire plugin upload is ON "
              "(uploaded binaries run under Wine). Trusted operators only.")

    host = os.environ.get("JAAD_DSP_HOST", "0.0.0.0")
    print(f"🚀 JAAD Headless VST/DSP Sidecar running on {host}:8080")
    print(f"   Allowed origins: {sorted(ALLOWED_ORIGINS)} · plugin dir: {VST_DIR}")
    # max_size raised so a base64-encoded plugin upload fits in one message.
    async with websockets.serve(handle_connection, host, 8080, max_size=WS_MAX_SIZE):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
