import { useRef, useState } from 'react';
import { Button, Flex } from '@vibe/core';
import { Download, Upload } from '@vibe/icons';
import { ConfirmDialog } from '../feedback/ConfirmDialog';
import { useToast } from '../feedback/ToastProvider';
import logger from '../../lib/logger';
import type { Policy } from '../../types';

// Subset of Policy fields safe to round-trip through the export/import path.
// Server-managed fields (objectId, accountId, ownerUserId, verifiedOwnerIds,
// createdAt, updatedAt) are intentionally excluded — PATCH /api/policy ignores
// them anyway, and including them would imply they're transferable across
// instances when they're not.
type PortablePolicy = Pick<
  Policy,
  | 'boardId'
  | 'linkColumnId'
  | 'lockColumnId'
  | 'peopleColumnId'
  | 'itemNameSource'
  | 'columnMapping'
  | 'conditionalEligibleColumns'
>;

const PORTABLE_KEYS: (keyof PortablePolicy)[] = [
  'boardId',
  'linkColumnId',
  'lockColumnId',
  'peopleColumnId',
  'itemNameSource',
  'columnMapping',
  'conditionalEligibleColumns',
];

interface Props {
  policy: Policy;
  isOwner: boolean;
  onPatch: (updates: Partial<Policy>) => Promise<Policy>;
}

interface Pending {
  patch: PortablePolicy;
  unknownKeys: string[];
}

export function BackupRestoreBar({ policy, isOwner, onPatch }: Props) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [importing, setImporting] = useState(false);

  const handleExport = () => {
    try {
      const portable: PortablePolicy = {
        boardId: policy.boardId,
        linkColumnId: policy.linkColumnId,
        lockColumnId: policy.lockColumnId,
        peopleColumnId: policy.peopleColumnId,
        itemNameSource: policy.itemNameSource,
        columnMapping: policy.columnMapping ?? {},
        conditionalEligibleColumns: policy.conditionalEligibleColumns ?? [],
      };
      const blob = new Blob([JSON.stringify(portable, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sync-setup-${ymd(new Date())}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      logger.error('setup', 'export_setup_failed', err);
      toast.error(`Export failed: ${(err as Error).message}`);
    }
  };

  const handlePickFile = () => fileRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        toast.error('Import failed: file is not a JSON object');
        return;
      }
      const patch: PortablePolicy = {} as PortablePolicy;
      for (const key of PORTABLE_KEYS) {
        if (key in parsed) (patch as Record<string, unknown>)[key] = (parsed as Record<string, unknown>)[key];
      }
      const unknownKeys = Object.keys(parsed).filter((k) => !PORTABLE_KEYS.includes(k as keyof PortablePolicy));
      if (Object.keys(patch).length === 0) {
        toast.error('Import failed: no recognized fields in file');
        return;
      }
      setPending({ patch, unknownKeys });
    } catch (err) {
      // Ship AND display: the toast tells the owner, logger.error ships it to Axiom so a
      // malformed-import failure is observable (it was display-only before).
      logger.error('backup_restore', 'import_parse_failed', err instanceof Error ? err : new Error(String(err)));
      toast.error(`Import failed: ${(err as Error).message}`);
    }
  };

  const confirmImport = async () => {
    if (!pending) return;
    setImporting(true);
    try {
      await onPatch(pending.patch as Partial<Policy>);
      toast.success('Setup imported');
      setPending(null);
    } catch (err) {
      // Ship AND display: a failed policy write (PATCH /api/policy) must reach Axiom, not
      // just the owner's toast — it was display-only before.
      logger.error('backup_restore', 'import_apply_failed', err instanceof Error ? err : new Error(String(err)));
      toast.error(`Import failed: ${(err as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  if (!isOwner) return null;

  return (
    <>
      <Flex gap={Flex.gaps.SMALL} align={Flex.align.CENTER} style={{ marginBottom: 12 }}>
        <Button size="small" kind="tertiary" leftIcon={Download} onClick={handleExport}>
          Export setup
        </Button>
        <Button size="small" kind="tertiary" leftIcon={Upload} onClick={handlePickFile}>
          Import setup
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </Flex>
      <ConfirmDialog
        open={Boolean(pending) && !importing}
        title="Replace current setup?"
        body={describeImport(pending)}
        confirmLabel="Replace"
        destructive
        onConfirm={confirmImport}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

function describeImport(pending: Pending | null): string {
  if (!pending) return '';
  const fieldList = (Object.keys(pending.patch) as (keyof PortablePolicy)[])
    .map(describeField)
    .join(', ');
  const unknownNote =
    pending.unknownKeys.length > 0
      ? ` Ignoring unknown fields: ${pending.unknownKeys.join(', ')}.`
      : '';
  return `Importing will overwrite ${fieldList}.${unknownNote} Mapping shapes are validated by the server — invalid entries will be rejected with an error toast.`;
}

function describeField(key: keyof PortablePolicy): string {
  switch (key) {
    case 'boardId': return 'board';
    case 'linkColumnId': return 'link column';
    case 'lockColumnId': return 'lock column';
    case 'peopleColumnId': return 'people column';
    case 'itemNameSource': return 'item-name source';
    case 'columnMapping': return 'column mapping';
    case 'conditionalEligibleColumns': return 'eligible-override columns';
  }
}

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
