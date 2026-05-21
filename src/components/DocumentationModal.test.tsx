import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocumentationModal } from './DocumentationModal';

// Mock Portals to render inline inside the test container rather than document.body
vi.mock('react-dom', async () => {
  const original = await vi.importActual<any>('react-dom');
  return {
    ...original,
    createPortal: (node: React.ReactNode) => node,
  };
});

// Mock LiquidGlass component to bypass SVG filter layout processes
vi.mock('./LiquidGlass', () => ({
  LiquidGlassPanel: ({ children, className, contentClassName }: any) => (
    <div data-testid="liquid-glass" className={className}>
      <div className={contentClassName}>{children}</div>
    </div>
  ),
}));

// Mock raw markdown loader import
vi.mock('../../docs/doc.md?raw', () => ({
  default: `
# Wiki Documentation
This is a paragraph with **bold** text.
---
## Getting Started
To get started:
- **Step 1**: Open JAAD
- **Step 2**: Load template
| Keyboard Key | Editing Command |
| --- | --- |
| Tab | Toggle timeline |
\`\`\`typescript
const isPlaying = true;
\`\`\`
`,
}));

describe('DocumentationModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders parsed markdown headers, paragraphs, and list elements when isOpen={true}', () => {
    render(<DocumentationModal {...defaultProps} />);

    expect(screen.queryByText('Wiki Documentation')).not.toBeNull();
    // Getting Started appears twice (sidebar navigation button and actual h2 node)
    expect(screen.queryAllByText('Getting Started').length).toBe(2);
    expect(screen.queryByText(/This is a paragraph with/)).not.toBeNull();
    expect(screen.queryByText('Step 1')).not.toBeNull();
    expect(screen.queryByText('Step 2')).not.toBeNull();
  });

  it('renders code blocks and table cells properly', () => {
    render(<DocumentationModal {...defaultProps} />);

    expect(screen.queryByText('Tab')).not.toBeNull();
    expect(screen.queryByText('Toggle timeline')).not.toBeNull();
    expect(screen.queryByText('const isPlaying = true;')).not.toBeNull();
  });

  it('renders wiki sidebar headings', () => {
    render(<DocumentationModal {...defaultProps} />);

    expect(screen.queryByText('JAAD Wiki')).not.toBeNull();
    expect(screen.queryByText('User Manual v1.1')).not.toBeNull();
    expect(screen.queryAllByText('Getting Started', { selector: 'button' }).length).toBeGreaterThan(0);
  });

  it('calls onClose when top-right action button is clicked', () => {
    render(<DocumentationModal {...defaultProps} />);

    // Click floating action button
    const closeBtn = screen.getByTitle('Close Wiki');
    fireEvent.click(closeBtn);

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render when isOpen={false}', () => {
    render(<DocumentationModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('JAAD Wiki')).toBeNull();
  });
});
