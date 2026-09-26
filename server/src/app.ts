import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ReadinessCheck } from './ports.ts';

export interface AppDeps {
  version: string;
  corsOrigins: string[];
  checks: ReadinessCheck[];
  /** Module routers mounted under /v1 (auth, rounds, market, pix, …). */
  routers?: { path: string; router: Hono }[];
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.use('/v1/*', cors({ origin: deps.corsOrigins, allowHeaders: ['Content-Type', 'Authorization', 'Last-Event-ID'] }));

  app.get('/healthz', (c) => c.json({ ok: true, version: deps.version }));

  app.get('/readyz', async (c) => {
    const results = await Promise.all(
      deps.checks.map(async (chk) => {
        try {
          return { name: chk.name, ...(await chk.check()) };
        } catch (err) {
          return { name: chk.name, ok: false, detail: String(err) };
        }
      }),
    );
    const ok = results.every((r) => r.ok);
    return c.json({ ok, checks: results }, ok ? 200 : 503);
  });

  for (const { path, router } of deps.routers ?? []) app.route(`/v1${path}`, router);

  app.notFound((c) => c.json({ error: { code: 'VALIDATION', message: 'not found' } }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: { code: 'INTERNAL', message: 'internal error' } }, 500);
  });

  return app;
}
