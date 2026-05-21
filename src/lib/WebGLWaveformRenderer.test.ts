import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebGLWaveformRenderer } from './WebGLWaveformRenderer';

describe('WebGLWaveformRenderer', () => {
  let mockGl: any;
  let mockCanvas: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup complete WebGL constant flags
    mockGl = {
      VERTEX_SHADER: 1,
      FRAGMENT_SHADER: 2,
      COMPILE_STATUS: 3,
      LINK_STATUS: 4,
      COLOR_BUFFER_BIT: 5,
      ARRAY_BUFFER: 6,
      STATIC_DRAW: 7,
      FLOAT: 8,
      LINES: 9,
      
      canvas: {
        width: 800,
        height: 150,
      },

      createBuffer: vi.fn().mockReturnValue({ type: 'WebGLBuffer' }),
      createShader: vi.fn().mockReturnValue({ type: 'WebGLShader' }),
      createProgram: vi.fn().mockReturnValue({ type: 'WebGLProgram' }),
      
      shaderSource: vi.fn(),
      compileShader: vi.fn(),
      getShaderParameter: vi.fn().mockReturnValue(true), // compile succeeds
      
      attachShader: vi.fn(),
      linkProgram: vi.fn(),
      getProgramParameter: vi.fn().mockReturnValue(true), // link succeeds
      
      getUniformLocation: vi.fn().mockImplementation((p, name) => ({ type: 'WebGLUniformLocation', name })),
      getAttribLocation: vi.fn().mockReturnValue(10),

      viewport: vi.fn(),
      clearColor: vi.fn(),
      clear: vi.fn(),
      useProgram: vi.fn(),
      enableVertexAttribArray: vi.fn(),
      bindBuffer: vi.fn(),
      bufferData: vi.fn(),
      vertexAttribPointer: vi.fn(),
      uniform2f: vi.fn(),
      uniform4fv: vi.fn(),
      drawArrays: vi.fn(),
      
      deleteBuffer: vi.fn(),
      deleteProgram: vi.fn(),
      deleteShader: vi.fn(),
      getShaderInfoLog: vi.fn().mockReturnValue(''),
      getProgramInfoLog: vi.fn().mockReturnValue(''),
    };

    mockCanvas = {
      getContext: vi.fn().mockReturnValue(mockGl),
    };
  });

  it('correctly initializes shader shaders and program uniforms', () => {
    const renderer = new WebGLWaveformRenderer(mockCanvas as any);

    expect(mockCanvas.getContext).toHaveBeenCalledWith('webgl', {
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: false,
    });
    
    // Shader creation and bindings are triggered
    expect(mockGl.createShader).toHaveBeenCalledTimes(2);
    expect(mockGl.createProgram).toHaveBeenCalledTimes(1);
    expect(mockGl.attachShader).toHaveBeenCalledTimes(2);
    expect(mockGl.linkProgram).toHaveBeenCalledTimes(1);
    expect(mockGl.getUniformLocation).toHaveBeenCalledWith(expect.anything(), 'u_color');
    expect(mockGl.getUniformLocation).toHaveBeenCalledWith(expect.anything(), 'u_resolution');
  });

  it('throws an error if WebGL context is not supported', () => {
    mockCanvas.getContext.mockReturnValue(null);

    expect(() => {
      new WebGLWaveformRenderer(mockCanvas as any);
    }).toThrow('WebGL not supported');
  });

  it('renders array of peaks and colors to the WebGL screen buffer', () => {
    const renderer = new WebGLWaveformRenderer(mockCanvas as any);

    const peaks = new Float32Array([0, 10, 0, 80, 1, 15, 1, 75]);
    const color: [number, number, number, number] = [1.0, 0.0, 0.5, 1.0];

    renderer.render(peaks, color);

    expect(mockGl.viewport).toHaveBeenCalledWith(0, 0, 800, 150);
    expect(mockGl.clearColor).toHaveBeenCalledWith(0, 0, 0, 0);
    expect(mockGl.clear).toHaveBeenCalledWith(mockGl.COLOR_BUFFER_BIT);
    expect(mockGl.useProgram).toHaveBeenCalled();
    expect(mockGl.bindBuffer).toHaveBeenCalledWith(mockGl.ARRAY_BUFFER, expect.anything());
    expect(mockGl.bufferData).toHaveBeenCalledWith(mockGl.ARRAY_BUFFER, peaks, mockGl.STATIC_DRAW);
    expect(mockGl.uniform2f).toHaveBeenCalledWith(expect.anything(), 800, 150);
    expect(mockGl.uniform4fv).toHaveBeenCalledWith(expect.anything(), color);
    
    // Draw segments (4 segments because peaks.length is 8, drawing lines with 2 points each)
    expect(mockGl.drawArrays).toHaveBeenCalledWith(mockGl.LINES, 0, 4);
  });

  it('deallocates shaders buffers and program memory on destroy', () => {
    const renderer = new WebGLWaveformRenderer(mockCanvas as any);

    renderer.destroy();

    expect(mockGl.deleteBuffer).toHaveBeenCalledTimes(1);
    expect(mockGl.deleteProgram).toHaveBeenCalledTimes(1);
  });
});
