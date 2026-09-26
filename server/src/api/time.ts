// UTC calendar helpers for streaks, missions, quotas and the weekly leaderboard.

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` of `ms` in UTC. */
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const dayStartMs = (day: string): number => Date.parse(`${day}T00:00:00.000Z`);

export const addDays = (day: string, n: number): string => utcDay(dayStartMs(day) + n * DAY_MS);

export const previousDay = (day: string): string => addDays(day, -1);

/** Monday 00:00 UTC of the week containing `ms`, as `YYYY-MM-DD`. */
export function weekStartDay(ms: number): string {
  const d = new Date(ms);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return utcDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - sinceMonday * DAY_MS);
}

export const msUntilNextUtcDay = (ms: number): number => dayStartMs(utcDay(ms)) + DAY_MS - ms;

export const nowSec = (ms: number): number => Math.floor(ms / 1000);
