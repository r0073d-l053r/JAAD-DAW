import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSerialManager, hardwareBridge } from './WebSerialManager';

describe('WebSerialManager', () => {
  let manager: WebSerialManager;
  let mockPort: any;
  let mockWriter: any;
  let mockReader: any;

  beforeEach(() => {
    mockWriter = {
      write: vi.fn().mockResolvedValue(undefined),
    };

    mockReader = {
      read: vi.fn().mockResolvedValue({ value: new Uint8Array([1, 2, 3]), done: true }),
    };

    mockPort = {
      open: vi.fn().mockResolvedValue(undefined),
      writable: {
        getWriter: vi.fn().mockReturnValue(mockWriter),
      },
      readable: {
        getReader: vi.fn().mockReturnValue(mockReader),
      },
    };

    // Setup global navigator.serial stub
    vi.stubGlobal('navigator', {
      serial: {
        requestPort: vi.fn().mockResolvedValue(mockPort),
      },
    });

    manager = new WebSerialManager();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('successfully requests a port and initializes streams', async () => {
    await manager.requestPort();

    expect((navigator as any).serial.requestPort).toHaveBeenCalledTimes(1);
    expect(mockPort.open).toHaveBeenCalledWith({ baudRate: 115200 });
    expect(manager.writer).toBe(mockWriter);
    expect(manager.reader).toBe(mockReader);
  });

  it('gracefully handles connection errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked((navigator as any).serial.requestPort).mockRejectedValue(new Error('User cancelled'));

    await manager.requestPort();

    expect(manager.port).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('does not send MIDI messages if writer is not initialized', async () => {
    await manager.sendMIDIMessage([144, 60, 100]);
    expect(mockWriter.write).not.toHaveBeenCalled();
  });

  it('sends MIDI messages when writer is initialized', async () => {
    await manager.requestPort();
    await manager.sendMIDIMessage([144, 60, 100]);

    expect(mockWriter.write).toHaveBeenCalledWith(new Uint8Array([144, 60, 100]));
  });

  it('does not send audio chunks if writer is not initialized', async () => {
    const chunk = new Float32Array([0.0, 0.5, -0.5]);
    await manager.sendAudioChunk(chunk);
    expect(mockWriter.write).not.toHaveBeenCalled();
  });

  it('compresses Float32Array to Int16Array and sends audio chunks', async () => {
    await manager.requestPort();
    const chunk = new Float32Array([0.0, 0.5, -0.5, 1.5, -2.0]);
    await manager.sendAudioChunk(chunk);

    // Scaling checks: val * 32767
    // 0.0 -> 0
    // 0.5 -> 16383.5 | 0 = 16383
    // -0.5 -> -16383.5 | 0 = -16383
    // 1.5 -> Clamped to 1.0 -> 32767
    // -2.0 -> Clamped to -1.0 -> -32767
    const expectedInt16 = new Int16Array([
      0,
      16383,
      -16383,
      32767,
      -32767,
    ]);

    expect(mockWriter.write).toHaveBeenCalledWith(expectedInt16);
  });

  it('reads streams and calls callback in startListening loop', async () => {
    await manager.requestPort();

    const mockCallback = vi.fn();
    // Simulate first read returning data, second read terminating
    mockReader.read
      .mockResolvedValueOnce({ value: new Uint8Array([240, 64]), done: false })
      .mockResolvedValueOnce({ value: undefined, done: true });

    await manager.startListening(mockCallback);

    expect(mockCallback).toHaveBeenCalledWith(new Uint8Array([240, 64]));
    expect(mockCallback).toHaveBeenCalledTimes(1);
  });

  it('does not listen if reader is not initialized', async () => {
    const mockCallback = vi.fn();
    await manager.startListening(mockCallback);
    expect(mockCallback).not.toHaveBeenCalled();
  });

  it('shares a global hardwareBridge instance', () => {
    expect(hardwareBridge).toBeInstanceOf(WebSerialManager);
  });
});
