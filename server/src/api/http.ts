// Request parsing and response validation. Every JSON response goes through
// `sendJson`, which validates it against the shared zod schema before sending.

import type { Context } from 'hono';
import type { z } from 'zod';
import { ApiError } from './errors.ts';

const issueText = (err: z.ZodError): string =>
  err.issues
    .slice(0, 3)
    .map((i) => `${i.path.length ? `${i.path.join('.')}: ` : ''}${i.message}`)
    .join('; ');

export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError('VALIDATION', 'request body must be JSON');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError('VALIDATION', issueText(parsed.error));
  return parsed.data;
}

export function readQuery<S extends z.ZodType>(c: Context, schema: S): z.infer<S> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw new ApiError('VALIDATION', issueText(parsed.error));
  return parsed.data;
}

export function parseWith<S extends z.ZodType>(schema: S, value: unknown, what: string): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError('VALIDATION', `${what}: ${issueText(parsed.error)}`);
  return parsed.data;
}

/** Validates `data` against the response schema; a mismatch is a server bug, reported as INTERNAL. */
export function sendJson<S extends z.ZodType>(c: Context, schema: S, data: z.input<S>, status = 200): Response {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error(`response does not match schema: ${issueText(parsed.error)}`);
  return c.json(parsed.data as object, status as 200);
}
