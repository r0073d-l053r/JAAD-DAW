/**
 * LiquidGlass - High-fidelity liquid glass effect for JAAD.
 * Implements refractive displacement, chromatic aberration, and layered aesthetics.
 * Filter pipeline adapted from rdev/liquid-glass-react (vendored in
 * liquid-glass-package/), wrapped in this app's panel contract:
 *
 *   PANEL CONTRACT (do not break — each clause guards a shipped regression):
 *   1. The root div carries className/style and is sized by the app's layout
 *      (e.g. h-full sidebars). Glass layers live in an absolutely-positioned
 *      clip box (inset: 0) so the glass ALWAYS fills the root — never sized
 *      by content (that shrank the AI Copilot sidebar to half height).
 *   2. Content renders OUTSIDE the overflow:hidden clip box, zIndex 10, so
 *      dropdowns/popups can overflow the panel (clipping it inside the glass
 *      made the Create-form instrument menu disappear).
 *   3. No opaque body fills, no global blur caps/floors, no white washes —
 *      per-call-site blur/opacity props are honored verbatim. Heavy dark
 *      fills turned panels into black slabs; washes turned them into fog.
 */

import React, { useRef, useState, useEffect, useId, useContext, createContext } from 'react';
import { ShaderDisplacementGenerator, fragmentShaders } from './LiquidGlassShaderUtils';
import { displacementMap, polarDisplacementMap, prominentDisplacementMap } from './LiquidGlassUtils';

// ─────────────────────────────────────────────────────────────────────────────
// Theme-system types and defaults (consumed by store.tsx / SettingsModal.tsx)
// ─────────────────────────────────────────────────────────────────────────────

/** User-tunable glass settings exposed in Settings → Theme. */
export interface GlassEffectSettings {
  displacementScale: number;
  blurAmount: number;
  saturation: number;
  aberrationIntensity: number;
  cornerRadius: number;
  mode: 'standard' | 'polar' | 'prominent' | 'shader';
  overLight: boolean;
  backgroundOpacity: number;
}

/** Canonical defaults — the user-approved baseline look. blurAmount is px. */
export const DEFAULT_GLASS_SETTINGS: GlassEffectSettings = {
  displacementScale: 100,
  blurAmount: 10,
  saturation: 140,
  aberrationIntensity: 2,
  cornerRadius: 20,
  mode: 'standard',
  overLight: false,
  backgroundOpacity: 0.1,
};

export interface GlassThemeContextValue {
  /** Store-driven defaults; explicit per-call-site props always win. */
  glassSettings: GlassEffectSettings;
  /** When true, panels render the cheap flat path (no SVG filter, no backdrop-filter). */
  performanceMode: boolean;
}

/**
 * Optional store-driven defaults. Panels render fine WITHOUT a provider
 * (tests render LiquidGlassPanel standalone) by falling back to the defaults.
 */
export const GlassThemeContext = createContext<GlassThemeContextValue | null>(null);

interface LiquidGlassProps {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  style?: React.CSSProperties;
  cornerRadius?: number;
  /** Backdrop blur in px. */
  blurAmount?: number;
  /** Saturation boost percentage. */
  saturation?: number;
  /** Base background opacity 0–1 of the dark tint. */
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
  /** Darker treatment for panels that sit over bright/busy content. */
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
    default: return displacementMap;
  }
};

