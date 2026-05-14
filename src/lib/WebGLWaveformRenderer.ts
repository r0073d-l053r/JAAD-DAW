/**
 * WebGLWaveformRenderer
 * A high-performance waveform renderer using WebGL 1.0.
 * Offloads drawing of thousands of peak segments to the GPU.
 */
export class WebGLWaveformRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private colorLocation: WebGLUniformLocation | null = null;
  private resolutionLocation: WebGLUniformLocation | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', {
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      throw new Error('WebGL not supported');
    }

    this.gl = gl;
    this.initShaders();
    this.positionBuffer = gl.createBuffer();
  }

  private initShaders() {
    const vsSource = `
      attribute vec2 a_position;
      uniform vec2 u_resolution;
      void main() {
        // Convert position from pixels to 0.0 to 1.0
        vec2 zeroToOne = a_position / u_resolution;
        // Convert from 0->1 to 0->2
        vec2 zeroToTwo = zeroToOne * 2.0;
        // Convert from 0->2 to -1->+1 (clipspace)
        vec2 clipSpace = zeroToTwo - 1.0;
        gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
      }
    `;

    const fsSource = `
      precision mediump float;
      uniform vec4 u_color;
      void main() {
        gl_FragColor = u_color;
      }
    `;

    const vertexShader = this.loadShader(this.gl.VERTEX_SHADER, vsSource);
    const fragmentShader = this.loadShader(this.gl.FRAGMENT_SHADER, fsSource);

    if (!vertexShader || !fragmentShader) return;

    this.program = this.gl.createProgram()!;
    this.gl.attachShader(this.program, vertexShader);
    this.gl.attachShader(this.program, fragmentShader);
    this.gl.linkProgram(this.program);

    if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
      console.error('Unable to initialize the shader program: ' + this.gl.getProgramInfoLog(this.program));
      return;
    }

    this.colorLocation = this.gl.getUniformLocation(this.program, 'u_color');
    this.resolutionLocation = this.gl.getUniformLocation(this.program, 'u_resolution');
  }

  private loadShader(type: number, source: string): WebGLShader | null {
    const shader = this.gl.createShader(type)!;
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error('An error occurred compiling the shaders: ' + this.gl.getShaderInfoLog(shader));
      this.gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  /**
   * Renders the waveform peaks.
   * @param peaks Array of [x, y, x, y+h] pairs representing vertical segments.
   * @param color Normalized RGBA color [r, g, b, a] (0.0 to 1.0)
   */
  render(peaks: Float32Array, color: [number, number, number, number]) {
    const gl = this.gl;
    if (!this.program || !this.positionBuffer) return;

    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);

    // Enable the attribute
    const positionAttributeLocation = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(positionAttributeLocation);

    // Bind the position buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, peaks, gl.STATIC_DRAW);

    // Tell the attribute how to get data out of positionBuffer
    gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

    // Set uniforms
    gl.uniform2f(this.resolutionLocation, gl.canvas.width, gl.canvas.height);
    gl.uniform4fv(this.colorLocation, color);

    // Draw the segments
    gl.drawArrays(gl.LINES, 0, peaks.length / 2);
  }

  destroy() {
    if (this.positionBuffer) {
      this.gl.deleteBuffer(this.positionBuffer);
    }
    if (this.program) {
      this.gl.deleteProgram(this.program);
    }
  }
}
