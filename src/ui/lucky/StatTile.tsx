import React from 'react';
import { cn } from '../cn';

export interface StatTileProps {
  value: React.ReactNode;
  label: React.ReactNode;
  art?: string;
  icon?: React.ReactNode;
  className?: string;
}

export const StatTile: React.FC<StatTileProps> = ({ value, label, art, icon, className }) => (
  <div className={cn('lg-stat-tile', className)}>
    {art ? <img src={art} alt="" width={40} height={40} className="h-10 w-auto" /> : icon}
    <span className="lg-stat-tile-value">{value}</span>
    <span className="lg-stat-tile-label">{label}</span>
  </div>
);
