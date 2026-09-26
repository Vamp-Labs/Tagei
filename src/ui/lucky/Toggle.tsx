import React, { useId } from 'react';
import { cn } from '../cn';

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, label, description, disabled = false, className }) => {
  const labelId = useId();
  const descId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={description ? descId : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('lg-toggle', className)}
    >
      <span className="lg-toggle-text">
        <span id={labelId} className="lg-toggle-label">
          {label}
        </span>
        {description && (
          <span id={descId} className="lg-toggle-desc">
            {description}
          </span>
        )}
      </span>
      <span className={cn('lg-switch', checked && 'is-on')} aria-hidden="true" />
    </button>
  );
};
