import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';

interface StudioBackgroundProps {
  isDimmed?: boolean;
  colors?: string[];
  disableAnimation?: boolean;
}

export function StudioBackground({ isDimmed = false, colors: propColors, disableAnimation = false }: StudioBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorsRef = useRef<string[]>([]);
  const blobsRef = useRef<any[]>([]);

  // Higher visibility, more diverse color palette inspired by the "brighter/random" request
  const defaultColors = [
    'rgba(147, 51, 234, 0.7)',   // Bright Purple
    'rgba(59, 130, 246, 0.7)',   // Bright Blue
    'rgba(20, 184, 166, 0.7)',   // Bright Teal
    'rgba(236, 72, 153, 0.7)',   // Bright Pink
    'rgba(244, 63, 94, 0.7)',    // Bright Rose
    'rgba(99, 102, 241, 0.7)',   // Bright Indigo
    'rgba(14, 165, 233, 0.7)',   // Bright Sky
    'rgba(168, 85, 247, 0.7)',   // Purple-Light
    'rgba(79, 70, 229, 0.7)',    // Indigo-Rich
    'rgba(6, 182, 212, 0.7)',    // Cyan
    'rgba(192, 38, 211, 0.7)',   // Fuchsia
    'rgba(124, 58, 237, 0.7)',   // Violet
  ];

  useEffect(() => {
    colorsRef.current = propColors && propColors.length > 0 ? propColors : defaultColors;
    if (blobsRef.current.length > 0) {
      blobsRef.current.forEach(blob => {
        blob.color = colorsRef.current[Math.floor(Math.random() * colorsRef.current.length)];
      });
    }
  }, [propColors]);

  useEffect(() => {
    if (disableAnimation) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let w: number, h: number;

    // Increased number of blobs for more "random" and textured feel
    const numBlobs = 16;

    class Blob {
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      color: string;

      constructor() {
        this.x = Math.random() * w;
        this.y = Math.random() * h;
        // Slightly faster and more varied speeds
        this.vx = (Math.random() - 0.5) * 1.2;
        this.vy = (Math.random() - 0.5) * 1.2;
        // Varied sizes
        this.r = Math.random() * 500 + 400;
        this.color = colorsRef.current[Math.floor(Math.random() * colorsRef.current.length)];
      }

      update() {
        this.x += this.vx;
        this.y += this.vy;

        if (this.x < -this.r) this.x = w + this.r;
        if (this.x > w + this.r) this.x = -this.r;
        if (this.y < -this.r) this.y = h + this.r;
        if (this.y > h + this.r) this.y = -this.r;
      }

      draw() {
        if (!ctx) return;
        const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.r);
        grad.addColorStop(0, this.color);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const resize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };

    const init = () => {
      resize();
      blobsRef.current = [];
      for (let i = 0; i < numBlobs; i++) {
        blobsRef.current.push(new Blob());
      }
    };

    const render = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'screen';
      
      blobsRef.current.forEach(blob => {
        blob.update();
        blob.draw();
      });

      animationFrameId = requestAnimationFrame(render);
    };

    window.addEventListener('resize', resize);
    init();
    render();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [disableAnimation]);

  return (
    <div className="fixed inset-0 z-0 bg-black overflow-hidden pointer-events-none">
      {!disableAnimation && (
        <motion.canvas
          ref={canvasRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: isDimmed ? 0.6 : 1 }}
          transition={{ duration: 2, ease: "easeInOut" }}
          className="w-full h-full opacity-100 blur-[110px]"
        />
      )}
      {/* Refined overlays for depth and UI legibility - Lightened for better visibility during dimming */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/50 pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.2)_100%)] pointer-events-none" />
    </div>
  );
}
