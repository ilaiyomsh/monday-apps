import { useEffect, useMemo, useState } from 'react';
import { Button, Chips, ExpandCollapse, Flex, IconButton, Text, Tooltip } from '@vibe/core';
import { Check, CloseSmall, Undo } from '@vibe/icons';
import { EditorDispatcher } from './EditorDispatcher';
import { isMeaningful } from '../../lib/mappingEntry';
import type { Column, ColumnMapping, ColumnMappingEntry, Policy } from '../../types';

interface Props {
  columns: Column[];
  policy: Policy;
  canEdit: boolean;
  onSaveMapping: (mapping: ColumnMapping) => Promise<void>;
}

const WIRED_TYPES = new Set(['link', 'people', 'mirror', 'auto_number', 'item_id']);

export function ColumnMappingTable({ columns, policy, canEdit, onSaveMapping }: Props) {
  const [mapping, setMapping] = useState<ColumnMapping>(policy.columnMapping || {});
  const [saving, setSaving] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState<string>(
    JSON.stringify(policy.columnMapping || {})
  );

  // When the server-side policy changes (initial load, or policy reload after
  // some other tab edits it), reset our local draft + the saved snapshot so
  // the dirty calculation lines up with what's actually persisted.
  //
  // Once the current board's columns are loaded, drop entries whose key is
  // not a column on this board (orphans from a previous board). The local
  // state goes to the cleaned mapping; savedSnapshot stays at the *dirty*
  // server version so isDirty=true and the user sees "N unsaved changes" —
  // clicking Save sends the cleaned mapping and clears the orphans server-side.
  useEffect(() => {
    const incoming = policy.columnMapping || {};
    if (columns.length === 0) {
      setMapping(incoming);
      setSavedSnapshot(JSON.stringify(incoming));
      return;
    }
    const columnIds = new Set(columns.map((c) => c.id));
    const cleaned: ColumnMapping = {};
    for (const [k, v] of Object.entries(incoming)) {
      if (columnIds.has(k)) cleaned[k] = v;
    }
    setMapping(cleaned);
    setSavedSnapshot(JSON.stringify(incoming));
  }, [policy.columnMapping, columns]);

  const currentSerialized = useMemo(() => JSON.stringify(mapping), [mapping]);
  const isDirty = currentSerialized !== savedSnapshot;
  const dirtyCount = useMemo(() => {
    if (!isDirty) return 0;
    try {
      const saved = JSON.parse(savedSnapshot) as ColumnMapping;
      const keys = new Set([...Object.keys(saved), ...Object.keys(mapping)]);
      let n = 0;
      for (const k of keys) {
        if (JSON.stringify(saved[k]) !== JSON.stringify(mapping[k])) n++;
      }
      return n;
    } catch {
      return 1;
    }
  }, [isDirty, savedSnapshot, mapping]);

  const setEntry = (colId: string, entry: ColumnMappingEntry | null) => {
    const next: ColumnMapping = { ...mapping };
    if (entry) next[colId] = entry;
    else delete next[colId];
    setMapping(next);
  };

  const handleSave = async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    try {
      await onSaveMapping(mapping);
      setSavedSnapshot(JSON.stringify(mapping));
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (saving) return;
    try {
      setMapping(JSON.parse(savedSnapshot) as ColumnMapping);
    } catch {
      setMapping(policy.columnMapping || {});
    }
  };

  const { wiredRows, mappedRows, unmappedRows } = useMemo(() => {
    const wired: Column[] = [];
    const mapped: Column[] = [];
    const unmapped: Column[] = [];

    for (const col of columns) {
      const isLink = col.type === 'link' && col.id === policy.linkColumnId;
      const isPeople = col.type === 'people' && col.id === policy.peopleColumnId;
      const isWired = isLink || isPeople || (WIRED_TYPES.has(col.type) && col.type !== 'link' && col.type !== 'people');

      if (isWired) {
        wired.push(col);
      } else if (isMeaningful(mapping[col.id])) {
        mapped.push(col);
      } else {
        unmapped.push(col);
      }
    }

    return { wiredRows: wired, mappedRows: mapped, unmappedRows: unmapped };
  }, [columns, policy.linkColumnId, policy.peopleColumnId, mapping]);

  if (!columns.length) {
    return <p style={{ color: '#676879', fontSize: 13 }}>Choose a board above to see its columns.</p>;
  }

  const renderRows = (cols: Column[], tintUnmapped = false) =>
    cols.map((col) => {
      const isLink = col.type === 'link' && col.id === policy.linkColumnId;
      const isPeople = col.type === 'people' && col.id === policy.peopleColumnId;
      const wired = isLink || isPeople || (WIRED_TYPES.has(col.type) && col.type !== 'link' && col.type !== 'people');
      return (
        <tr
          key={col.id}
          style={{
            borderBottom: '1px solid #f0f2f7',
            ...(tintUnmapped ? { background: 'rgba(217, 58, 82, 0.04)' } : {}),
          }}
        >
          <Td>
            <strong>{col.title}</strong>
          </Td>
          <Td>
            <TypePill type={col.type} />
          </Td>
          <Td>
            {isLink ? (
              <span style={{ color: '#676879', fontSize: 12 }}>wired above (Event Link)</span>
            ) : isPeople ? (
              <span style={{ color: '#676879', fontSize: 12 }}>wired above (People)</span>
            ) : wired ? (
              <span style={{ color: '#676879', fontSize: 12 }}>(not mappable)</span>
            ) : (
              <Flex gap={Flex.gaps.SMALL} align={Flex.align.CENTER} style={{ width: '100%' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <EditorDispatcher
                    column={col}
                    entry={mapping[col.id] ?? null}
                    disabled={!canEdit || saving}
                    onChange={(next) => setEntry(col.id, next)}
                  />
                </div>
                {isMeaningful(mapping[col.id]) && (
                  <Tooltip content="Unmap this column">
                    <IconButton
                      icon={CloseSmall}
                      size="small"
                      kind="tertiary"
                      ariaLabel="Unmap column"
                      disabled={!canEdit || saving}
                      onClick={() => setEntry(col.id, null)}
                    />
                  </Tooltip>
                )}
              </Flex>
            )}
          </Td>
        </tr>
      );
    });

  // Shared colgroup — third column widened to accommodate the richer editors
  // (TemplateEditor, multi-select dropdowns) and keep column alignment across
  // the three section tables.
  const renderColgroup = () => (
    <colgroup>
      <col style={{ width: '28%' }} />
      <col style={{ width: '14%' }} />
      <col style={{ width: '58%', minWidth: 360 }} />
    </colgroup>
  );

  return (
    <div>
      <Flex gap={Flex.gaps.SMALL} align={Flex.align.CENTER} style={{ marginBottom: 12 }}>
        <Chips label={`Wired ${wiredRows.length}`} color="primary" readOnly noAnimation />
        <Chips
          label={`Mapped ${mappedRows.length}`}
          color={mappedRows.length > 0 ? 'positive' : 'primary'}
          readOnly
          noAnimation
        />
        <Chips
          label={`Unmapped ${unmappedRows.length}`}
          color={unmappedRows.length > 0 ? 'negative' : 'positive'}
          readOnly
          noAnimation
        />
      </Flex>

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        {renderColgroup()}
        <thead>
          <tr style={{ borderBottom: '1px solid #e6e9ef' }}>
            <Th>Column</Th>
            <Th>Type</Th>
            <Th>Source (Google field)</Th>
          </tr>
        </thead>
      </table>

      {unmappedRows.length > 0 && (
        <ExpandCollapse title={`Unmapped (${unmappedRows.length})`} defaultOpenState={true} hideBorder>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            {renderColgroup()}
            <tbody>{renderRows(unmappedRows, true)}</tbody>
          </table>
        </ExpandCollapse>
      )}

      {mappedRows.length > 0 && (
        <ExpandCollapse title={`Mapped (${mappedRows.length})`} defaultOpenState={true} hideBorder>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            {renderColgroup()}
            <tbody>{renderRows(mappedRows, false)}</tbody>
          </table>
        </ExpandCollapse>
      )}

      {wiredRows.length > 0 && (
        <ExpandCollapse title={`Wired (auto, ${wiredRows.length})`} defaultOpenState={false} hideBorder>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            {renderColgroup()}
            <tbody>{renderRows(wiredRows, false)}</tbody>
          </table>
        </ExpandCollapse>
      )}

      <Flex
        gap={Flex.gaps.SMALL}
        align={Flex.align.CENTER}
        style={{
          marginTop: 16,
          paddingTop: 12,
          borderTop: '1px solid var(--layout-border-color)',
        }}
      >
        <Text type="text2" color="secondary">
          {isDirty
            ? `${dirtyCount} unsaved change${dirtyCount === 1 ? '' : 's'}`
            : 'All changes saved'}
        </Text>
        <span style={{ flex: 1 }} />
        <Button
          kind="tertiary"
          size="small"
          leftIcon={Undo}
          disabled={!isDirty || saving || !canEdit}
          onClick={handleDiscard}
        >
          Discard
        </Button>
        <Button
          kind="primary"
          size="small"
          leftIcon={Check}
          disabled={!isDirty || saving || !canEdit}
          loading={saving}
          onClick={handleSave}
        >
          {saving ? 'Saving…' : 'Save mapping'}
        </Button>
      </Flex>
    </div>
  );
}

function TypePill({ type }: { type: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 10,
      fontSize: 11,
      fontWeight: 600,
      background: '#eef1fa',
      color: '#5559df',
    }}>{type}</span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{
      textAlign: 'left',
      padding: '10px 12px',
      color: '#676879',
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    }}>{children}</th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: '8px 12px', fontSize: 13, verticalAlign: 'top' }}>{children}</td>;
}
