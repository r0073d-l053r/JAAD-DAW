import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { StudioBackground } from './StudioBackground';

// Mock motion/react to avoid canvas opacity transitions delays
vi.mock('motion/react', () => ({
  motion: {
    canvas: React.forwardRef(({ children, ...props }: any, ref: any) => (
      <canvas ref={ref} {...props}>{children}</canvas>
    )),
  },
}));

describe('StudioBackground', () => {
  let mockContext: any;
  let animationFrames: Function[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    animationFrames = [];

    // Mock requestAnimationFrame to store callbacks for manual ticks
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockImplementation((cb: Function) => {
      animationFrames.push(cb);
      return animationFrames.length;
    }));

    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    // Setup mock radial gradient
    const mockGradient = {
      addColorStop: vi.fn(),
    };

    mockContext = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      createRadialGradient: vi.fn().mockReturnValue(mockGradient),
      fillStyle: '',
      globalCompositeOperation: '',
    };

    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockContext);

    // Mock window sizes
    vi.stubGlobal('innerWidth', 1920);
    vi.stubGlobal('innerHeight', 1080);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders fixed overlays and initial background structure', () => {
    const { container } = render(<StudioBackground disableAnimation={true} />);
    
    // Grid overlay divs are visible even with animations disabled
    const overlays = container.querySelectorAll('.absolute.inset-0');
    expect(overlays.length).toBe(2);
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('initializes canvas context and animates multiple blobs', () => {
    const { container } = render(<StudioBackground disableAnimation={false} />);
    
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();

    // Resize triggers size definitions on canvas
    expect(canvas?.width).toBe(1920);
    expect(canvas?.height).toBe(1080);

    // Initial setup starts requestAnimationFrame loop
    expect(requestAnimationFrame).toHaveBeenCalled();

    // Trigger one manual animation frame tick to drive blob movements and renders
    act(() => {
      if (animationFrames.length > 0) {
        animationFrames[0]();
      }
    });

    expect(mockContext.clearRect).toHaveBeenCalled();
    expect(mockContext.createRadialGradient).toHaveBeenCalled();
    expect(mockContext.arc).toHaveBeenCalled();
    expect(mockContext.fill).toHaveBeenCalled();
  });

  it('responds beautifully to window resize event triggers', () => {
    const { container } = render(<StudioBackground disableAnimation={false} />);
    const canvas = container.querySelector('canvas');

    // Trigger resize
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('innerHeight', 720);

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(canvas?.width).toBe(1280);
    expect(canvas?.height).toBe(720);
  });
});
