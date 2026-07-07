import { IconButton, Text } from '@vibe/core';
import { CloseSmall } from '@vibe/icons';
import { StatusValuePicker } from './StatusValuePicker';
import { BoardRelationValuePicker } from './BoardRelationValuePicker';
import type { Column, ConditionalValue } from '../../types';

interface Props {
  eligibleColumns: Column[];
  values: Record<string, ConditionalValue>;
  disabled?: boolean;
  onChange: (next: Record<string, ConditionalValue>) => void;
}

export function ValueSection({ eligibleColumns, values, disabled, onChange }: Props) {
  if (eligibleColumns.length === 0) {
    return (
      <Text type="text2" color="secondary">
        No columns have been enabled for conditional override. Ask your admin to enable some in Setup.
      </Text>
    );
  }

  const setColumn = (colId: string, v: ConditionalValue | null) => {
    const next = { ...values };
    if (v == null) delete next[colId];
    else next[colId] = v;
    onChange(next);
  };

  return (
    <div className="cond-overrides">
      <div className="cond-caps-title">Column overrides</div>

      {eligibleColumns.map((col) => {
        const current = values[col.id] ?? null;
        const isSet = current !== null;
        return (
          <div key={col.id} className="override-row">
            <div className="override-label">
              <div className="override-name">{col.title}</div>
              <div className="override-type">{col.type}</div>
            </div>
            <div className="override-picker">
              {col.type === 'status' ? (
                <StatusValuePicker
                  column={col}
                  value={current}
                  disabled={disabled}
                  onChange={(v) => setColumn(col.id, v)}
                />
              ) : col.type === 'board_relation' ? (
                <BoardRelationValuePicker
                  column={col}
                  value={current}
                  disabled={disabled}
                  onChange={(v) => setColumn(col.id, v)}
                />
              ) : (
                <span style={{ color: 'var(--secondary-text-color)', fontSize: 12 }}>
                  Unsupported column type.
                </span>
              )}
            </div>
            {isSet ? (
              <IconButton
                icon={CloseSmall}
                kind="tertiary"
                size="small"
                disabled={disabled}
                onClick={() => setColumn(col.id, null)}
                ariaLabel={`Clear ${col.title} override`}
              />
            ) : (
              <span style={{ width: 28 }} aria-hidden />
            )}
          </div>
        );
      })}
    </div>
  );
}
