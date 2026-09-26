import React from 'react';
import { cn } from '../cn';
import { Button } from './Button';

export interface SheetHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  eyebrow?: React.ReactNode;
  onBack?: () => void;
  action?: React.ReactNode;
  grabber?: boolean;
  className?: string;
}

export const SheetHeader: React.FC<SheetHeaderProps> = ({
  title,
  subtitle,
  eyebrow,
  onBack,
  action,
  grabber = false,
  className,
}) => (
  <header className={cn('lg-sheethead', className)}>
    {grabber && <span className="lg-grabber" aria-hidden="true" />}
    <div className="lg-sheethead-row">
      {onBack ? (
        <Button variant="icon" size="md" icon="back" aria-label="Back" onClick={onBack} />
      ) : (
        <span className="lg-sheethead-spacer" aria-hidden="true" />
      )}
      <div className="lg-sheethead-titles">
        {eyebrow && <span className="lg-sheethead-eyebrow">{eyebrow}</span>}
        <h2 className="lg-sheethead-title">{title}</h2>
        {subtitle && <div className="lg-sheethead-sub">{subtitle}</div>}
      </div>
      {action ? <div className="lg-sheethead-action">{action}</div> : <span className="lg-sheethead-spacer" aria-hidden="true" />}
    </div>
  </header>
);
