import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Text } from '@vibe/core';
import type { Column, Conditional } from '../../types';
import {
  EXPORT_VERSION,
  buildConditionsFileName,
  buildExportJson,
  downloadJson,
  type ExportPayload,
} from '../../lib/conditionalsExport';

interface Props {
  mode: 'export' | 'import';
  open: boolean;
  conditionals: Conditional[];
  eligibleColumns: Column[];
  policyBoardId: string | null;
  userName: string | null;
  onClose: () => void;
  // Resolves once the server has accepted the new conditionals (i.e. when
  // ConditionalList's onSave returns).
  onReplace: (next: Conditional[]) => Promise<void>;
}

// Drop value entries for columns that aren't currently eligible — same
// semantics as ConditionalList#pruneOrphanValues. Returns [pruned, skippedCount]
// where skipped counts columns referenced in the import but no longer eligible.
function prune(list: Conditional[], eligible: Column[]): { pruned: Conditional[]; skipped: number } {
  const allowed = new Set(eligible.map((c) => c.id));
  let skipped = 0;
  const pruned = list.map((cond) => {
    const values = cond.values || {};
    const keys = Object.keys(values);
    const cleanedKeys = keys.filter((k) => allowed.has(k));
    skipped += keys.length - cleanedKeys.length;
    if (cleanedKeys.length === keys.length) return cond;
    const cleaned: Conditional['values'] = {};
    for (const k of cleanedKeys) cleaned[k] = values[k];
    return { ...cond, values: cleaned };
  });
  return { pruned, skipped };
}

interface ParseResult {
  ok: boolean;
  error?: string;
  payload?: ExportPayload;
}

function parseImport(raw: string): ParseResult {
  if (!raw.trim()) return { ok: false, error: 'Paste exported JSON to import.' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${(err as Error).message}` };
  }
  if (!data || typeof data !== 'object') return { ok: false, error: 'Expected an object.' };
  const obj = data as Record<string, unknown>;
  const version = Number(obj.version);
  if (!Number.isFinite(version)) return { ok: false, error: 'Missing or invalid "version" field.' };
  if (version > EXPORT_VERSION) {
    return { ok: false, error: `Unsupported version ${version}. This app understands up to v${EXPORT_VERSION}.` };
  }
  if (!Array.isArray(obj.conditionals)) return { ok: false, error: 'Missing "conditionals" array.' };
  return {
    ok: true,
    payload: {
      version,
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
      boardId: typeof obj.boardId === 'string' ? obj.boardId : null,
      conditionals: obj.conditionals as Conditional[],
    },
  };
}

export function ImportExportDialog({
  mode, open, conditionals, eligibleColumns, policyBoardId, userName, onClose, onReplace,
}: Props) {
  const [raw, setRaw] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset on open / mode change.
  useEffect(() => {
    if (!open) return;
    setDownloaded(false);
    setError(null);
    setSaving(false);
    setFileName(null);
    if (mode === 'export') {
      setRaw(buildExportJson(conditionals, policyBoardId));
    } else {
      setRaw('');
    }
  }, [open, mode, conditionals, policyBoardId]);

  const parsed = useMemo<ParseResult | null>(() => {
    if (mode !== 'import') return null;
    if (!raw.trim()) return null;
    return parseImport(raw);
  }, [mode, raw]);

  const importPreview = useMemo(() => {
    if (mode !== 'import' || !parsed?.ok || !parsed.payload) return null;
    const { pruned, skipped } = prune(parsed.payload.conditionals, eligibleColumns);
    return {
      total: parsed.payload.conditionals.length,
      pruned,
      skipped,
      boardMismatch:
        parsed.payload.boardId && policyBoardId && parsed.payload.boardId !== policyBoardId
          ? `${parsed.payload.boardId} → ${policyBoardId}`
          : null,
    };
  }, [mode, parsed, eligibleColumns, policyBoardId]);

  if (!open) return null;

  const downloadFile = () => {
    try {
      downloadJson(raw, buildConditionsFileName(userName));
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 2000);
    } catch (err) {
      setError(`Download failed: ${(err as Error).message}`);
    }
  };

  const onFilePicked = async (file: File) => {
    setError(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      setRaw(text);
    } catch (err) {
      setError(`Read failed: ${(err as Error).message}`);
    }
  };

  const doImport = async () => {
    if (!importPreview) return;
    setSaving(true);
    setError(null);
    try {
      await onReplace(importPreview.pruned);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <div style={backdropStyle} role="dialog" aria-modal="true">
      <div style={modalStyle}>
        <h3 style={{ margin: '0 0 4px 0', fontSize: 16 }}>
          {mode === 'export' ? 'Export rules' : 'Import rules'}
        </h3>
        <Text type="text2" color="secondary" element="p" style={{ margin: '0 0 12px 0' }}>
          {mode === 'export'
            ? `Download a JSON file (${buildConditionsFileName(userName)}). Share or import it later to restore.`
            : 'Choose a previously exported JSON file. Importing replaces all your current rules.'}
        </Text>

        {mode === 'import' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Button size="small" kind="secondary" onClick={() => fileInputRef.current?.click()}>
              Choose file…
            </Button>
            <Text type="text2" color="secondary">
              {fileName || 'No file selected'}
            </Text>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFilePicked(f);
                e.target.value = '';
              }}
            />
          </div>
        )}

        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          readOnly={mode === 'export'}
          spellCheck={false}
          style={{
            width: '100%',
            minHeight: 200,
            maxHeight: 320,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
            padding: 8,
            border: '1px solid var(--ui-border-color)',
            borderRadius: 4,
            resize: 'vertical',
          }}
          placeholder={mode === 'import' ? '{ "version": 1, "conditionals": [...] }' : undefined}
        />

        {mode === 'import' && parsed && !parsed.ok && (
          <Text type="text2" color="negative" element="p" style={{ margin: '8px 0 0 0' }}>
            {parsed.error}
          </Text>
        )}

        {mode === 'import' && importPreview && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#676879' }}>
            <div>
              Will replace <strong>{conditionals.length}</strong> existing
              {conditionals.length === 1 ? ' rule' : ' rules'} with{' '}
              <strong>{importPreview.total}</strong> imported
              {importPreview.total === 1 ? ' rule' : ' rules'}.
            </div>
            {importPreview.skipped > 0 && (
              <div style={{ color: 'var(--negative-color)' }}>
                {importPreview.skipped} column override{importPreview.skipped === 1 ? '' : 's'} skipped — column no longer eligible on this board.
              </div>
            )}
            {importPreview.boardMismatch && (
              <div style={{ color: 'var(--warning-color, #a8741f)' }}>
                Note — exported from board {importPreview.boardMismatch}. Some predicates or values may reference IDs that don't exist here.
              </div>
            )}
          </div>
        )}

        {error && (
          <Text type="text2" color="negative" element="p" style={{ margin: '8px 0 0 0' }}>
            {error}
          </Text>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button size="small" kind="tertiary" onClick={onClose} disabled={saving}>
            {mode === 'export' ? 'Close' : 'Cancel'}
          </Button>
          {mode === 'export' ? (
            <Button size="small" kind="primary" onClick={downloadFile}>
              {downloaded ? 'Downloaded ✓' : 'Download file'}
            </Button>
          ) : (
            <Button
              size="small"
              kind="primary"
              disabled={saving || !importPreview}
              onClick={doImport}
            >
              {saving ? 'Importing…' : 'Replace rules'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(32, 34, 44, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
};

const modalStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: 20,
  minWidth: 480,
  maxWidth: 640,
  width: '60%',
  boxShadow: '0 10px 30px rgba(32, 34, 44, 0.25)',
};
