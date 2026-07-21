import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/*
 * round207 — the per-discussion export dialog. Pinned behaviors:
 * 1. Loading gate: the box assembles THE REAL discussion model + the stored
 *    per-discussion overrides before showing the template editor, and hands the
 *    real model to the preview (previewModel).
 * 2. "הפק מסמך": persists the per-discussion template, delivers the docx with
 *    {template, assets, discussionId}, notifies, closes. The assets override is
 *    written ONLY when the user changed assets inside the dialog.
 */
const h = vi.hoisted(() => ({
  assembleDiscussionModel: vi.fn(),
  deliverDiscussionDocx: vi.fn(),
  loadExportAssets: vi.fn(),
  loadDiscussionExportTemplate: vi.fn(),
  saveDiscussionExportTemplate: vi.fn(),
  loadDiscussionExportAssets: vi.fn(),
  saveDiscussionExportAssets: vi.fn(),
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

  it('הפק מסמך: persists the per-discussion template, delivers with {template, assets, discussionId}, notifies and closes', async () => {
    const props = renderDialog();
    await screen.findByTestId('export-template-tab');

    fireEvent.click(screen.getByRole('button', { name: 'הפק מסמך' }));

    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(h.saveDiscussionExportTemplate).toHaveBeenCalledWith('42', h.tabProps.current.template);
    expect(h.deliverDiscussionDocx).toHaveBeenCalledWith(MODEL, 'real.docx', {
      template: h.tabProps.current.template,
      assets: { headerLogo: 'global' },
      discussionId: '42',
    });
    // Assets untouched in the dialog → no per-discussion assets override written.
    expect(h.saveDiscussionExportAssets).not.toHaveBeenCalled();
    expect(props.onNotify).toHaveBeenCalledWith('הדיון יוצא ל-DOCS בהצלחה');
  });

  it('a stored per-discussion template wins over the instance default', async () => {
    const own = { font: 'perDiscussion', sections: [] };
    h.loadDiscussionExportTemplate.mockResolvedValue(own);
    renderDialog({ settings: { exportTemplate: { font: 'instance' } } });
    await screen.findByTestId('export-template-tab');
    expect(h.tabProps.current.template).toEqual(own);
  });
});
