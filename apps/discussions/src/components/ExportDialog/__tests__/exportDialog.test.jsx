import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/*
 * round207 — the per-discussion export dialog. Pinned behaviors:
 * 1. Loading gate: the box assembles THE REAL discussion model + the stored
 *    per-discussion overrides before showing the template editor, and hands the
 *    real model to the preview (previewModel).
 * 2. "הפק מסמך": delivers the docx with {template, assets, discussionId}, notifies,
 *    closes. round356 — it persists NOTHING: what the owner adjusted here shapes THIS
 *    document only, and the next export starts from the discussion's type again.
 */
const h = vi.hoisted(() => ({
  assembleDiscussionModel: vi.fn(),
  deliverDiscussionDocx: vi.fn(),
  loadExportAssets: vi.fn(),
  loadDiscussionExportTemplate: vi.fn(),
  saveDiscussionExportTemplate: vi.fn(),
  loadDiscussionExportAssets: vi.fn(),
  saveDiscussionExportAssets: vi.fn(),
  // round254 — per-type export template tier (via useTemplates).
  typeTemplates: [],
  loadTypeExportAssets: vi.fn(),
  tabProps: { current: null },
}));

vi.mock('../../../utils/docxExport.js', () => ({
  assembleDiscussionModel: h.assembleDiscussionModel,
  deliverDiscussionDocx: h.deliverDiscussionDocx,
}));
vi.mock('../../../utils/exportAssets.js', () => ({ loadExportAssets: h.loadExportAssets }));
vi.mock('../../../utils/discussionExportStore.js', () => ({
  loadDiscussionExportTemplate: h.loadDiscussionExportTemplate,
  saveDiscussionExportTemplate: h.saveDiscussionExportTemplate,
  loadDiscussionExportAssets: h.loadDiscussionExportAssets,
  saveDiscussionExportAssets: h.saveDiscussionExportAssets,
}));
vi.mock('../../SettingsModal/SettingsModal.jsx', () => ({
  seedExportTemplate: (stored) => stored || { seeded: 'default', sections: [] },
}));
vi.mock('../../SettingsModal/ExportTemplateTab.jsx', () => ({
  default: (props) => {
    h.tabProps.current = props;
    return <div data-testid="export-template-tab" />;
  },
}));
vi.mock('../../BrandLoader', () => ({ BrandLoader: () => <div data-testid="brand-loader" /> }));
// round254 — the dialog reads the discussion TYPE's export template via useTemplates.
vi.mock('../../../contexts/TemplatesContext.jsx', () => ({
  useTemplates: () => ({ typeTemplates: h.typeTemplates, loadTypeExportAssets: h.loadTypeExportAssets }),
}));

import { ExportDialog } from '../ExportDialog.jsx';

const MODEL = { title: 'דיון אמיתי' };

beforeEach(() => {
  Object.values(h).forEach((f) => { if (typeof f?.mockReset === 'function') f.mockReset(); });
  h.tabProps.current = null;
  h.assembleDiscussionModel.mockResolvedValue({ model: MODEL, filename: 'real.docx' });
  h.deliverDiscussionDocx.mockResolvedValue({ uploadAttempted: false, uploaded: false });
  h.loadExportAssets.mockResolvedValue({ headerLogo: 'global' });
  h.loadDiscussionExportTemplate.mockResolvedValue(null);
  h.loadDiscussionExportAssets.mockResolvedValue(null);
  h.saveDiscussionExportTemplate.mockResolvedValue(undefined);
  h.saveDiscussionExportAssets.mockResolvedValue(undefined);
  h.typeTemplates = [];
  h.loadTypeExportAssets.mockResolvedValue({ headerLogo: 'typeLogo' });
});

const renderDialog = (over = {}) => {
  const props = {
    discussion: { id: 42, name: 'ישיבת צוות' },
    settings: { exportTemplate: null },
    context: { instanceId: 'i1' },
    onClose: vi.fn(),
    onNotify: vi.fn(),
    ...over,
  };
  render(<ExportDialog {...props} />);
  return props;
};

