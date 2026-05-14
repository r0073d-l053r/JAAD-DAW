let gl: WebGLRenderingContext | null = null;
let program: WebGLProgram | null = null;
let positionBuffer: WebGLBuffer | null = null;
let canvas: OffscreenCanvas | null = null;

let uResolutionLoc: WebGLUniformLocation | null = null;
let uTimeLoc: WebGLUniformLocation | null = null;
let uDimLoc: WebGLUniformLocation | null = null;
let uBeatLoc: WebGLUniformLocation | null = null;
let uIsPlayingLoc: WebGLUniformLocation | null = null;

let isDimmed = 0.0;
let currentTime = 0.0;
let currentBeat = 0.0;
let isPlaying = 0.0;
let lastFrameTime = 0;

const vsSource = `
  attribute vec2 a_position;
  varying vec2 vUv;
  void main() {
    vUv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0, 1);
  }
`;

const fsSource = `
  precision mediump float;
  varying vec2 vUv;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_dim;
  uniform float u_beat;
  uniform float u_isPlaying;

  float blob(vec2 uv, vec2 pos, float size) {
    return size / length(uv - pos);
  }

  void main() {
    vec3 colors[5];
    colors[0] = vec3(0.57, 0.2, 0.92); // Bright Purple
    colors[1] = vec3(0.23, 0.51, 0.96); // Bright Blue
    colors[2] = vec3(0.08, 0.72, 0.65); // Bright Teal
    colors[3] = vec3(0.93, 0.28, 0.6);  // Bright Pink
    colors[4] = vec3(0.39, 0.4, 0.95);  // Bright Indigo

    // Use UV coordinates for resolution independence
    vec2 p = vUv * 2.0 - 1.0;
    p.x *= u_resolution.x / u_resolution.y;

    vec3 finalColor = vec3(0.0);
    
    // Pulse intensity based on beat
    float pulse = sin(u_beat * 3.14159 * 2.0) * 0.5 + 0.5;
    pulse = pow(pulse, 3.0);
    
    for(int i = 0; i < 8; i++) {
      float fi = float(i);
      float t = (u_time * 0.3) + (u_beat * 0.2 * u_isPlaying) + fi * 1.5;
      
      vec2 pos = vec2(
        sin(t * 0.7 + fi) * 0.9,
        cos(t * 0.5 + fi * 1.2) * 0.6
      );
      
      float size = (0.2 + sin(t * 0.3) * 0.05) * (1.0 + pulse * 0.3);
      
      float b = blob(p, pos, size);
      // More aggressive smoothstep for punchier colors
      b = smoothstep(0.1, 0.9, b);
      
      vec3 color = colors[0];
      if (i == 1) color = colors[1];
      else if (i == 2) color = colors[2];
      else if (i == 3) color = colors[3];
      else if (i == 4) color = colors[4];
      else if (i == 5) color = colors[0];
      else if (i == 6) color = colors[1];
      else if (i == 7) color = colors[2];
      
      finalColor += color * b * 0.8;
    }

    finalColor *= (1.0 - u_dim * 0.5);
    finalColor += vec3(0.15, 0.08, 0.25) * pulse * 0.4 * u_isPlaying;
    
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

function initGL(offscreen: OffscreenCanvas, width: number, height: number) {
  canvas = offscreen;
  canvas.width = width;
  canvas.height = height;

  gl = offscreen.getContext('webgl', { antialias: true }) as WebGLRenderingContext;
  if (!gl) {
    console.error("WebGL not supported in worker");
    return;
  }

  const createShader = (type: number, source: string) => {
    const shader = gl!.createShader(type)!;
    gl!.shaderSource(shader, source);
    gl!.compileShader(shader);
    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
      console.error("Shader compile error:", gl!.getShaderInfoLog(shader));
    }
    return shader;
  };

  program = gl.createProgram()!;
  gl.attachShader(program, createShader(gl.VERTEX_SHADER, vsSource));
  gl.attachShader(program, createShader(gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Program link error:", gl.getProgramInfoLog(program));
  }

  positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

  uResolutionLoc = gl.getUniformLocation(program, 'u_resolution');
  uTimeLoc = gl.getUniformLocation(program, 'u_time');
  uDimLoc = gl.getUniformLocation(program, 'u_dim');
  uBeatLoc = gl.getUniformLocation(program, 'u_beat');
  uIsPlayingLoc = gl.getUniformLocation(program, 'u_isPlaying');

  requestAnimationFrame((time) => {
    lastFrameTime = time;
    render(time);
  });
}

function render(time: number) {
  if (!gl || !program || !canvas) return;

  const dt = (time - lastFrameTime) * 0.001;
  lastFrameTime = time;
  currentTime += dt;

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(program);
  
  const posLoc = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(posLoc);
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  gl.uniform2f(uResolutionLoc, canvas.width, canvas.height);
  gl.uniform1f(uTimeLoc, currentTime);
  gl.uniform1f(uDimLoc, isDimmed);
  gl.uniform1f(uBeatLoc, currentBeat);
  gl.uniform1f(uIsPlayingLoc, isPlaying);

  gl.drawArrays(gl.TRIANGLES, 0, 6);
  requestAnimationFrame(render);
}

self.onmessage = (e) => {
  const { type, canvas: offscreen, width, height, value, beat, isPlaying: playing } = e.data;

  if (type === 'init' && offscreen) {
    initGL(offscreen, width || 300, height || 150);
  } else if (type === 'resize' && canvas) {
    canvas.width = width;
    canvas.height = height;
  } else if (type === 'dim') {
    isDimmed = value ? 1.0 : 0.0;
  } else if (type === 'transport') {
    currentBeat = beat || 0;
    isPlaying = playing ? 1.0 : 0.0;
  }
};
