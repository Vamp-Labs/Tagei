import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';

describe('app', () => {
  it('serves /healthz', async () => {
    const app = createApp({ version: 'test', corsOrigins: [], checks: [] });
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: 'test' });
  });

  it('reports readiness failures with 503', async () => {
    const app = createApp({ version: 'test', corsOrigins: [], checks: [{ name: 'db', check: async () => ({ ok: false }) }] });
    const res = await app.request('/readyz');
    expect(res.status).toBe(503);
  });
});

describe('config', () => {
  it('applies testnet defaults', () => {
    const cfg = loadConfig({ NODE_ENV: 'test' });
    expect(cfg.CHAIN_ID).toBe(97);
    expect(cfg.SUPRA_POLL_MS).toBe(200);
    expect(cfg.RPC_HTTP_URLS.length).toBeGreaterThan(0);
  });

  it('refuses the dev JWT secret in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET/);
  });
});
