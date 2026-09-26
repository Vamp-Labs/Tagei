import { describe, expect, it } from 'vitest';
import { hashTypedData } from 'viem';
import { TYPE_STRINGS, arenaDomain, arenaTypes, sessionGrantTypes } from '../src/eip712.ts';

const encodeType = (name: string, fields: readonly { name: string; type: string }[]) =>
  `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(',')})`;

describe('EIP-712 type strings', () => {
  it('match the field definitions exactly', () => {
    expect(encodeType('OpenRound', arenaTypes.OpenRound)).toBe(TYPE_STRINGS.OpenRound);
    expect(encodeType('CashOut', arenaTypes.CashOut)).toBe(TYPE_STRINGS.CashOut);
    expect(encodeType('Withdraw', arenaTypes.Withdraw)).toBe(TYPE_STRINGS.Withdraw);
    expect(encodeType('SessionGrant', sessionGrantTypes.SessionGrant)).toBe(TYPE_STRINGS.SessionGrant);
  });

  it('hash deterministically with viem', () => {
    const domain = arenaDomain(97, '0x00000000000000000000000000000000000000a1');
    const message = {
      player: '0x00000000000000000000000000000000000000b2',
      assetId: 0,
      tier: 1,
      direction: 0,
      stake: 10n ** 19n,
      laneVersion: 1,
      oracleIdx: 0,
      nonce: 0n,
      deadline: 1_790_000_000,
    } as const;
    const a = hashTypedData({ domain, types: arenaTypes, primaryType: 'OpenRound', message });
    const b = hashTypedData({ domain, types: arenaTypes, primaryType: 'OpenRound', message });
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
