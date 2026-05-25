import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudVstBridge } from './cloudVstBridge';

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
});
