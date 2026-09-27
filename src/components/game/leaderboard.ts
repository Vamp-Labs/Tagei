import type { LeaderboardEntry } from '../../api/client';

export type MedalTone = 'gold' | 'silver' | 'bronze' | null;

export function medalTone(rank: number): MedalTone {
  if (rank === 1) return 'gold';
  if (rank === 2) return 'silver';
  if (rank === 3) return 'bronze';
  return null;
}

export function isOwnEntry(entry: Pick<LeaderboardEntry, 'address'>, ownAddress: string | null): boolean {
  return ownAddress !== null && entry.address.toLowerCase() === ownAddress.toLowerCase();
}
