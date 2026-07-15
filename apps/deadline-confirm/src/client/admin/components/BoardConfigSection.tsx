// v2 §board — board picker + attribution people column. Status columns and
// target labels moved into the per-button cards (ButtonsSection).

import { Dropdown } from '@vibe/core';
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
  const peopleColumns = columns.filter((c) => c.type === 'people');
  const peopleOptions = peopleColumns.map((c) => toOption(c.id, c.title));
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
          <label>עמודת אחראי (לשורת הייחוס בעדכון)</label>
          <Dropdown
            placeholder={columnsLoading ? 'טוען עמודות…' : 'בחרו עמודת אנשים'}
            disabled={!draft.boardId || columnsLoading}
            options={peopleOptions}
            value={findOption(peopleOptions, draft.peopleColumnId)}
            onChange={(opt: Option | null) => onChange({ peopleColumnId: opt?.value ?? null })}
          />
        </div>
      </div>
    </section>
  );
}
