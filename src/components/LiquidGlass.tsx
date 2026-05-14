/**
 * LiquidGlass - High-fidelity liquid glass effect for JAAD.
 * Implements refractive displacement, chromatic aberration, and layered aesthetics.
 * Adapted from the liquid-glass-package.
 */

import React, { useRef, useState, useEffect, useId, forwardRef, CSSProperties } from 'react';
import { ShaderDisplacementGenerator, fragmentShaders } from './LiquidGlassShaderUtils';
import { displacementMap, polarDisplacementMap, prominentDisplacementMap } from './LiquidGlassUtils';

interface LiquidGlassProps {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  style?: React.CSSProperties;
  cornerRadius?: number;
  /** Backdrop blur in px — default 32 */
  blurAmount?: number;
  /** Saturation boost — default 180 */
  saturation?: number;
  /** Base background opacity 0–1 — default 0.08 */
  backgroundOpacity?: number;
  /** Mode: 'standard', 'polar', 'prominent', or 'shader' */
  mode?: 'standard' | 'polar' | 'prominent' | 'shader';
  /** Displacement scale for the refraction effect */
  displacementScale?: number;
  /** Chromatic aberration intensity */
  aberrationIntensity?: number;
  /** Pass-through event handlers */
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDragLeave?: React.DragEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  /** Optional: specific size for the glass area */
  glassSize?: { width: number; height: number };
}

const getMap = (mode: 'standard' | 'polar' | 'prominent' | 'shader', shaderMapUrl?: string) => {
  switch (mode) {
    case 'standard': return displacementMap;
    case 'polar': return polarDisplacementMap;
    case 'prominent': return prominentDisplacementMap;
    case 'shader': return shaderMapUrl || displacementMap;
    default: return prominentDisplacementMap;
  }
};

const GlassFilter: React.FC<{ 
  id: string; 
  displacementScale: number; 
  aberrationIntensity: number; 
  width: number; 
  height: number; 
  mode: 'standard' | 'polar' | 'prominent' | 'shader'; 
  shaderMapUrl?: string 
}> = ({ id, displacementScale, aberrationIntensity, width, height, mode, shaderMapUrl }) => (
  <svg style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }} aria-hidden="true">
    <defs>
      <filter id={id} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
        <feImage 
          x="0" y="0" width="100%" height="100%" 
          result="DISPLACEMENT_MAP" 
          href={getMap(mode, shaderMapUrl)} 
          preserveAspectRatio="xMidYMid slice" 
        />

        {/* Edge detection/intensity from map */}
        <feColorMatrix
          in="DISPLACEMENT_MAP"
          type="matrix"
          values="0.3 0.3 0.3 0 0
                  0.3 0.3 0.3 0 0
                  0.3 0.3 0.3 0 0
                  0 0 0 1 0"
          result="EDGE_INTENSITY"
        />
        
        {/* Chromatic Aberration: Red channel */}
        <feDisplacementMap 
          in="SourceGraphic" in2="DISPLACEMENT_MAP" 
          scale={displacementScale} 
          xChannelSelector="R" yChannelSelector="G" 
          result="RED_DISPLACED" 
        />
        <feColorMatrix
          in="RED_DISPLACED"
          type="matrix"
          values="1 0 0 0 0
                  0 0 0 0 0
                  0 0 0 0 0
                  0 0 0 1 0"
          result="RED_CHANNEL"
        />

        {/* Green channel with slight scale offset */}
        <feDisplacementMap 
          in="SourceGraphic" in2="DISPLACEMENT_MAP" 
          scale={displacementScale - (aberrationIntensity * 2)} 
          xChannelSelector="R" yChannelSelector="G" 
          result="GREEN_DISPLACED" 
        />
        <feColorMatrix
          in="GREEN_DISPLACED"
          type="matrix"
          values="0 0 0 0 0
                  0 1 0 0 0
                  0 0 0 0 0
                  0 0 0 1 0"
          result="GREEN_CHANNEL"
        />

        {/* Blue channel with more scale offset */}
        <feDisplacementMap 
          in="SourceGraphic" in2="DISPLACEMENT_MAP" 
          scale={displacementScale - (aberrationIntensity * 4)} 
          xChannelSelector="R" yChannelSelector="G" 
          result="BLUE_DISPLACED" 
        />
        <feColorMatrix
          in="BLUE_DISPLACED"
          type="matrix"
          values="0 0 0 0 0
                  0 0 0 0 0
                  0 0 1 0 0
                  0 0 0 1 0"
          result="BLUE_CHANNEL"
        />

        <feBlend in="GREEN_CHANNEL" in2="BLUE_CHANNEL" mode="screen" result="GB_COMBINED" />
        <feBlend in="RED_CHANNEL" in2="GB_COMBINED" mode="screen" result="RGB_COMBINED" />
        
        {/* Soften the edges */}
        <feGaussianBlur in="RGB_COMBINED" stdDeviation="0.5" result="FINAL_BLUR" />
      </filter>
    </defs>
  </svg>
);

