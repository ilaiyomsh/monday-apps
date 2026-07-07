import { Avatar, Skeleton } from '@vibe/core';
import { Locked } from '@vibe/icons';
import type { MondayContext, Me } from '../types';

interface Props {
  context: MondayContext | null;
  me: Me | null;
  isOwner: boolean;
  loading: boolean;
}

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return trimmed.slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Rounded pill rendered on the right of the page title, matching the design.
// Avatar · <name> · <account> · role chip.
export function IdentityPill({ context, me, isOwner, loading }: Props) {
  const userName = me?.name || context?.user?.name || 'Signed in';
  const accountName = me?.account?.name || me?.account?.slug || '';
  const initials = getInitials(me?.name || context?.user?.name || '');

  const showNameSkeleton = loading && !me && !context?.user?.name;

  return (
    <div className="identity">
      <Avatar
        size="small"
        type="img"
        src={me?.photo_thumb_small || undefined}
        text={initials}
        ariaLabel={userName}
        withoutTooltip
      />
      <span>
        {showNameSkeleton ? (
          <Skeleton height={12} width={80} />
        ) : (
          <strong>{userName}</strong>
        )}
        {accountName && (
          <>
            <span className="dot" />
            {accountName}
          </>
        )}
      </span>
      <span className="role-chip">
        <Locked size={11} />
        {isOwner ? 'Owner' : 'Member'}
      </span>
    </div>
  );
}

// Backwards-compat alias for any older imports.
export { IdentityPill as IdentityBar };
