/**
 * BoardRelationFieldControl — a connected-boards ("board_relation") required field.
 *
 * Same field-height bar as every other control, opening a searchable list of items from
 * the board the column points at. Modelled on the discussions app's "דיון קודם" picker
 * (apps/discussions/src/components/CreateDiscussionModal), with two deliberate changes:
 * the menu is the shared portal Popover rather than an absolutely-positioned <ul> (an
 * absolute menu clips inside monday's dialog iframes), and the candidates are fetched
 * lazily on FIRST OPEN rather than on mount — a relation field must not slow down the
 * form that is blocking the user's status transition.
 *
 * Single vs multi follows the column's own `allowMultipleItems` setting, so the field
 * accepts exactly what monday's cell would. Writing two ids to a single-link column is
 * a ColumnValueException, which is why the registry's default is single.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Search as SearchIcon } from '@vibe/icons';
import {
  relationAllowsMultiple,
  relationTargetBoardIds,
} from '../../domain/columnFields';
import { GET_LINKED_BOARD_ITEMS } from '../../services/graphqlQueries';
import mondayService from '../../services/mondayService';
import logger from '../../utils/logger';
import { Popover } from '../shared/Popover';

/**
 * One page of candidates. 500 matches the proven discussions picker; past that the
 * control says so out loud instead of showing a silent prefix.
 */
const CANDIDATE_LIMIT = 500;

const POPOVER_HEIGHT_PX = 260;

function selectedList(value) {
  return Array.isArray(value) ? value : [];
}

function BoardRelationFieldControl({
  column, value, onChange, disabled, controlId,
}) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef(null);

  const boardIds = useMemo(() => relationTargetBoardIds(column?.settings), [column]);
  const allowMultiple = useMemo(() => relationAllowsMultiple(column?.settings), [column]);
  const selected = selectedList(value);

  const loadCandidates = useCallback(async () => {
    if (loaded || loading || boardIds.length === 0) return;
    try {
      setLoading(true);
      setLoadError(null);
      const data = await mondayService.query(GET_LINKED_BOARD_ITEMS, {
        boardIds,
        limit: CANDIDATE_LIMIT,
      });
      const boards = Array.isArray(data?.boards) ? data.boards : [];
      const items = [];
      let hitTheCap = false;
      boards.forEach((board) => {
        if (board?.items_page?.cursor) hitTheCap = true;
        (board?.items_page?.items ?? []).forEach((item) => {
          const id = item?.id === null || item?.id === undefined ? '' : String(item.id);
          if (id !== '') items.push({ id, name: typeof item?.name === 'string' ? item.name : '' });
        });
      });
      setCandidates(items);
      setTruncated(hitTheCap);
      setLoaded(true);
    } catch (err) {
      logger.error('BoardRelationFieldControl', 'Failed to load linked-board items', err);
      setLoadError('לא הצלחנו לטעון את הפריטים מהלוח המקושר.');
    } finally {
      setLoading(false);
    }
  }, [boardIds, loaded, loading]);

  const openMenu = () => {
    if (disabled) return;
    setOpen(true);
    // Not awaited: the menu opens now and fills in when the items arrive.
    loadCandidates();
  };

  // A column pointing at no board cannot be filled. Say so rather than opening an
  // empty menu — the fix is in the board's column settings, not in this form.
  if (boardIds.length === 0) {
    return <p className="twyst-field-note">העמודה הזו אינה מקושרת ללוח, ולכן לא ניתן לבחור פריט.</p>;
  }

  const chosenNames = selected.map((item) => item.name || item.id);
  const query = search.trim().toLowerCase();
  const visible = query === ''
    ? candidates
    : candidates.filter((item) => item.name.toLowerCase().includes(query));

  const toggle = (item) => {
    if (!allowMultiple) {
      onChange([item]);
      setOpen(false);
      return;
    }
    const isOn = selected.some((entry) => entry.id === item.id);
    onChange(isOn
      ? selected.filter((entry) => entry.id !== item.id)
      : [...selected, item]);
  };

  return (
    <>
      <button
        id={controlId}
        ref={triggerRef}
        type="button"
        className={`twyst-field-trigger${chosenNames.length > 0 ? '' : ' is-empty'}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={openMenu}
      >
        <span>{chosenNames.length > 0 ? chosenNames.join(', ') : 'בחרו פריט'}</span>
        <SearchIcon aria-hidden="true" />
      </button>

      <Popover
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        preferred="bottom-start"
        matchAnchorWidth
        width={280}
        height={POPOVER_HEIGHT_PX}
      >
        <div className="twyst-option-list" role="listbox" aria-label="פריטים מקושרים">
          <div className="twyst-option-search">
            <SearchIcon aria-hidden="true" />
            <input
              type="text"
              value={search}
              aria-label="חיפוש פריט"
              placeholder="חיפוש"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          {loading && <p className="twyst-field-note">טוען…</p>}
          {loadError && <p className="twyst-field-error">{loadError}</p>}

          {!loading && !loadError && visible.length === 0 && (
            <p className="twyst-field-note">
              {candidates.length === 0 ? 'אין פריטים בלוח המקושר.' : 'לא נמצאו פריטים.'}
            </p>
          )}

          {visible.map((item) => {
            const isOn = selected.some((entry) => entry.id === item.id);
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={isOn}
                className={`twyst-option-row${isOn ? ' is-on' : ''}`}
                onClick={() => toggle(item)}
              >
                <span className="twyst-option-check" aria-hidden="true">{isOn ? '✓' : ''}</span>
                {item.name || item.id}
              </button>
            );
          })}

          {truncated && (
            <p className="twyst-field-note">
              מוצגים
              {' '}
              {CANDIDATE_LIMIT}
              {' '}
              הפריטים הראשונים בלוח. חפשו כדי לצמצם.
            </p>
          )}
        </div>
      </Popover>
    </>
  );
}

export default BoardRelationFieldControl;