export function LiquidGlassPanel({
  children,
  className = '',
  contentClassName = '',
  style,
  cornerRadius = 20,
  blurAmount = 32,
  saturation = 180,
  backgroundOpacity = 0.08,
  mode = 'prominent',
  displacementScale = 30,
  aberrationIntensity = 2,
  onDragOver,
  onDragLeave,
  onDrop,
  onClick,
  glassSize
}: LiquidGlassProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const filterId = `glass-filter-${useId().replace(/:/g, '')}`;
  const [shaderMapUrl, setShaderMapUrl] = useState<string>('');
  const [size, setSize] = useState({ width: 300, height: 100 });

  // Update size for shader/filter mapping
  useEffect(() => {
    if (glassSize) {
      setSize(glassSize);
    } else if (panelRef.current) {
      const rect = panelRef.current.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    }
  }, [glassSize, children]);

  // Generate shader map if needed
  useEffect(() => {
    if (mode === 'shader' && size.width > 0) {
      const generator = new ShaderDisplacementGenerator({
        width: size.width,
        height: size.height,
        fragment: fragmentShaders.liquidGlass,
      });
      setShaderMapUrl(generator.updateShader());
      generator.destroy();
    }
  }, [mode, size.width, size.height]);

  return (
    <div
      ref={panelRef}
      className={className}
      style={{
        position: 'relative',
        borderRadius: `${cornerRadius}px`,
        overflow: 'hidden',
        isolation: 'isolate',
        ...style,
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
    >
      <GlassFilter 
        id={filterId}
        displacementScale={displacementScale}
        aberrationIntensity={aberrationIntensity}
        width={size.width}
        height={size.height}
        mode={mode}
        shaderMapUrl={shaderMapUrl}
      />

      {/* ── Layer 1: Frosted glass backdrop with liquid warp ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: `${cornerRadius}px`,
          backdropFilter: `blur(${blurAmount}px) saturate(${saturation}%) brightness(1.05)`,
          WebkitBackdropFilter: `blur(${blurAmount}px) saturate(${saturation}%) brightness(1.05)`,
          filter: `url(#${filterId})`,
          backgroundColor: `rgba(15, 15, 25, ${backgroundOpacity})`,
          zIndex: 0,
        }}
      />

      {/* ── Layer 2: Subtle Prismatic Sheen ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: `${cornerRadius}px`,
          background: `linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 50%, rgba(255,255,255,0.05) 100%)`,
          zIndex: 1,
          pointerEvents: 'none',
        }}
      />

      {/* ── Layer 3: Specular Edge (Glass border) ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: `${cornerRadius}px`,
          padding: '1px',
          background: `linear-gradient(135deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.05) 40%, rgba(255,255,255,0.1) 100%)`,
          WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          zIndex: 2,
          pointerEvents: 'none',
        }}
      />

      {/* ── Content ── */}
      <div className={contentClassName} style={{ position: 'relative', zIndex: 10 }}>
        {children}
      </div>
    </div>
  );
}
