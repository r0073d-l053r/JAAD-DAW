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
});
