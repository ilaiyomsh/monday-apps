/**
 * PeoplePicker — monday People-column-style picker. The field shows ONLY the
 * selected avatars (or a placeholder); clicking opens a popover with the
 * selection as removable @vibe/core Chips above a searchable Combobox of
 * "Suggested people". API: { value: ids, onChange, users }.
 *
 * Open/close is handled locally (a controlled Vibe Dialog proved unreliable as
 * a trigger); only the inner widgets are Vibe.
 */
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Chips, Combobox } from '@vibe/core';
import { Team } from '@vibe/icons';
import type { Employee } from '../../domain/types';

export interface PeoplePickerProps {
  value: string[];
  onChange: (ids: string[]) => void;
  /** Full account directory to choose from. */
  users: Employee[];
  /** Shown when nothing is selected. */
  placeholder?: string;
  disabled?: boolean;
}

type ComboOptions = NonNullable<ComponentProps<typeof Combobox>['options']>;

export function PeoplePicker({ value, onChange, users, placeholder, disabled }: PeoplePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const selected = useMemo(
    () => value.map((id) => byId.get(id) ?? ({ id, name: id, initials: '?', color: '#c3c6d4' } as Employee)),
    [value, byId],
  );

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const remove = (id: string) => onChange(value.filter((x) => x !== id));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  const options = useMemo<ComboOptions>(
    () =>
      // leftIconType is the "renderer" enum member at runtime; cast past the
      // string-union public alias which TS won't accept directly.
      users.map((u) => ({
        id: u.id,
        label: u.name,
        categoryId: 'suggested',
        selected: value.includes(u.id),
        leftIconType: 'renderer',
        leftIcon: () => (
          <Avatar size="small" src={u.photoUrl} text={u.initials} type={u.photoUrl ? 'img' : 'text'} aria-label={u.name} />
        ),
      })) as unknown as ComboOptions,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, value],
  );

  const categories = { suggested: { id: 'suggested', label: t('peoplePicker.suggested') } };

  return (
    <div className="ppicker" ref={rootRef}>
      <div
        className={`ppicker-field ${disabled ? 'is-disabled' : ''}`}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        {selected.length > 0 ? (
          selected.map((u) => (
            <Chips
              key={u.id}
              label={u.name}
              leftAvatar={u.photoUrl || u.initials}
              leftAvatarType={u.photoUrl ? 'img' : 'text'}
              onDelete={() => remove(u.id)}
            />
          ))
        ) : (
          <span className="ppicker-ph">
            <Team size={14} /> {placeholder ?? t('peoplePicker.placeholder')}
          </span>
        )}
      </div>

      {open && (
        <div className="ppicker-pop" dir="ltr">
          {selected.length > 0 && (
            <div className="ppicker-chips">
              {selected.map((u) => (
                <Chips
                  key={u.id}
                  label={u.name}
                  leftAvatar={u.photoUrl || u.initials}
                  leftAvatarType={u.photoUrl ? 'img' : 'text'}
                  onDelete={() => remove(u.id)}
                />
              ))}
            </div>
          )}
          <Combobox
            options={options}
            categories={categories}
            placeholder={t('peoplePicker.search')}
            noResultsMessage={t('peoplePicker.noMatch')}
            size="small"
            optionsListHeight={220}
            autoFocus
            stickyCategories
            onClick={(opt) => opt?.id != null && toggle(String(opt.id))}
          />
        </div>
      )}
    </div>
  );
}
