import { describe, expect, it } from 'vitest';
import { cn } from '../cn';

describe('cn with the Lucky scale', () => {
  it('keeps a Lucky text size next to a text colour', () => {
    expect(cn('text-micro', 'text-ink')).toBe('text-micro text-ink');
    expect(cn('text-display text-lucky')).toBe('text-display text-lucky');
  });

  it('still resolves real conflicts inside one group', () => {
    expect(cn('text-micro', 'text-label')).toBe('text-label');
    expect(cn('text-ink', 'text-lucky')).toBe('text-lucky');
  });

  it('treats Lucky shadows as shadows', () => {
    expect(cn('shadow-glow-hot', 'shadow-lift')).toBe('shadow-lift');
    expect(cn('shadow-glow-lucky', 'text-ink')).toBe('shadow-glow-lucky text-ink');
  });
});
