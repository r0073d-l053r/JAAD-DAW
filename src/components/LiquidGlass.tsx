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
  /** Toggle dark tint for bright backgrounds */
  overLight?: boolean;
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
      <filter 
        id={id} 
        x="-35%" y="-35%" width="170%" height="170%" 
        filterUnits="objectBoundingBox"
        primitiveUnits="userSpaceOnUse"
        colorInterpolationFilters="sRGB"
      >
        <feImage 
          x="0" y="0" width="100%" height="100%" 
          result="DISPLACEMENT_MAP" 
          href={getMap(mode, shaderMapUrl)} 
          preserveAspectRatio="none" 
        />

        {/* Create edge mask using the displacement map itself */}
        <feColorMatrix
          in="DISPLACEMENT_MAP"
          type="matrix"
          values="0.3 0.3 0.3 0 0
                  0.3 0.3 0.3 0 0
                  0.3 0.3 0.3 0 0
                  0 0 0 1 0"
          result="EDGE_INTENSITY"
        />
        <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK">
          <feFuncA type="discrete" tableValues={`0 ${aberrationIntensity * 0.05} 1`} />
        </feComponentTransfer>

        <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL" />
        
        <feDisplacementMap 
          in="SourceGraphic" in2="DISPLACEMENT_MAP" 
          scale={displacementScale} 
          xChannelSelector="R" yChannelSelector="G" 
          result="RED_DISPLACED" 
        />
        <feColorMatrix in="RED_DISPLACED" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="RED_CHANNEL" />

        <feDisplacementMap 
          in="SourceGraphic" in2="DISPLACEMENT_MAP" 
          scale={displacementScale - (aberrationIntensity * 2)} 
          xChannelSelector="R" yChannelSelector="G" 
          result="GREEN_DISPLACED" 
        />
        <feColorMatrix in="GREEN_DISPLACED" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="GREEN_CHANNEL" />

        <feDisplacementMap 
          in="SourceGraphic" in2="DISPLACEMENT_MAP" 
          scale={displacementScale - (aberrationIntensity * 4)} 
          xChannelSelector="R" yChannelSelector="G" 
          result="BLUE_DISPLACED" 
        />
        <feColorMatrix in="BLUE_DISPLACED" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="BLUE_CHANNEL" />

        <feBlend in="GREEN_CHANNEL" in2="BLUE_CHANNEL" mode="screen" result="GB_COMBINED" />
        <feBlend in="RED_CHANNEL" in2="GB_COMBINED" mode="screen" result="RGB_COMBINED" />
        
        <feGaussianBlur in="RGB_COMBINED" stdDeviation="0.5" result="ABERRATED_BLURRED" />
        <feComposite in="ABERRATED_BLURRED" in2="EDGE_MASK" operator="in" result="EDGE_ABERRATION" />

        <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK">
          <feFuncA type="table" tableValues="1 0" />
        </feComponentTransfer>
        <feComposite in="CENTER_ORIGINAL" in2="INVERTED_MASK" operator="in" result="CENTER_CLEAN" />

        <feComposite in="EDGE_ABERRATION" in2="CENTER_CLEAN" operator="over" />
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
  blurAmount = 10,
  saturation = 140,
  backgroundOpacity = 0.1,
  mode = 'prominent',
  displacementScale = 100,
  aberrationIntensity = 2,
  overLight = false,
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
        isolation: 'isolate',
        ...style,
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
    >
      <svg style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }} aria-hidden="true">
        <defs>
          <filter 
            id={filterId} 
            x="-35%" y="-35%" width="170%" height="170%" 
            filterUnits="objectBoundingBox"
            primitiveUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feImage 
              x="0" y="0" width="100%" height="100%" 
              result="DISPLACEMENT_MAP" 
              href={getMap(mode, shaderMapUrl)} 
              preserveAspectRatio="none" 
            />

            {/* Create edge mask using the displacement map itself */}
            <feColorMatrix
              in="DISPLACEMENT_MAP"
              type="matrix"
              values="0.3 0.3 0.3 0 0
                      0.3 0.3 0.3 0 0
                      0.3 0.3 0.3 0 0
                      0 0 0 1 0"
              result="EDGE_INTENSITY"
            />
            <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK">
              <feFuncA type="discrete" tableValues={`0 ${aberrationIntensity * 0.05} 1`} />
            </feComponentTransfer>

            <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL" />
            
            <feDisplacementMap 
              in="SourceGraphic" in2="DISPLACEMENT_MAP" 
              scale={displacementScale} 
              xChannelSelector="R" yChannelSelector="G" 
              result="RED_DISPLACED" 
            />
            <feColorMatrix in="RED_DISPLACED" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="RED_CHANNEL" />

            <feDisplacementMap 
              in="SourceGraphic" in2="DISPLACEMENT_MAP" 
              scale={displacementScale - (aberrationIntensity * 2)} 
              xChannelSelector="R" yChannelSelector="G" 
              result="GREEN_DISPLACED" 
            />
            <feColorMatrix in="GREEN_DISPLACED" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="GREEN_CHANNEL" />

            <feDisplacementMap 
              in="SourceGraphic" in2="DISPLACEMENT_MAP" 
              scale={displacementScale - (aberrationIntensity * 4)} 
              xChannelSelector="R" yChannelSelector="G" 
              result="BLUE_DISPLACED" 
            />
            <feColorMatrix in="BLUE_DISPLACED" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="BLUE_CHANNEL" />

            <feBlend in="GREEN_CHANNEL" in2="BLUE_CHANNEL" mode="screen" result="GB_COMBINED" />
            <feBlend in="RED_CHANNEL" in2="GB_COMBINED" mode="screen" result="RGB_COMBINED" />
            
            <feGaussianBlur in="RGB_COMBINED" stdDeviation="0.5" result="ABERRATED_BLURRED" />
            <feComposite in="ABERRATED_BLURRED" in2="EDGE_MASK" operator="in" result="EDGE_ABERRATION" />

            <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK">
              <feFuncA type="table" tableValues="1 0" />
            </feComponentTransfer>
            <feComposite in="CENTER_ORIGINAL" in2="INVERTED_MASK" operator="in" result="CENTER_CLEAN" />

            <feComposite in="EDGE_ABERRATION" in2="CENTER_CLEAN" operator="over" />
          </filter>
        </defs>
      </svg>

      {/* ── Background Glass Layers (Clipped) ── */}
      <div 
        style={{ 
          position: 'absolute', 
          inset: 0, 
          overflow: 'hidden', 
          borderRadius: `${cornerRadius}px`,
          zIndex: 0,
          pointerEvents: 'none',
          boxShadow: overLight ? '0 16px 70px rgba(0,0,0,0.5)' : '0 12px 40px rgba(0,0,0,0.3)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: `${cornerRadius}px`,
            backdropFilter: `blur(${blurAmount + (overLight ? 4 : 0)}px) saturate(${saturation}%) brightness(${overLight ? 0.8 : 1.1})`,
            WebkitBackdropFilter: `blur(${blurAmount + (overLight ? 4 : 0)}px) saturate(${saturation}%) brightness(${overLight ? 0.8 : 1.1})`,
            filter: `url(#${filterId})`,
            backgroundColor: overLight ? 'rgba(0, 0, 0, 0.4)' : `rgba(15, 15, 25, ${backgroundOpacity})`,
            zIndex: 0,
          }}
        />

        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: `${cornerRadius}px`,
            background: `linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 50%, rgba(255,255,255,0.05) 100%)`,
            zIndex: 1,
          }}
        />

        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: `${cornerRadius}px`,
            padding: '1px',
            background: `linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.02) 40%, rgba(255,255,255,0.1) 100%)`,
            WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            zIndex: 2,
          }}
        />
      </div>

      {/* ── Content (Unclipped for dropdowns) ── */}
      <div className={contentClassName} style={{ position: 'relative', zIndex: 10 }}>
        {children}
      </div>
    </div>
  );
}
