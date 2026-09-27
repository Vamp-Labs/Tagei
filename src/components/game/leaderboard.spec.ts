import { describe, expect, it } from 'vitest';
import { isOwnEntry, medalTone } from './leaderboard';

describe('medalTone', () => {
  it('maps the top three ranks to medal tones and everything else to null', () => {
    expect(medalTone(1)).toBe('gold');
    expect(medalTone(2)).toBe('silver');
    expect(medalTone(3)).toBe('bronze');
    expect(medalTone(4)).toBeNull();
    expect(medalTone(0)).toBeNull();
  });
});

describe('isOwnEntry', () => {
  const entry = { address: '0xABCDEF0000000000000000000000000000000F' };

  it('matches the connected address case-insensitively', () => {
    expect(isOwnEntry(entry, '0xabcdef0000000000000000000000000000000f')).toBe(true);
  });

  it('is false when no address is connected', () => {
    expect(isOwnEntry(entry, null)).toBe(false);
  });

  it('is false for a mismatched address', () => {
    expect(isOwnEntry(entry, '0x0000000000000000000000000000000000dEaD')).toBe(false);
  });
});
