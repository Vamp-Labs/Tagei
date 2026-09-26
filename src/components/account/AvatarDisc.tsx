import React from 'react';
import { cn } from '../../ui/cn';
import { ART } from '../../ui/lucky';

const DISC_PX = 48;

export const AvatarDisc: React.FC<{ className?: string }> = ({ className }) => (
  <span
    className={cn('grid flex-none place-items-center overflow-hidden rounded-full bg-lobby', className)}
    style={{ width: DISC_PX, height: DISC_PX }}
    aria-hidden="true"
  >
    <img src={ART.avatar.src} alt="" width={ART.avatar.w} height={ART.avatar.h} />
  </span>
);
