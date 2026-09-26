// Post-filters for LLM copy: the shared guardrail patterns, the COPY_LIMITS, and a
// numbers check (every figure in the copy must come from the computed facts). Any
// failure sends the caller back to the templates.

import { COPY_LIMITS, guardrailViolations } from '@bnbplay/shared/pix';

const NUMBER_RE = /\d+(?:[.,]\d+)*/g;
/** Small figures that are part of the game's vocabulary ("1m", "5m", "24h", "30s"). */
const ALWAYS_OK = new Set(['1', '2', '3', '5', '15', '24', '30', '60']);

const normalizeNumber = (tok: string): string => {
  const n = Number(tok.replace(/,/g, ''));
  return Number.isFinite(n) ? String(n) : tok;
};

/** Numbers mentioned in `facts` (strings, factor values …) that the copy may repeat. */
export function allowedNumbers(facts: readonly string[]): Set<string> {
  const out = new Set(ALWAYS_OK);
  for (const f of facts) for (const m of f.matchAll(NUMBER_RE)) out.add(normalizeNumber(m[0]));
  return out;
}

export function unverifiedNumbers(text: string, allowed: ReadonlySet<string>): string[] {
  return [...text.matchAll(NUMBER_RE)].map((m) => normalizeNumber(m[0])).filter((n) => !allowed.has(n));
}

export const wordCount = (s: string): number => s.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

export const sentenceCount = (s: string): number => s.split(/(?<=[.!?])\s+/).filter((x) => x.trim().length > 0).length;

export interface CopyCheck {
  ok: boolean;
  problems: string[];
}

/** Checks one LLM answer. `prose` fields are limited to COPY_LIMITS.summarySentences sentences. */
export function checkCopy(fields: { headline: string; prose: string[]; tip: string }, allowed: ReadonlySet<string>): CopyCheck {
  const problems: string[] = [];
  const all = [fields.headline, ...fields.prose, fields.tip];
  for (const t of all) {
    if (t.trim().length === 0) problems.push('empty field');
    problems.push(...guardrailViolations(t).map((v) => `guardrail:${v}`));
    problems.push(...unverifiedNumbers(t, allowed).map((n) => `number:${n}`));
    if (t.length > 320) problems.push('too long');
  }
  if (wordCount(fields.headline) > COPY_LIMITS.headlineWords) problems.push('headline too long');
  for (const p of fields.prose) if (sentenceCount(p) > COPY_LIMITS.summarySentences) problems.push('too many sentences');
  if (sentenceCount(fields.tip) > 2) problems.push('tip too long');
  return { ok: problems.length === 0, problems };
}

/**
 * Streaming sentence gate: buffers deltas and releases whole sentences only after
 * they pass the guardrails. `push` returns released sentences, or `blocked` once a
 * sentence fails (the caller stops the stream).
 */
export class SentenceGate {
  private buf = '';
  blocked = false;

  push(delta: string): { sentences: string[]; blocked: boolean } {
    if (this.blocked) return { sentences: [], blocked: true };
    this.buf += delta;
    const out: string[] = [];
    for (;;) {
      const m = /[.!?…](?=\s)|\n/.exec(this.buf);
      if (!m) break;
      const end = m.index + m[0].length;
      const sentence = this.buf.slice(0, end).trim();
      this.buf = this.buf.slice(end);
      if (!sentence) continue;
      if (guardrailViolations(sentence).length > 0) {
        this.blocked = true;
        return { sentences: out, blocked: true };
      }
      out.push(sentence);
    }
    return { sentences: out, blocked: false };
  }

  /** Releases whatever is left at the end of the stream (also gated). */
  flush(): { sentences: string[]; blocked: boolean } {
    if (this.blocked) return { sentences: [], blocked: true };
    const rest = this.buf.trim();
    this.buf = '';
    if (!rest) return { sentences: [], blocked: false };
    if (guardrailViolations(rest).length > 0) {
      this.blocked = true;
      return { sentences: [], blocked: true };
    }
    return { sentences: [rest], blocked: false };
  }
}
