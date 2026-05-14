import React, { useEffect, useRef } from 'react';
import { audioEngine } from '../lib/audioEngine';

interface WebGLBackgroundProps {
  isDimmed?: boolean;
}

const transferredCanvases = new WeakSet<HTMLCanvasElement>();

export function WebGLBackground({ isDimmed = false }: WebGLBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set size
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) return;

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

      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        p.x *= u_resolution.x / u_resolution.y;

        // Deep base color from your 'before' photo
        vec3 finalColor = vec3(0.04, 0.01, 0.08); 
        
        float pulse = sin(u_beat * 3.14159 * 2.0) * 0.5 + 0.5;
        pulse = pow(pulse, 3.0);
        
        // 6 MASSIVE blobs with interaction physics
        for(int i = 0; i < 6; i++) {
          float fi = float(i);
          
          // Higher base speed (0.25)
          float t = (u_time * 0.25) + fi * 2.5;
          
          // Add a "jiggle" factor that mimics collision/acceleration
          float interaction = sin(u_time * 1.1 + fi * 0.5) * 0.2;
          
          vec2 pos = vec2(
            sin(t * 0.53 + interaction) * 0.8 + cos(t * 0.21 + fi) * 0.5,
            cos(t * 0.37 + interaction) * 0.6 + sin(t * 0.13 + fi * 1.2) * 0.4
          );
          
          // Size wobbles more aggressively for "stretching" look
          float sizeWobble = sin(t * 0.8 + fi) * 0.2;
          float size = 1.5 + sizeWobble;
          
          float fade = sin(t * 0.4 + fi * 1.5) * 0.4 + 0.6;
          float d = length(p - pos);
          
          float b = smoothstep(size, 0.0, d);
          b = pow(b, 2.2);
          
          vec3 color;
          if(i == 0) color = vec3(0.5, 0.2, 0.9); // Purple
          else if(i == 1) color = vec3(0.2, 0.4, 1.0); // Blue
          else if(i == 2) color = vec3(0.8, 0.2, 0.5); // Magenta
          else if(i == 3) color = vec3(0.1, 0.6, 0.8); // Teal
          else if(i == 4) color = vec3(0.4, 0.1, 0.7); // Deep Indigo
          else color = vec3(0.3, 0.5, 0.9); // Sky

          // Screen Blend with increased intensity during "collision" (fade)
          finalColor = 1.0 - (1.0 - finalColor) * (1.0 - color * b * fade * 0.7);
        }

        // Apply beat reactive pulse to the overall intensity
        finalColor *= (1.0 + pulse * 0.1);
        
        finalColor *= (1.0 - u_dim * 0.5);
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `;

    const createShader = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };

    const program = gl.createProgram()!;
    gl.attachShader(program, createShader(gl.VERTEX_SHADER, vsSource));
    gl.attachShader(program, createShader(gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);

    const uRes = gl.getUniformLocation(program, 'u_resolution');
    const uTime = gl.getUniformLocation(program, 'u_time');
    const uDim = gl.getUniformLocation(program, 'u_dim');
    const uBeat = gl.getUniformLocation(program, 'u_beat');
    const uPlaying = gl.getUniformLocation(program, 'u_isPlaying');
    const aPos = gl.getAttribLocation(program, 'a_position');

    let animId: number;
    const render = (time: number) => {
      const state = audioEngine.getTransportState();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.enableVertexAttribArray(aPos);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, time * 0.001);
      gl.uniform1f(uDim, isDimmed ? 1.0 : 0.0);
      gl.uniform1f(uBeat, state.beat);
      gl.uniform1f(uPlaying, state.isPlaying ? 1.0 : 0.0);
      
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      animId = requestAnimationFrame(render);
    };
    animId = requestAnimationFrame(render);

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, [isDimmed]);

  return (
    <div className="fixed inset-0 z-[-1] bg-black overflow-hidden pointer-events-none">
      <canvas
        ref={canvasRef}
        className="w-full h-full pointer-events-none transition-opacity duration-1000"
      />
      {/* Restore original overlays for depth and legibility */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/60 pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.4)_100%)] pointer-events-none" />
    </div>
  );
}
