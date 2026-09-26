import React from 'react';
import { cn } from '../cn';

export interface PanelProps {
  title?: React.ReactNode;
  tone?: 'panel' | 'well';
  as?: 'section' | 'div' | 'article' | 'aside';
  className?: string;
  children?: React.ReactNode;
}

export const Panel: React.FC<PanelProps> = ({ title, tone = 'panel', as: Tag = 'section', className, children }) => (
  <Tag className={cn('lg-panel', tone === 'well' && 'lg-panel--well', className)}>
    {title && <h3 className="lg-panel-title">{title}</h3>}
    {children}
  </Tag>
);
