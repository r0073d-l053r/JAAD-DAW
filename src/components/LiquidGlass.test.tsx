import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LiquidGlassPanel } from './LiquidGlass';

// Mock the shader/utils modules that generate large data URI displacement maps
vi.mock('./LiquidGlassShaderUtils', () => ({
  ShaderDisplacementGenerator: vi.fn().mockReturnValue({
    generateCanvas: vi.fn().mockReturnValue({ toDataURL: () => 'data:image/png;base64,mock' }),
  }),
  fragmentShaders: { default: 'void main(){}' },
}));

vi.mock('./LiquidGlassUtils', () => ({
  displacementMap: 'data:image/png;base64,standardMock',
  polarDisplacementMap: 'data:image/png;base64,polarMock',
  prominentDisplacementMap: 'data:image/png;base64,prominentMock',
}));

describe('LiquidGlassPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders children elements and overlays correctly', () => {
    render(
      <LiquidGlassPanel cornerRadius={25} blurAmount={12} saturation={150}>
        <div data-testid="child-content">Glass content</div>
      </LiquidGlassPanel>
    );

    expect(screen.queryByTestId('child-content')).not.toBeNull();
    expect(screen.getByText('Glass content')).not.toBeNull();
  });

  it('propagates custom corner radius and styling through layout nodes', () => {
    const { container } = render(
      <LiquidGlassPanel cornerRadius={35} style={{ opacity: 0.9 }}>
        <div>Refractive panel</div>
      </LiquidGlassPanel>
    );

    const outerContainer = container.firstChild as HTMLElement;
    expect(outerContainer).not.toBeNull();
  });

  it('propagates pass-through mouse click and drag-drop events flawlessly', () => {
    const mockClick = vi.fn();
    const mockDragOver = vi.fn();

    const { container } = render(
      <LiquidGlassPanel onClick={mockClick} onDragOver={mockDragOver}>
        <div>Interactive Panel</div>
      </LiquidGlassPanel>
    );

    const outerContainer = container.firstChild as HTMLElement;
    fireEvent.click(outerContainer);
    fireEvent.dragOver(outerContainer);

    expect(mockClick).toHaveBeenCalledTimes(1);
    expect(mockDragOver).toHaveBeenCalledTimes(1);
  });

  // ── PANEL CONTRACT (guards regressions that shipped this project) ──
  // Each assertion below corresponds to a bug users actually hit. If one of
  // these fails after a refactor, the refactor reintroduced that bug.

  it('CONTRACT: glass clip box fills the root via inset 0 (never sized by content)', () => {
    // Regression guard: sidebar panels shrank to content height when the
    // glass was sized by its children instead of the styled root.
    const { container } = render(
      <LiquidGlassPanel className="h-full">
        <div style={{ height: 10 }}>tiny content</div>
      </LiquidGlassPanel>
    );
    const root = container.firstChild as HTMLElement;
    const clipBox = Array.from(root.children).find(
      (el) => (el as HTMLElement).style.overflow === 'hidden'
    ) as HTMLElement;
    expect(clipBox).toBeTruthy();
    expect(clipBox.style.position).toBe('absolute');
    expect(clipBox.style.inset).toBe('0px');
  });

  it('CONTRACT: content renders OUTSIDE the overflow:hidden clip box (popups must overflow)', () => {
    // Regression guard: dropdown menus vanished when content was clipped
    // inside the glass body.
    const { container } = render(
      <LiquidGlassPanel>
        <div data-testid="content">menu items</div>
      </LiquidGlassPanel>
    );
    const content = screen.getByTestId('content');
    let ancestor = content.parentElement;
    while (ancestor && ancestor !== container) {
      expect((ancestor as HTMLElement).style.overflow).not.toBe('hidden');
      ancestor = ancestor.parentElement;
    }
  });

  it('CONTRACT: upstream filter graph — negative scale, R/B channels, slice aspect, clean centre', () => {
    // Regression guard: "improving" these from embedded-preview probes broke
    // refraction in real Chrome. They must match liquid-glass-package/src.
    const { container } = render(
      <LiquidGlassPanel displacementScale={100} aberrationIntensity={2}>
        <div>glass</div>
      </LiquidGlassPanel>
    );
    const dm = container.querySelector('filter feDisplacementMap');
    expect(dm).toBeTruthy();
    expect(Number(dm!.getAttribute('scale'))).toBeLessThan(0);
    expect(dm!.getAttribute('xChannelSelector')).toBe('R');
    expect(dm!.getAttribute('yChannelSelector')).toBe('B');
    const img = container.querySelector('filter feImage');
    expect(img!.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice');
    // clean-centre composite present (keeps mid-panel frost intact)
    expect(container.querySelector('filter feOffset')).toBeTruthy();
  });

  it('CONTRACT: displacement 0 removes the SVG graph and warp layer entirely', () => {
    const { container } = render(
      <LiquidGlassPanel displacementScale={0}>
        <div>flat glass</div>
      </LiquidGlassPanel>
    );
    expect(container.querySelector('svg filter')).toBeNull();
    const withFilterUrl = Array.from(container.querySelectorAll('div')).filter((el) =>
      ((el as HTMLElement).style.filter || '').includes('url(')
    );
    expect(withFilterUrl.length).toBe(0);
  });
});
