import React from 'react';
import { ART, type ArtName } from '../../ui/lucky/assets';
import { cn } from '../../ui/cn';

export interface OutcomeArtProps {
  name: ArtName;
  height?: number;
  label?: string;
  className?: string;
}

export const OutcomeArt: React.FC<OutcomeArtProps> = ({ name, height, label, className }) => {
  const art = ART[name];
  const h = Math.min(height ?? art.h, art.h);
  const w = Math.round((art.w * h) / art.h);
  return (
    <span
      className={cn(
        'inline-grid shrink-0 place-items-center',
        art.surface === 'tile' && 'rounded-md bg-tile p-1.5',
        className
      )}
    >
      <img
        src={art.src}
        width={w}
        height={h}
        alt={label ?? ''}
        aria-hidden={label ? undefined : true}
        decoding="async"
        draggable={false}
        className="block select-none"
      />
    </span>
  );
};
