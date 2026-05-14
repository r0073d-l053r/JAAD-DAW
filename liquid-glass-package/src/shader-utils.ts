// Adapted from https://github.com/shuding/liquid-glass

export interface Vec2 {
  x: number
  y: number
}

export interface ShaderOptions {
  width: number
  height: number
  fragment: (uv: Vec2, mouse?: Vec2) => Vec2
  mousePosition?: Vec2
}

function smoothStep(a: number, b: number, t: number): number {
  t = Math.max(0, Math.min(1, (t - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y)
}

function roundedRectSDF(x: number, y: number, width: number, height: number, radius: number): number {
  const qx = Math.abs(x) - width + radius
  const qy = Math.abs(y) - height + radius
  return Math.min(Math.max(qx, qy), 0) + length(Math.max(qx, 0), Math.max(qy, 0)) - radius
}

function texture(x: number, y: number): Vec2 {
  return { x, y }
}

// Shader fragment functions for different effects
export const fragmentShaders = {
  liquidGlass: (uv: Vec2): Vec2 => {
    const ix = uv.x - 0.5
    const iy = uv.y - 0.5
    const distanceToEdge = roundedRectSDF(ix, iy, 0.3, 0.2, 0.6)
    const displacement = smoothStep(0.8, 0, distanceToEdge - 0.15)
    const scaled = smoothStep(0, 1, displacement)
    return texture(ix * scaled + 0.5, iy * scaled + 0.5)
  },
}

export const glslShaders = {
  liquidGlass: `
    precision highp float;
    varying vec2 vUv;

    float smoothStepFunc(float a, float b, float t) {
      t = clamp((t - a) / (b - a), 0.0, 1.0);
      return t * t * (3.0 - 2.0 * t);
    }

    float roundedRectSDF(vec2 p, vec2 b, float r) {
      vec2 q = abs(p) - b + r;
      return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
    }

    void main() {
      vec2 uv = vUv;
      vec2 i = uv - 0.5;
      float distanceToEdge = roundedRectSDF(i, vec2(0.3, 0.2), 0.6);
      float displacement = smoothStepFunc(0.8, 0.0, distanceToEdge - 0.15);
      float scaled = smoothStepFunc(0.0, 1.0, displacement);
      vec2 pos = i * scaled + 0.5;
      
      // Calculate displacement vector
      vec2 d = pos - uv;
      
      // We need to match the normalization of the CPU version.
      // The CPU version uses maxScale. In GLSL, we'll use a fixed large scale (e.g. 0.5) 
      // or we can try to normalize within the shader if we know the bounds.
      // For liquid glass, the displacement is usually small.
      
      float r = d.x / 0.5 + 0.5;
      float g = d.y / 0.5 + 0.5;
      
      gl_FragColor = vec4(r, g, g, 1.0);
    }
  `,
}

export type FragmentShaderType = keyof typeof fragmentShaders

export class WebGLDisplacementGenerator {
  private canvas: HTMLCanvasElement
  private gl: WebGLRenderingContext
  private program: WebGLProgram | null = null

  constructor(private options: { width: number; height: number; fragment: string }) {
    this.canvas = document.createElement("canvas")
    this.canvas.width = options.width
    this.canvas.height = options.height
    
    const gl = this.canvas.getContext("webgl", { preserveDrawingBuffer: true, antialias: false })
    if (!gl) throw new Error("WebGL not supported")
    this.gl = gl

    this.program = this.initProgram()
  }

  public resize(width: number, height: number) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
      this.gl.viewport(0, 0, width, height)
    }
  }

  private initProgram(): WebGLProgram {
    const gl = this.gl
    const vsSource = `
      attribute vec2 position;
      varying vec2 vUv;
      void main() {
        vUv = position * 0.5 + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `
    const fsSource = this.options.fragment

    const vs = gl.createShader(gl.VERTEX_SHADER)!
    gl.shaderSource(vs, vsSource)
    gl.compileShader(vs)

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!
    gl.shaderSource(fs, fsSource)
    gl.compileShader(fs)

    const program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)

    return program
  }

  updateShader(): string {
    const gl = this.gl
    if (!this.program) return ""

    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.useProgram(this.program)

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

    const posAttrib = gl.getAttribLocation(this.program, "position")
    gl.enableVertexAttribArray(posAttrib)
    gl.vertexAttribPointer(posAttrib, 2, gl.FLOAT, false, 0, 0)

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    return this.canvas.toDataURL()
  }

  destroy(): void {
    if (this.program) {
      this.gl.deleteProgram(this.program)
    }
    this.canvas.remove()
  }
}
