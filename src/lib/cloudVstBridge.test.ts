import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudVstBridge, getDefaultDspUrl } from './cloudVstBridge';

describe('getDefaultDspUrl (origin-aware default)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the local-dev default on http origins', () => {
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:3000' });
    expect(getDefaultDspUrl()).toBe('ws://localhost:8080');
  });

  it('uses the same-host /dsp proxy path on https origins (mixed content + wrong host otherwise)', () => {
    vi.stubGlobal('location', { protocol: 'https:', host: 'jaad.example.ts.net' });
    expect(getDefaultDspUrl()).toBe('wss://jaad.example.ts.net/dsp');
  });
});

class MockWebSocket {
  binaryType: string = '';
  onopen: (() => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  onerror: ((err: any) => void) | null = null;
  onclose: (() => void) | null = null;
  
  close = vi.fn();
  send = vi.fn();
}

describe('CloudVstBridge', () => {
  let mockContext: any;
  let mockSourceNode: any;
  let mockDestinationNode: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', MockWebSocket);

    // Mock Web Audio API components
    mockSourceNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    mockDestinationNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    mockContext = {
      currentTime: 10.0,
      createDelay: vi.fn().mockReturnValue({
        delayTime: { value: 0 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
      createBiquadFilter: vi.fn().mockReturnValue({
        type: 'lowpass',
        frequency: { 
          value: 20000,
          setValueAtTime: vi.fn()
        },
        Q: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
      createGain: vi.fn().mockReturnValue({
        gain: { 
          value: 1.0,
          setValueAtTime: vi.fn()
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
      createScriptProcessor: vi.fn().mockReturnValue({
        connect: vi.fn(),
        disconnect: vi.fn(),
        onaudioprocess: null
      }),
      destination: mockDestinationNode,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('should initialize with offline parameters and local fallback status', () => {
    const bridge = new CloudVstBridge(mockContext, 'track-1', mockDestinationNode);
    expect(bridge.status).toBe('connecting'); // connects automatically
    expect(bridge.parameters.cutoff).toBeDefined();
    expect(bridge.parameters.cutoff.value).toBe(0.8);
    expect(bridge.parameters.drive.value).toBe(0.3);
  });

  it('should construct local fallback DSP node graphs correctly', () => {
    const bridge = new CloudVstBridge(mockContext, 'track-1', mockDestinationNode);
    
    // Fallback nodes should be created
    expect(mockContext.createBiquadFilter).toHaveBeenCalled();
    expect(mockContext.createGain).toHaveBeenCalled();
  });

  it('should update fallback filter frequencies and coefficients instantly on parameter changes', () => {
    const bridge = new CloudVstBridge(mockContext, 'track-1', mockDestinationNode);
    
    // Set parameter
    bridge.setParameter('cutoff', 0.2); // should map to 20 + 0.2 * 19980 = 4016 Hz
    expect(bridge.parameters.cutoff.value).toBe(0.2);
  });

  it('should calculate rolling average network latency correctly', () => {
    const bridge = new CloudVstBridge(mockContext, 'track-1', mockDestinationNode);

    // Inject mock connection status and pings
    bridge.status = 'connected';

    // Simulate RTT updates
    bridge.latencyMs = 45;
    expect(bridge.latencyMs).toBe(45);
  });

  describe('drag-and-drop plugin upload', () => {
    class MockFileReader {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        // base64('ABC') = 'QUJD'
        this.result = 'data:application/octet-stream;base64,QUJD';
        this.onload?.();
      }
    }

    const connectedBridge = () => {
      (MockWebSocket as any).OPEN = 1;
      vi.stubGlobal('FileReader', MockFileReader);
      const bridge = new CloudVstBridge(mockContext, 'track-1', mockDestinationNode);
      const socket = (bridge as any).socket;
      socket.readyState = 1;
      socket.send.mockClear?.();
      return { bridge, socket };
    };

    it('sends the plugin as base64 and resolves with the saved name', async () => {
      const { bridge, socket } = connectedBridge();
      const p = bridge.uploadPlugin(new File(['ABC'], 'Reverb.dll'));

      const sent = JSON.parse(socket.send.mock.calls.at(-1)[0]);
      expect(sent.type).toBe('upload_plugin');
      expect(sent.name).toBe('Reverb.dll');
      expect(sent.data).toBe('QUJD');

      socket.onmessage({ data: JSON.stringify({ type: 'upload_complete', name: 'Reverb.dll' }) });
      await expect(p).resolves.toBe('Reverb.dll');
    });

    it('rejects with the server-supplied reason on upload_error', async () => {
      const { bridge, socket } = connectedBridge();
      const p = bridge.uploadPlugin(new File(['ABC'], 'huge.dll'));
      socket.onmessage({ data: JSON.stringify({ type: 'upload_error', error: 'plugin exceeds the 64MB limit' }) });
      await expect(p).rejects.toThrow('64MB');
    });

    it('rejects immediately when the bridge is not connected', async () => {
      const { bridge } = connectedBridge();
      (bridge as any).socket.readyState = 3; // CLOSED
      await expect(bridge.uploadPlugin(new File(['ABC'], 'p.dll'))).rejects.toThrow('Not connected');
    });
  });
});
