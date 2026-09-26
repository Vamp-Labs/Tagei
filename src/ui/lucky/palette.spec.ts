import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CANVAS, CONFETTI, ROLE, TOKENS, hexA, mix, rgba, type Swatch } from './palette';

const css = readFileSync(fileURLToPath(new URL('../../index.css', import.meta.url)), 'utf8');

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const declared = new Map<string, string>();
for (const match of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
  declared.set(match[1], match[2].toLowerCase());
}

const flatten = (value: Swatch | readonly Swatch[]): Swatch[] => (Array.isArray(value) ? [...value] : [value as Swatch]);

describe('palette.ts stays in sync with src/index.css', () => {
  it('declares every TOKENS entry with the same hex', () => {
    for (const [name, swatch] of Object.entries(TOKENS)) {
      const cssName = kebab(name);
      expect(declared.get(cssName), cssName).toBe(swatch.hex);
      expect(swatch.css).toBe(`var(--color-${cssName})`);
    }
  });

  it('has a TOKENS entry for every raw colour in the theme', () => {
    const tokenNames = new Set(Object.keys(TOKENS).map(kebab));
    for (const name of declared.keys()) expect(tokenNames.has(name), name).toBe(true);
  });

  it('maps roles onto the documented tokens', () => {
    expect(ROLE.dirShort.hex).toBe('#2dbdf1');
    expect(ROLE.loss.hex).toBe(TOKENS.red.hex);
    expect(ROLE.cta.css).toBe('var(--color-cta)');
    for (const role of ['cta', 'brand', 'premium', 'dir-long', 'dir-short', 'profit', 'loss']) {
      expect(css).toMatch(new RegExp(`--color-${role}:\\s*var\\(--color-`));
    }
  });

  it('never hands hot to the canvas or the confetti', () => {
    const hot = new Set([TOKENS.hot.hex, TOKENS.hotLight.hex]);
    for (const value of Object.values(CANVAS)) for (const swatch of flatten(value)) expect(hot.has(swatch.hex)).toBe(false);
    for (const colors of Object.values(CONFETTI)) for (const hex of colors) expect(hot.has(hex)).toBe(false);
  });

  it('builds alpha and mixed colours', () => {
    expect(hexA(TOKENS.ink, 0.5)).toBe('#ffffff80');
    expect(rgba(TOKENS.canvas, 0.55)).toBe('rgba(3, 13, 25, 0.55)');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});
