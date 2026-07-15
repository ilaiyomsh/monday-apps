// §10.2 — board / status column / from-to label / people column / optional
// expiry pickers. Label dropdowns are populated from settings.labels sorted
// by display index; the stored VALUE is labels[].id (stable across renames).

import { Dropdown, TextField } from '@vibe/core';
import type { Board, BoardColumn } from '../types';
import type { ConfigDraft } from '../draft';

interface Option {
  value: string;
  label: string;
}

interface Props {
  boards: Board[];
  columns: BoardColumn[];
  columnsLoading: boolean;
  draft: ConfigDraft;
  onChange: (patch: Partial<ConfigDraft>) => void;
}

function toOption(value: string, label: string): Option {
  return { value, label };
}

export function BoardConfigSection({ boards, columns, columnsLoading, draft, onChange }: Props) {
  const boardOptions = boards.map((b) => toOption(b.id, b.name));
  const statusColumns = columns.filter((c) => c.type === 'status');
  const peopleColumns = columns.filter((c) => c.type === 'people');
  const dateColumns = columns.filter((c) => c.type === 'date');
  const selectedStatus = statusColumns.find((c) => c.id === draft.statusColumnId) ?? null;
  const labelOptions = (selectedStatus?.labels ?? []).map((l) => toOption(String(l.id), l.label));

  const findOption = (options: Option[], value: string | null) =>
    options.find((o) => o.value === value) ?? null;

  return (
    <section className="dc-section">
      <h2>הגדרת לוח</h2>
      <div className="dc-row">
        <div className="dc-field">
          <label>לוח יעד</label>
          <Dropdown
            placeholder="בחרו לוח"
            options={boardOptions}
            value={findOption(boardOptions, draft.boardId)}
            onChange={(opt: Option | null) => onChange({ boardId: opt?.value ?? null })}
            clearable={false}
          />
        </div>
        <div className="dc-field">
          <label>עמודת סטטוס</label>
          <Dropdown
            placeholder={columnsLoading ? 'טוען עמודות…' : 'בחרו עמודת סטטוס'}
            disabled={!draft.boardId || columnsLoading}
            options={statusColumns.map((c) => toOption(c.id, c.title))}
            value={findOption(
              statusColumns.map((c) => toOption(c.id, c.title)),
              draft.statusColumnId
            )}
            onChange={(opt: Option | null) => onChange({ statusColumnId: opt?.value ?? null })}
            clearable={false}
          />
        </div>
      </div>
      <div className="dc-row">
        <div className="dc-field">
          <label>סטטוס מקור</label>
          <Dropdown
            placeholder="הסטטוס שמחכה לאישור"
            disabled={!selectedStatus}
            options={labelOptions}
            value={findOption(labelOptions, draft.fromIndex === null ? null : String(draft.fromIndex))}
            onChange={(opt: Option | null) =>
              onChange({ fromIndex: opt ? Number(opt.value) : null })
            }
            clearable={false}
          />
        </div>
        <div className="dc-field">
          <label>סטטוס יעד</label>
          <Dropdown
            placeholder="הסטטוס אחרי אישור"
            disabled={!selectedStatus}
            options={labelOptions}
            value={findOption(labelOptions, draft.toIndex === null ? null : String(draft.toIndex))}
            onChange={(opt: Option | null) => onChange({ toIndex: opt ? Number(opt.value) : null })}
            clearable={false}
          />
        </div>
      </div>
      {draft.fromIndex !== null && draft.fromIndex === draft.toIndex && (
        <div className="dc-error">סטטוס המקור וסטטוס היעד חייבים להיות שונים.</div>
      )}
      <div className="dc-row">
        <div className="dc-field">
          <label>עמודת אחראי (לשורת הייחוס בעדכון)</label>
          <Dropdown
            placeholder="בחרו עמודת אנשים"
            disabled={!draft.boardId || columnsLoading}
            options={peopleColumns.map((c) => toOption(c.id, c.title))}
            value={findOption(
              peopleColumns.map((c) => toOption(c.id, c.title)),
              draft.peopleColumnId
            )}
            onChange={(opt: Option | null) => onChange({ peopleColumnId: opt?.value ?? null })}
          />
        </div>
      </div>
      <div className="dc-row">
        <div className="dc-field">
          <label>עמודת דדליין (אופציונלי — לתפוגת קישורים)</label>
          <Dropdown
            placeholder="ללא תפוגה"
            disabled={!draft.boardId || columnsLoading}
            options={dateColumns.map((c) => toOption(c.id, c.title))}
            value={findOption(
              dateColumns.map((c) => toOption(c.id, c.title)),
              draft.expiryDateColumnId
            )}
            onChange={(opt: Option | null) => onChange({ expiryDateColumnId: opt?.value ?? null })}
          />
        </div>
        <div className="dc-field">
          <label>ימי חסד (0 = ללא תפוגה)</label>
          <TextField
            type="number"
            value={String(draft.expiryGraceDays)}
            onChange={(value: string) => {
              const parsed = Number(value);
              onChange({
                expiryGraceDays: Number.isInteger(parsed) && parsed >= 0 ? parsed : 0,
              });
            }}
          />
        </div>
      </div>
    </section>
  );
}
