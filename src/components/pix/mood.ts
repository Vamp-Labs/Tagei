export type PixMood = 'happy' | 'neutral' | 'concerned';

export const HAPPY_PNL = 4;
export const CONCERNED_PNL = -2.5;

export const pixMoodFor = (pnl: number): PixMood =>
  pnl >= HAPPY_PNL ? 'happy' : pnl < CONCERNED_PNL ? 'concerned' : 'neutral';
