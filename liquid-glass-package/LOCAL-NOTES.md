# Local notes on this vendored copy

This is a vendored copy of [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react),
kept as the **authoritative visual reference** for JAAD's liquid glass.

Local modifications (not upstream):

- `src/WebGLContextManager.ts` — was missing from the copy; reimplemented as a
  shared-context singleton over the package's own `WebGLDisplacementGenerator`.
- `src/index.tsx` — added an opt-in `staticLayout` prop (in-flow layout
  container geometry instead of the demo's floating centered pill). Guarded
  behind the prop; default behaviour is untouched upstream.

**The app does NOT import this package.** `src/components/LiquidGlass.tsx`
implements the same filter graph inside JAAD's own panel contract (glass fills
its container, content unclipped above the glass). When comparing against the
demo at liquid-glass.maxrovensky.com, diff against THIS source.

Note: this directory is listed in `.gitignore`, but the files were tracked
before that rule was added, so changes here still commit normally.
