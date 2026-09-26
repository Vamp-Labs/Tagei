// Rounds, balance and withdraw routes, plus player profiles, history and the leaderboard.

import { Hono } from 'hono';
import { getAddress } from 'viem';
import { z } from 'zod';
import {
  AddressString,
  BalanceSchema,
  CashOutRequestSchema,
  CashOutResponseSchema,
  LeaderboardEntrySchema,
  OpenRoundRequestSchema,
  OpenRoundResponseSchema,
  ProfileSchema,
  RoundSchema,
  UintString,
  WithdrawRequestSchema,
} from '@bnbplay/shared/dto';
import type { RoundBook } from '../ports.ts';
import type { AuthGuard } from '../auth/jwt.ts';
import type { ProgressionServiceImpl } from '../progression/service.ts';
import type { RoundHistory } from './deps.ts';
import { ApiError } from './errors.ts';
import { parseWith, readJson, readQuery, sendJson } from './http.ts';
import type { RoundsService } from './rounds.service.ts';

export const WithdrawResponseSchema = z.object({ intentId: z.string() });
export const RoundPageSchema = z.object({ items: z.array(RoundSchema), nextCursor: z.string().nullable() });
const PAGE = 20;

export function createRoundsRouter(deps: { service: RoundsService; guard: AuthGuard; roundBook: RoundBook; history: RoundHistory }): Hono {
  const r = new Hono();

  r.post('/rounds/open', deps.guard.required, async (c) => {
    const session = deps.guard.requireSession(c);
    const body = await readJson(c, OpenRoundRequestSchema);
    return sendJson(c, OpenRoundResponseSchema, await deps.service.open(session.player, body), 202);
  });

  r.post('/rounds/:id/cashout', deps.guard.required, async (c) => {
    const session = deps.guard.requireSession(c);
    const id = parseWith(UintString, c.req.param('id'), 'round id');
    const body = await readJson(c, CashOutRequestSchema);
    return sendJson(c, CashOutResponseSchema, await deps.service.cashOut(session.player, id, body), 202);
  });

  r.get('/rounds/:id', async (c) => {
    const id = BigInt(parseWith(UintString, c.req.param('id'), 'round id'));
    const dto = deps.roundBook.toDTO(id) ?? (await deps.history.get(id));
    if (!dto) throw new ApiError('ROUND_NOT_FOUND', 'round not found');
    return sendJson(c, RoundSchema, dto);
  });

  r.get('/me/balance', deps.guard.required, async (c) => {
    const session = deps.guard.requireSession(c);
    return sendJson(c, BalanceSchema, await deps.service.balance(session.player));
  });

  r.post('/me/withdraw', deps.guard.required, async (c) => {
    const session = deps.guard.requireSession(c);
    const body = await readJson(c, WithdrawRequestSchema);
    return sendJson(c, WithdrawResponseSchema, await deps.service.withdraw(session.player, body), 202);
  });

  return r;
}

export function createPlayersRouter(deps: { progression: ProgressionServiceImpl; roundBook: RoundBook; history: RoundHistory }): Hono {
  const r = new Hono();

  r.get('/players/:addr/profile', async (c) => {
    const addr = getAddress(parseWith(AddressString, c.req.param('addr'), 'address'));
    const profile = await deps.progression.profile(addr);
    if (!profile) throw new ApiError('VALIDATION', 'player not found', { status: 404 });
    return sendJson(c, ProfileSchema, profile);
  });

  r.get('/players/:addr/rounds', async (c) => {
    const addr = getAddress(parseWith(AddressString, c.req.param('addr'), 'address'));
    const q = readQuery(c, z.object({ cursor: UintString.optional() }));
    const before = q.cursor !== undefined ? BigInt(q.cursor) : undefined;
    const settled = await deps.history.listForPlayer(addr, { beforeRoundId: before, limit: PAGE });
    const items = [...settled];
    if (before === undefined) {
      // First page: the round in flight (if any) leads.
      const active = deps.roundBook.activeFor(addr);
      const dto = active && active.status === 'open' ? deps.roundBook.toDTO(active.roundId) : undefined;
      if (dto && !items.some((x) => x.roundId === dto.roundId)) items.unshift(dto);
    }
    const last = settled[settled.length - 1];
    return sendJson(c, RoundPageSchema, { items, nextCursor: settled.length === PAGE && last ? last.roundId : null });
  });

  r.get('/leaderboard', async (c) => {
    const q = readQuery(c, z.object({ period: z.enum(['weekly', 'all']).default('weekly') }));
    return sendJson(c, z.array(LeaderboardEntrySchema), await deps.progression.leaderboard(q.period));
  });

  return r;
}
