import asyncio
import websockets
import json
import numpy as np
import jack
import queue
import subprocess
import os
import threading
from pythonosc import udp_client

clients = set()
vst_process = None
osc_client = None

input_queue = queue.Queue(maxsize=20)
output_queue = queue.Queue(maxsize=20)

try:
    jack_client = jack.Client("JAAD_Bridge")
    inport = jack_client.inports.register("input_1")
    outport = jack_client.outports.register("output_1")
except Exception as e:
    print(f"❌ Failed to initialize JACK Client: {e}")
    jack_client = None

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
                    elif data.get('type') == 'load_plugin':
                        path = data.get('path')
                        load_carla_plugin(path)
                    elif data.get('type') == 'param_change':
                        key = data.get('key')
                        val = data.get('value')
                        
                        # Forward parameter change to all clients
                        for client in clients:
                            if client != websocket:
                                await client.send(json.dumps({'type': 'param_change', 'key': key, 'value': val}))
                        
                        # Forward to Carla via OSC
                        if osc_client:
                            try:
                                # We assume key is the numeric index of the VST parameter
                                param_index = int(key)
                                osc_client.send_message("/Carla/0/set_parameter_value", [param_index, float(val)])
                                print(f"🎛️ Sent OSC: Param {param_index} = {val}")
                            except ValueError:
                                print(f"⚠️ Non-numeric parameter key received: {key}, ignoring for OSC.")
                except Exception as e:
                    print(f"⚠️ Error parsing message: {e}")
    finally:
        clients.remove(websocket)
        print("❌ Client disconnected")

def load_carla_plugin(path):
    global vst_process, osc_client
    if vst_process:
        print("🛑 Terminating existing Carla instance...")
        vst_process.terminate()
        vst_process.wait()

    plugin_path = os.path.join("/vst", path)
    
    print(f"🚀 Loading VST plugin via Carla: {plugin_path}")
    # Carla single command
    vst_process = subprocess.Popen(["carla-single", "vst", plugin_path])
    
    # Default OSC port for carla-single
    osc_client = udp_client.SimpleUDPClient("127.0.0.1", 22752)

    threading.Timer(3.0, connect_jack_ports).start()

def connect_jack_ports():
    if not jack_client: return
    try:
        carla_in = jack_client.get_ports("carla-single.*:AudioIn.*", is_audio=True)
        carla_out = jack_client.get_ports("carla-single.*:AudioOut.*", is_audio=True)
        if carla_in and carla_out:
            jack_client.connect(outport, carla_in[0])
            jack_client.connect(carla_out[0], inport)
            print("🔗 Connected JACK ports to Carla-Single")
        else:
            print("⚠️ Carla JACK ports not found yet.")
    except Exception as e:
        print(f"❌ Failed to connect JACK ports: {e}")

async def main():
    print("🚀 JAAD Headless VST/DSP Sidecar running on port 8080")
    async with websockets.serve(handle_connection, "0.0.0.0", 8080):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
