import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

export const LUCKY_TEXT_SIZES = [
  'display',
  'amount',
  'title',
  'section',
  'body',
  'label',
  'caption',
  'micro',
  'numeral',
  'hero-price',
  'screen-title',
  'metadata',
] as const;

export const LUCKY_SHADOWS = ['glow-lucky', 'glow-hot', 'glow-gold', 'lift'] as const;

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [...LUCKY_TEXT_SIZES],
      shadow: [...LUCKY_SHADOWS],
    },
  },
});

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
