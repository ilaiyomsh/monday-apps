import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round304 (owner report) — "an export template defined for a type is not applied
 * by default to all discussions of that type, especially the file set as the
 * template's header/footer background".
 *
 * Cause: the dialog wrote the RESOLVED template back as a per-discussion override
 * on every "הפק מסמך", so exporting a discussion once froze it onto the default
 * that was in force then — and that frozen copy outranks the type tier forever.
 * Plus the type's ASSETS were only read when the type also had a config.
 */

const { docx, store, assets, templatesValue } = vi.hoisted(() => ({
  docx: {
    assembleDiscussionModel: vi.fn(),
    deliverDiscussionDocx: vi.fn(),
  },
  store: {
    loadDiscussionExportTemplate: vi.fn(),
    saveDiscussionExportTemplate: vi.fn(),
    loadDiscussionExportAssets: vi.fn(),
    saveDiscussionExportAssets: vi.fn(),
    clearDiscussionExportOverrides: vi.fn(),
  },
  assets: { loadExportAssets: vi.fn() },
  templatesValue: { typeTemplates: [], loadTypeExportAssets: vi.fn() },
}));

vi.mock('../../utils/docxExport.js', () => ({
  assembleDiscussionModel: (...a) => docx.assembleDiscussionModel(...a),
  deliverDiscussionDocx: (...a) => docx.deliverDiscussionDocx(...a),
}));
vi.mock('../../utils/discussionExportStore.js', () => ({
  loadDiscussionExportTemplate: (...a) => store.loadDiscussionExportTemplate(...a),
  saveDiscussionExportTemplate: (...a) => store.saveDiscussionExportTemplate(...a),
  loadDiscussionExportAssets: (...a) => store.loadDiscussionExportAssets(...a),
  saveDiscussionExportAssets: (...a) => store.saveDiscussionExportAssets(...a),
  clearDiscussionExportOverrides: (...a) => store.clearDiscussionExportOverrides(...a),
}));
vi.mock('../../utils/exportAssets.js', () => ({
  loadExportAssets: (...a) => assets.loadExportAssets(...a),
}));
vi.mock('../../contexts/TemplatesContext.jsx', () => ({
  useTemplates: () => templatesValue,
}));
vi.mock('../SettingsModal/ExportTemplateTab.jsx', () => ({
  default: ({ template, setTemplate }) => (
    <div data-testid="export-tab">
      <span data-testid="mode">{template?.headerMode}</span>
      <span data-testid="font">{template?.font}</span>
      <button type="button" onClick={() => setTemplate((prev) => ({ ...prev, font: 'david' }))}>
        edit-font
      </button>
    </div>
  ),
}));
vi.mock('../SettingsModal/SettingsModal.jsx', () => ({
  // Mirrors the real seeder's job: back-fill the defaults over a stored config.
  seedExportTemplate: (t) => ({ headerMode: 'config', font: 'assistant', sections: [], ...(t || {}) }),
}));
vi.mock('../BrandLoader', () => ({ BrandLoader: () => <div data-testid="loader" /> }));
vi.mock('../../utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { ExportDialog } from '../ExportDialog/ExportDialog.jsx';

const INSTANCE_TPL = { headerMode: 'config', font: 'assistant', sections: [] };
const TYPE_TPL = { headerMode: 'upload', font: 'assistant', sections: [] };
const DOCX_ASSETS = { headerLogo: null, footerLogo: null, templateDocx: 'UEsDBBQ=' };
const EMPTY_ASSETS = { headerLogo: null, footerLogo: null, templateDocx: null };

const discussion = { id: '55', name: 'דיון', discussionTypeID: 'סבב' };

async function open({ ownTemplate = null, ownAssets = null } = {}) {
  store.loadDiscussionExportTemplate.mockResolvedValue(ownTemplate);
  store.loadDiscussionExportAssets.mockResolvedValue(ownAssets);
  const onNotify = vi.fn();
  render(
    <ExportDialog
      discussion={discussion}
      settings={{ exportTemplate: INSTANCE_TPL }}
      context={{ instanceId: '1' }}
      onClose={vi.fn()}
      onNotify={onNotify}
    />
  );
  await waitFor(() => expect(screen.getByTestId('export-tab')).toBeInTheDocument());
  return { onNotify };
}

const produce = async () => {
  fireEvent.click(screen.getByText('הפק מסמך').closest('button'));
  await waitFor(() => expect(docx.deliverDiscussionDocx).toHaveBeenCalled());
  return docx.deliverDiscussionDocx.mock.calls.at(-1)[2];
};

beforeEach(() => {
  vi.clearAllMocks();
  docx.assembleDiscussionModel.mockResolvedValue({ model: { name: 'דיון' }, filename: 'f.docx' });
  docx.deliverDiscussionDocx.mockResolvedValue({ uploadAttempted: false, uploaded: false });
  store.saveDiscussionExportTemplate.mockResolvedValue(undefined);
  store.saveDiscussionExportAssets.mockResolvedValue(undefined);
  store.clearDiscussionExportOverrides.mockResolvedValue(true);
  assets.loadExportAssets.mockResolvedValue(EMPTY_ASSETS);
  templatesValue.typeTemplates = [{ discussionType: 'סבב', exportTemplate: TYPE_TPL }];
  templatesValue.loadTypeExportAssets = vi.fn().mockResolvedValue(DOCX_ASSETS);
});

describe('ExportDialog — the discussion TYPE\'s export template is the default (round304)', () => {
  it('produces with the type\'s template AND the type\'s uploaded header/footer file', async () => {
    await open();
    expect(screen.getByTestId('mode').textContent).toBe('upload');
    const opts = await produce();
    expect(opts.template.headerMode).toBe('upload');
    expect(opts.assets.templateDocx).toBe('UEsDBBQ=');
  });

  it('does NOT freeze a per-discussion override when the user changed nothing', async () => {
    await open();
    await produce();
    expect(store.saveDiscussionExportTemplate).not.toHaveBeenCalled();
    expect(store.saveDiscussionExportAssets).not.toHaveBeenCalled();
  });

  it('persists an override once the template really was edited here', async () => {
    await open();
    fireEvent.click(screen.getByText('edit-font'));
    await waitFor(() => expect(screen.getByTestId('font').textContent).toBe('david'));
    await produce();
    expect(store.saveDiscussionExportTemplate).toHaveBeenCalledTimes(1);
    expect(store.saveDiscussionExportTemplate.mock.calls[0][1].font).toBe('david');
  });

  it('IGNORES a stored own copy that merely echoes the system default (the frozen-by-export case)', async () => {
    // Exactly what the old code wrote on every produce: a copy of the system default.
    await open({ ownTemplate: { ...INSTANCE_TPL } });
    expect(screen.getByTestId('mode').textContent).toBe('upload'); // the TYPE's, not the echo
    const opts = await produce();
    expect(opts.template.headerMode).toBe('upload');
    expect(opts.assets.templateDocx).toBe('UEsDBBQ=');
  });

  it('still honours a REAL per-discussion customization', async () => {
    await open({ ownTemplate: { ...INSTANCE_TPL, font: 'david' } });
    expect(screen.getByTestId('font').textContent).toBe('david');
    const opts = await produce();
    expect(opts.template.font).toBe('david');
  });

  it('uses the type\'s assets even when the type carries no template CONFIG', async () => {
    templatesValue.typeTemplates = [{ discussionType: 'סבב', exportTemplate: null }];
    await open();
    expect(templatesValue.loadTypeExportAssets).toHaveBeenCalledWith('סבב');
    const opts = await produce();
    expect(opts.template.headerMode).toBe('config'); // the system default's config
    expect(opts.assets.templateDocx).toBe('UEsDBBQ='); // …with the type's brand file
  });

  it('falls back to the instance globals for a discussion with no type', async () => {
    store.loadDiscussionExportTemplate.mockResolvedValue(null);
    store.loadDiscussionExportAssets.mockResolvedValue(null);
    assets.loadExportAssets.mockResolvedValue({ ...EMPTY_ASSETS, headerLogo: 'data:global' });
    render(
      <ExportDialog
        discussion={{ id: '56', name: 'ללא סוג' }}
        settings={{ exportTemplate: INSTANCE_TPL }}
        context={{ instanceId: '1' }}
        onClose={vi.fn()}
        onNotify={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByTestId('export-tab')).toBeInTheDocument());
    expect(templatesValue.loadTypeExportAssets).not.toHaveBeenCalled();
    const opts = await produce();
    expect(opts.assets.headerLogo).toBe('data:global');
  });

  it('offers "חזרה לברירת המחדל" only for a real override, and clearing it re-seeds from the type', async () => {
    await open(); // no override
    expect(screen.queryByText('חזרה לברירת המחדל')).toBeNull();

    // With a genuine own template the escape hatch appears and wipes both stores.
    await open({ ownTemplate: { ...INSTANCE_TPL, font: 'david' } });
    const reset = screen.getByText('חזרה לברירת המחדל').closest('button');
    fireEvent.click(reset);
    await waitFor(() => expect(store.clearDiscussionExportOverrides).toHaveBeenCalledWith('55'));
  });

  it('a FAILED reset is not announced as done and keeps the override (PR review)', async () => {
    store.clearDiscussionExportOverrides.mockRejectedValue(new Error('storage unavailable'));
    const { onNotify } = await open({ ownTemplate: { ...INSTANCE_TPL, font: 'david' } });
    fireEvent.click(screen.getByText('חזרה לברירת המחדל').closest('button'));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith(expect.stringMatching(/נכשל/), 'warning'));
    // no success notice, and the escape hatch is still offered
    expect(onNotify).not.toHaveBeenCalledWith(expect.stringMatching(/אופסה/));
    expect(screen.getByText('חזרה לברירת המחדל')).toBeInTheDocument();
  });
});