describe('ExportDialog (round207)', () => {
  it('shows a loader, then the template editor wired to the REAL discussion model', async () => {
    renderDialog();
    expect(screen.getByTestId('brand-loader')).toBeInTheDocument();
    const tab = await screen.findByTestId('export-template-tab');
    expect(tab).toBeInTheDocument();
    expect(h.assembleDiscussionModel).toHaveBeenCalledTimes(1);
    // The live preview must get the real model, keyed by the discussion.
    expect(h.tabProps.current.previewModel).toBe(MODEL);
    expect(String(h.tabProps.current.previewModelKey)).toContain('42');
    // Seeded from instance defaults + global assets (no per-discussion override stored).
    expect(h.tabProps.current.assets).toEqual({ headerLogo: 'global' });
  });

  it('הפק מסמך: delivers with {template, assets, discussionId}, notifies and closes — without freezing an override', async () => {
    const props = renderDialog();
    await screen.findByTestId('export-template-tab');

    fireEvent.click(screen.getByRole('button', { name: 'הפק מסמך' }));

    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    // round304 — the template was NOT edited in this dialog, so no per-discussion
    // override is written. Persisting it on every produce is what froze discussions
    // onto the then-current default and shadowed their TYPE's export template.
    expect(h.saveDiscussionExportTemplate).not.toHaveBeenCalled();
    expect(h.deliverDiscussionDocx).toHaveBeenCalledWith(MODEL, 'real.docx', {
      template: h.tabProps.current.template,
      assets: { headerLogo: 'global' },
      discussionId: '42',
    });
    // Assets untouched in the dialog → no per-discussion assets override written.
    expect(h.saveDiscussionExportAssets).not.toHaveBeenCalled();
    expect(props.onNotify).toHaveBeenCalledWith('המסמך הופק בהצלחה');
  });

  /*
   * round356 (owner spec) — a per-discussion template stored by an older version is not
   * read: the cascade is system → type → the edits made in THIS dialog, and those last
   * ones are ephemeral. Without a type, the instance default is what opens.
   */
  it('ignores a stored per-discussion template — the instance default opens', async () => {
    h.loadDiscussionExportTemplate.mockResolvedValue({ font: 'perDiscussion', sections: [] });
    renderDialog({ settings: { exportTemplate: { font: 'instance' } } });
    await screen.findByTestId('export-template-tab');
    expect(h.tabProps.current.template).toEqual({ font: 'instance' });
    expect(h.loadDiscussionExportTemplate).not.toHaveBeenCalled();
  });

  it('round254 — the discussion TYPE\'s export template wins over the instance default (no per-discussion override)', async () => {
    const typeTpl = { font: 'typeTpl', sections: [] };
    h.typeTemplates = [{ discussionType: 'סבב', exportTemplate: typeTpl }];
    h.loadTypeExportAssets.mockResolvedValue({ headerLogo: 'typeLogo' });
    renderDialog({
      discussion: { id: 7, name: 'x', discussionTypeID: 'סבב' },
      settings: { exportTemplate: { font: 'instance' } },
    });
    await screen.findByTestId('export-template-tab');
    // type template beats the instance default…
    expect(h.tabProps.current.template).toEqual(typeTpl);
    // …and its own assets are used when the type carries a template.
    expect(h.tabProps.current.assets).toEqual({ headerLogo: 'typeLogo' });
  });

  it('round356 — the TYPE template beats the instance default, and a stored override is ignored', async () => {
    const typeTpl = { font: 'typeTpl', sections: [] };
    h.loadDiscussionExportTemplate.mockResolvedValue({ font: 'own', sections: [] });
    h.typeTemplates = [{ discussionType: 'סבב', exportTemplate: typeTpl }];
    renderDialog({
      discussion: { id: 7, name: 'x', discussionTypeID: 'סבב' },
      settings: { exportTemplate: { font: 'instance' } },
    });
    await screen.findByTestId('export-template-tab');
    expect(h.tabProps.current.template).toEqual(typeTpl);
  });
});
