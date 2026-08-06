import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ExportPreview from '../ExportPreview.jsx';
import { DEFAULT_EXPORT_TEMPLATE } from '../../../utils/mondayApi/boards.config.js';

// round195 — the live docx rendering is debounced (350ms) and jsdom-guarded, so
// within a test only the STATIC sketch renders; these pin its structure (the
// docx-faithful pieces from round193) so a preview regression can't slip in
// silently under the live path.
describe('ExportPreview (static sketch, jsdom)', () => {
  it('renders the sketch: label, centered doc title, and the real docx table headers', () => {
    render(<ExportPreview template={DEFAULT_EXPORT_TEMPLATE} assets={null} />);
    expect(screen.getByText('תצוגה מקדימה')).toBeInTheDocument();
    // round365 — the title is COMPOSED from template.title (default: free text,
    // dash, name, space, date), no longer the hardcoded colon form.
    expect(screen.getByText(/סיכום דיון - /)).toBeInTheDocument();
    // tasks table headers (round191 shape — no "מדיון קודם")
    expect(screen.getByText('משימה')).toBeInTheDocument();
    expect(screen.getByText('אחראי')).toBeInTheDocument();
    expect(screen.queryByText('מדיון קודם')).toBeNull();
    // decisions table header (round193 shape — decider only, no date/status cols)
    expect(screen.getByText('מחליט')).toBeInTheDocument();
    // references section (round200 — enabled by default)
    expect(screen.getByText('התייחסויות')).toBeInTheDocument();
  });

  it('omits a disabled section (decisions off ⇒ no מחליט header)', () => {
    const template = {
      ...DEFAULT_EXPORT_TEMPLATE,
      sections: DEFAULT_EXPORT_TEMPLATE.sections.map((s) =>
        (s.key === 'decisions' ? { ...s, enabled: false } : s)),
    };
    render(<ExportPreview template={template} assets={null} />);
    expect(screen.queryByText('מחליט')).toBeNull();
    expect(screen.getByText('משימה')).toBeInTheDocument(); // tasks still shown
  });
});