export function LiquidGlassPanel({
  children,
  className = '',
  contentClassName = '',
  style,
  cornerRadius: cornerRadiusProp,
  blurAmount: blurAmountProp,
  saturation: saturationProp,
  backgroundOpacity: backgroundOpacityProp,
  mode: modeProp,
  displacementScale: displacementScaleProp,
  aberrationIntensity: aberrationIntensityProp,
  overLight: overLightProp,
  onDragOver,
  onDragLeave,
  onDrop,
  onClick,
  glassSize
}: LiquidGlassProps) {
  // Theme integration. Inside the app provider the Theme sliders must have a
  // VISIBLE effect on every panel (the user drags them expecting live change):
  //  - Filter params (mode/displacement/aberration/saturation) are global —
  //    the theme value is authoritative; call-site pins are ignored.
  //  - Frost params (blur/opacity/cornerRadius) SCALE each call site's value
  //    proportionally, so the global sliders move every panel while the
  //    designed hierarchy (thin pills vs frosted dialogs) is preserved.
  // Outside any provider (tests, standalone) props behave exactly as before.
  const glassTheme = useContext(GlassThemeContext);
  const themeDefaults = glassTheme?.glassSettings ?? DEFAULT_GLASS_SETTINGS;
  const performanceMode = glassTheme?.performanceMode ?? false;
  const D = DEFAULT_GLASS_SETTINGS;

  const mode = glassTheme ? themeDefaults.mode : (modeProp ?? D.mode);
  const displacementScale = glassTheme ? themeDefaults.displacementScale : (displacementScaleProp ?? D.displacementScale);
  const aberrationIntensity = glassTheme ? themeDefaults.aberrationIntensity : (aberrationIntensityProp ?? D.aberrationIntensity);
  const saturation = glassTheme ? themeDefaults.saturation : (saturationProp ?? D.saturation);

  const blurRatio = glassTheme ? themeDefaults.blurAmount / D.blurAmount : 1;
  const tintRatio = glassTheme ? themeDefaults.backgroundOpacity / D.backgroundOpacity : 1;
  const radiusRatio = glassTheme ? themeDefaults.cornerRadius / D.cornerRadius : 1;
  const blurAmount = (blurAmountProp ?? D.blurAmount) * blurRatio;
  const backgroundOpacity = Math.min(0.6, (backgroundOpacityProp ?? D.backgroundOpacity) * tintRatio);
  const cornerRadius = Math.round((cornerRadiusProp ?? D.cornerRadius) * radiusRatio);
  const overLight = overLightProp ?? themeDefaults.overLight;

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

  // Generate shader map if needed (skipped entirely on the flat performance path)
  useEffect(() => {
    if (performanceMode) return;
    if (mode === 'shader' && size.width > 0) {
      const generator = new ShaderDisplacementGenerator({
        width: size.width,
        height: size.height,
        fragment: fragmentShaders.liquidGlass,
      });
      setShaderMapUrl(generator.updateShader());
      generator.destroy();
    }
  }, [performanceMode, mode, size.width, size.height]);

  // ── Cheap flat path (Performance Mode) ──
  if (performanceMode) {
    return (
      <div
        ref={panelRef}
        className={className}
        style={{ position: 'relative', borderRadius: `${cornerRadius}px`, ...style }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={onClick}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: `${cornerRadius}px`,
            // Fully opaque matte — performance mode must never be see-through.
            background: 'rgb(24, 24, 27)',
            border: '1px solid color-mix(in srgb, var(--color-primary) 25%, rgba(255, 255, 255, 0.07))',
            boxShadow: overLight ? '0 16px 70px rgba(0,0,0,0.5)' : '0 12px 40px rgba(0,0,0,0.3)',
            pointerEvents: 'none',
          }}
        />
        <div className={contentClassName} style={{ position: 'relative', zIndex: 10 }}>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className={className}
      style={{
        position: 'relative',
        borderRadius: `${cornerRadius}px`,
        ...style,
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
    >
      {/* Upstream rdev filter graph, VERBATIM (liquid-glass-package/src). Do
          not "improve" it from embedded-preview probes — that renderer paints
          these filters differently from real Chrome, where the demo (and this
          exact graph) visibly refracts. Channels x=R / y=B with NEGATIVE
          scale; aberration multiplies per-channel scale (rainbow edge fringe
          that grows with the slider); the map keeps its aspect via slice; a
          clean centre copy is composited back so only the edge band warps. */}
      <svg style={{ position: 'absolute', width: size.width, height: size.height, pointerEvents: 'none' }} aria-hidden="true">
        <defs>
          <filter id={filterId} x="-35%" y="-35%" width="170%" height="170%" colorInterpolationFilters="sRGB">
            <feImage
              x="0" y="0" width="100%" height="100%"
              result="DISPLACEMENT_MAP"
              href={getMap(mode, shaderMapUrl)}
              preserveAspectRatio="xMidYMid slice"
            />

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
              scale={displacementScale * (mode === 'shader' ? 1 : -1)}
              xChannelSelector="R" yChannelSelector="B"
              result="RED_DISPLACED"
            />
            <feColorMatrix in="RED_DISPLACED" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="RED_CHANNEL" />

            <feDisplacementMap
              in="SourceGraphic" in2="DISPLACEMENT_MAP"
              scale={displacementScale * ((mode === 'shader' ? 1 : -1) - aberrationIntensity * 0.05)}
              xChannelSelector="R" yChannelSelector="B"
              result="GREEN_DISPLACED"
            />
            <feColorMatrix in="GREEN_DISPLACED" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="GREEN_CHANNEL" />

            <feDisplacementMap
              in="SourceGraphic" in2="DISPLACEMENT_MAP"
              scale={displacementScale * ((mode === 'shader' ? 1 : -1) - aberrationIntensity * 0.1)}
              xChannelSelector="R" yChannelSelector="B"
              result="BLUE_DISPLACED"
            />
            <feColorMatrix in="BLUE_DISPLACED" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="BLUE_CHANNEL" />

            <feBlend in="GREEN_CHANNEL" in2="BLUE_CHANNEL" mode="screen" result="GB_COMBINED" />
            <feBlend in="RED_CHANNEL" in2="GB_COMBINED" mode="screen" result="RGB_COMBINED" />

            <feGaussianBlur in="RGB_COMBINED" stdDeviation={Math.max(0.1, 0.5 - aberrationIntensity * 0.1)} result="ABERRATED_BLURRED" />

            <feComposite in="ABERRATED_BLURRED" in2="EDGE_MASK" operator="in" result="EDGE_ABERRATION" />

            <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK">
              <feFuncA type="table" tableValues="1 0" />
            </feComponentTransfer>
            <feComposite in="CENTER_ORIGINAL" in2="INVERTED_MASK" operator="in" result="CENTER_CLEAN" />

            <feComposite in="EDGE_ABERRATION" in2="CENTER_CLEAN" operator="over" />
          </filter>
        </defs>
      </svg>

      {/* ── Glass clip box (PANEL CONTRACT clause 1) ──
          Fills the root via inset:0; carries the frost, tint and shadow. The
          backdrop-filter must live on this clipping element itself — children
          can't sample the page backdrop through a rounded overflow:hidden
          surface in Chromium. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          borderRadius: `${cornerRadius}px`,
          zIndex: 0,
          pointerEvents: 'none',
          boxShadow: overLight ? '0 16px 70px rgba(0,0,0,0.5)' : '0 12px 40px rgba(0,0,0,0.3)',
          backdropFilter: `blur(${blurAmount + (overLight ? 4 : 0)}px) saturate(${saturation}%) brightness(${overLight ? 0.8 : 1.1})`,
          WebkitBackdropFilter: `blur(${blurAmount + (overLight ? 4 : 0)}px) saturate(${saturation}%) brightness(${overLight ? 0.8 : 1.1})`,
          backgroundColor: overLight ? 'rgba(0, 0, 0, 0.4)' : `rgba(15, 15, 25, ${backgroundOpacity})`,
        }}
      >
        {/* ── Liquid warp (the rdev signature) ──
            Upstream's exact arrangement: one element whose backdrop-filter
            frosts the backdrop and whose filter:url() pushes that painted
            result through the displacement graph — bending the edge band and
            splitting it into the chromatic fringe (the fringe magnitude scales
            with displacement × aberration, so both sliders read visibly even
            on heavy frost). The graph's clean-centre composite repaints the
            same frost mid-panel, so legibility is unchanged. Where a Chromium
            build can't combine the two, this layer contributes nothing and
            the clip box's frost below keeps the panel legible. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: `${cornerRadius}px`,
            backdropFilter: `blur(${blurAmount + (overLight ? 4 : 0)}px) saturate(${saturation}%)`,
            WebkitBackdropFilter: `blur(${blurAmount + (overLight ? 4 : 0)}px) saturate(${saturation}%)`,
            filter: `url(#${filterId})`,
            zIndex: 0,
          }}
        />

        {/* Diagonal sheen */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: `${cornerRadius}px`,
            background: `linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 50%, rgba(255,255,255,0.05) 100%)`,
            zIndex: 1,
          }}
        />

        {/* Specular rim — upstream rdev's two stacked gradient rings
            (screen + overlay blends), frozen at the static base angle. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: `${cornerRadius}px`,
            padding: '1.5px',
            mixBlendMode: 'screen',
            opacity: 0.4,
            WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            boxShadow:
              '0 0 0 0.5px rgba(255, 255, 255, 0.5) inset, 0 1px 3px rgba(255, 255, 255, 0.25) inset, 0 1px 4px rgba(0, 0, 0, 0.35)',
            background: `linear-gradient(135deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.12) 33%, rgba(255,255,255,0.4) 66%, rgba(255,255,255,0) 100%)`,
            zIndex: 2,
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: `${cornerRadius}px`,
            padding: '1.5px',
            mixBlendMode: 'overlay',
            WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            boxShadow:
              '0 0 0 0.5px rgba(255, 255, 255, 0.5) inset, 0 1px 3px rgba(255, 255, 255, 0.25) inset, 0 1px 4px rgba(0, 0, 0, 0.35)',
            background: `linear-gradient(135deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.32) 33%, rgba(255,255,255,0.6) 66%, rgba(255,255,255,0) 100%)`,
            zIndex: 3,
          }}
        />
      </div>

      {/* ── Content (PANEL CONTRACT clause 2: unclipped, above the glass) ── */}
      <div className={contentClassName} style={{ position: 'relative', zIndex: 10 }}>
        {children}
      </div>
    </div>
  );
}
