# ADR-0007: Unit Testing Framework & Component Mocking Strategy

- **Status**: 🟢 Accepted
- **Date**: 2026-05-20
- **Author**: Antigravity & USER

## Context & Problem Statement

To prevent regressions as the DAW's user interface and audio systems scale, we need a reliable, high-speed automated unit testing suite.
However, testing React components in a browser-like environment (jsdom) presents unique technical hurdles:
1. **React Portals**: Modal elements render outside the immediate test container node into `document.body`, making container queries and snapshots complex.
2. **WebGL & Canvas Renderers**: High-performance UI rendering loops (such as the LiquidGlass chromatic filters or spectrum layers) rely on WebGL API hooks that do not natively exist or compile inside standard headless jsdom containers.
3. **Motion Libraries**: Component libraries (like Framer Motion / `motion/react`) use real-time scheduling loops and CSS transformations that create unneeded async timing overhead in pure unit tests.

We need a clear strategy to bypass these heavy dependencies and execute lightning-fast unit tests.

## Proposed Decision

We will adopt **Vitest** + **React Testing Library** + **JSDOM** as our core testing stack. To handle layout/system dependencies, we will enforce the following architectural mocking rules:

### 1. Portal Isolation Bypass
To keep modal testing simple and within immediate container query boundaries, we will mock `react-dom`'s `createPortal` to render the portal contents inline as standard children:
```typescript
vi.mock('react-dom', async () => {
  const original = await vi.importActual<any>('react-dom');
  return {
    ...original,
    createPortal: (node: React.ReactNode) => node,
  };
});
```

### 2. High-Performance Graphics Bypasses
To prevent WebGL/Canvas/CSS filter errors inside jsdom, any layout graphics or refractive filter wrappers (such as `LiquidGlassPanel` or custom WebGL backgrounds) must be replaced with lightweight transparent wrapper elements during test runner executions:
```typescript
vi.mock('./LiquidGlass', () => ({
  LiquidGlassPanel: ({ children, className }: any) => <div data-testid="liquid-glass" className={className}>{children}</div>,
}));
```

### 3. Animation Framework Neutralization
All animation wrappers and dynamic lifecycles (such as `motion.div` and `AnimatePresence`) will be mocked to bypass dynamic asynchronous transitions and immediately mount child components:
```typescript
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, className, ...props }: any) => <div className={className} {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));
```

### 4. Assertions Framework Standard
To maximize framework independence and bypass package load delays from external Jest matchers (like `@testing-library/jest-dom`), we will prioritize native, high-performance Vitest matchers (e.g., checking element queries against `.toBeNull()` or `.not.toBeNull()`).

## Consequences

- **Positive / What We Gain**:
  - Extremely fast execution: full component tests run in <100ms.
  - Bulletproof headless testing: no failures due to lacking WebGL, Canvas, or document portal structures.
  - Highly robust: user click flows, callbacks, and responsive status states can be verified programmatically with minimal setup.
- **Negative / Trade-offs**:
  - Tests do not verify the visual presentation, styling transitions, or the physical pixels of the portal overlay. This must still be covered via manual visual verification or E2E browser tests.
  - Requires developers to include standard mocking blocks at the top of test files containing modals.
