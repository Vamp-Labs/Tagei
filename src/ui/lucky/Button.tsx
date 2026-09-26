import React from 'react';
import { cn } from '../cn';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'hot' | 'secondary' | 'icon' | 'arrow' | 'ghost';
export type ButtonSize = 'md' | 'lg';

export const buttonClass = (variant: ButtonVariant = 'secondary', size: ButtonSize = 'lg', block = false) =>
  cn('lg-btn', `lg-btn-${variant}`, size === 'md' && 'lg-btn--md', block && 'lg-btn--block');

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName | React.ReactElement;
  block?: boolean;
}

const GLYPH_SIZE: Record<ButtonVariant, number> = { hot: 22, secondary: 20, ghost: 20, icon: 24, arrow: 20 };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'lg', icon, block = false, className, children, type = 'button', ...rest }, ref) => {
    const glyph =
      typeof icon === 'string' ? <Icon name={icon} size={GLYPH_SIZE[variant]} /> : icon ?? null;
    const glyphOnly = variant === 'icon' || variant === 'arrow';

    return (
      <button ref={ref} type={type} className={cn(buttonClass(variant, size, block), className)} {...rest}>
        {glyphOnly ? glyph ?? <Icon name="back" size={GLYPH_SIZE[variant]} /> : (
          <>
            {glyph}
            {children}
          </>
        )}
      </button>
    );
  }
);
Button.displayName = 'Button';
