import React, { memo, useMemo } from 'react';

export const Avatar = memo<{ name: string; url?: string; size?: number }>(({ name, url, size = 24 }) => {
  const initials = useMemo(() => {
    return name.split(' ').map(n => n[0]).slice(0, 2).join('');
  }, [name]);

  return (
    <div
      className="relative flex items-center justify-center rounded-full overflow-hidden border border-white shadow-sm flex-shrink-0 bg-avatar-bg text-white font-medium select-none"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      title={name}
    >
      {url ? (
        <img src={url} alt={name} className="w-full h-full object-cover" />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
});
