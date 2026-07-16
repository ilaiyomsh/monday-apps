import React, { useState, useId } from 'react';
import { Avatar, AvatarGroup, Flex, Text, Counter, Dialog, DialogContentContainer } from '@vibe/core';
import { useUsers } from '@api/hooks/use-users';
import styles from './PersonAvatar.module.css';

/* round112 — monday's EXACT empty-people glyph, traced from the owner's
   screenshot: an outer gray ring with an outlined bust inside — round head
   TANGENT to the shoulders arc, and the shoulders CLIPPED by the ring (not a
   small person floating in the middle). One stroke color throughout. The SVG
   draws the ring itself, so the host element needs no CSS border. useId keeps
   the clipPath unique across the many instances a table renders. */
export function EmptyPersonGlyph({ size = 28 }) {
  const clipId = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <circle cx="16" cy="16" r="14" />
        </clipPath>
      </defs>
      <circle cx="16" cy="16" r="14" stroke="#b8bdc9" strokeWidth="1.8" />
      <g clipPath={`url(#${clipId})`} stroke="#b8bdc9" strokeWidth="1.8">
        <circle cx="16" cy="12.5" r="5" />
        <circle cx="16" cy="28" r="10.5" />
      </g>
    </svg>
  );
}

const SIZE_MAP = {
  default: "small",
  sm: "small",
  lg: "medium",
};

function initialsOf(name) {
  return (name || '?')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2);
}

export function PersonAvatar({ person, size = 'default', showName = true }) {
  const ids = person ? [person.id] : [];
  const { users } = useUsers(ids);
  if (!person) return null;
  const user = users?.[0];
  const photo = user?.photo_thumb;
  const displayName = user?.name || person.name;

  return (
    <Flex gap={6} align="center">
      {/* Name tooltip via the NATIVE title attribute (round 33): browser-rendered
          so it is never clipped by an overflow ancestor and always paints above
          all app UI — the @vibe Avatar tooltip was getting hidden behind other
          elements. */}
      <span className={styles.avatarTip} title={displayName}>
        <Avatar
          size={SIZE_MAP[size] || "small"}
          src={photo}
          text={initialsOf(displayName)}
          type={photo ? "img" : "text"}
          ariaLabel={displayName}
        />
      </span>
      {showName && <Text className={styles.name}>{displayName}</Text>}
    </Flex>
  );
}

// Compact avatar group (header / PEOPLE-column style) with a click-to-expand
// popover. The group is a single click target; the popover lists all people with
// photo + name so the full roster is reachable even past the "+N" overflow.
function PersonListCompact({ people, byId, avatarSize, size, max }) {
  const [open, setOpen] = useState(false);

  const group = (
    <AvatarGroup size={avatarSize} max={max}>
      {people.map((p) => {
        const u = byId.get(String(p.id));
        const photo = u?.photo_thumb;
        const name = u?.name || p.name;
        return (
          <Avatar
            key={p.id}
            size={avatarSize}
            src={photo}
            text={initialsOf(name)}
            type={photo ? "img" : "text"}
            ariaLabel={name}
            // Overlapping AvatarGroup avatars can't be wrapped in a native-title
            // span without breaking the stack, so keep the @vibe tooltip but pin
            // it to the app popover z-index (10000) so it's never hidden (round 33).
            tooltipProps={{ content: name, zIndex: 10000 }}
          />
        );
      })}
    </AvatarGroup>
  );

  return (
    <Dialog
      open={open}
      showTrigger={['click']}
      hideTrigger={['clickoutside', 'esc']}
      onDialogDidShow={() => setOpen(true)}
      onDialogDidHide={() => setOpen(false)}
      position="bottom"
      zIndex={10000}
      content={() => (
        <DialogContentContainer>
          <div className={styles.expandList}>
            {people.map((p) => (
              <PersonAvatar key={p.id} person={p} size={size} showName />
            ))}
          </div>
        </DialogContentContainer>
      )}
    >
      <button type="button" className={styles.expandTrigger} aria-label="הצג רשימת אנשים מלאה">
        {group}
      </button>
    </Dialog>
  );
}

export function PersonList({ people = [], size = 'default', showNames = true, max = 3 }) {
  // Batch-resolve every person's photo + name in one query (cached), so avatars
  // actually render their images instead of empty circles.
  const ids = (people || []).map((p) => p.id);
  const { users } = useUsers(ids);
  const byId = new Map((users || []).map((u) => [String(u.id), u]));

  if (!people || people.length === 0) {
    // monday "unassigned" avatar — the exact traced glyph (round112).
    return (
      <span className={styles.emptyAvatar} aria-label="לא הוקצה" title="לא הוקצה">
        <EmptyPersonGlyph size={28} />
      </span>
    );
  }

  const avatarSize = SIZE_MAP[size] || "small";

  // Compact / header mode — overlapping avatar group like monday's PEOPLE column.
  // Shows up to `max` avatars then a "+N" counter (monday standard). Clicking the
  // group opens a popover listing every person with their photo + name.
  if (!showNames) {
    return <PersonListCompact people={people} byId={byId} avatarSize={avatarSize} size={size} max={max} />;
  }

  // Named-row mode (TaskTableRow / OverviewTab).
  const shown = people.slice(0, max);
  const remaining = people.length - max;

  return (
    <Flex gap={8} align="center" wrap>
      {shown.map((p) => (
        <PersonAvatar key={p.id} person={p} size={size} showName={showNames} />
      ))}
      {remaining > 0 && <Counter count={remaining} prefix="+" />}
    </Flex>
  );
}

export default PersonAvatar;
