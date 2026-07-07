/**
 * Avatar — the user's monday photo (photo_thumb_small) when available, falling
 * back to a colored initials bubble. Ported from the prototype, extended with
 * the real photo.
 */
import { useState } from 'react';
import type { Employee } from '../../domain/types';

export interface AvatarProps {
  emp?: Employee | null;
  size?: string;
}

export function Avatar({ emp, size = 'md' }: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  if (!emp) return null;
  const showPhoto = Boolean(emp.photoUrl) && !imgFailed;
  return (
    <div className={`avatar ${size}`} style={{ background: emp.color }} title={emp.name}>
      {showPhoto ? (
        <img
          className="avatar-img"
          src={emp.photoUrl}
          alt={emp.name}
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      ) : (
        emp.initials
      )}
    </div>
  );
}
