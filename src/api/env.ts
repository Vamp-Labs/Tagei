import { z } from 'zod';

export const FAKE_SCENARIOS = [
  'win',
  'loss',
  'timeout',
  'cashout',
  'open_failure',
  'settle_failure',
  'void',
  'resume_live',
  'resume_settling',
  'resume_result',
] as const;
export type FakeScenario = (typeof FAKE_SCENARIOS)[number];

export type RoundSource = 'api' | 'fake';

export interface AppEnv {
  apiUrl: string | null;
  wcProjectId: string | null;
  rpcUrls: readonly string[];
  roundSource: RoundSource;
  fakeScenario: FakeScenario;
  dev: boolean;
}

const optionalText = z
  .string()
  .optional()
  .catch(undefined)
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

const RawEnvSchema = z.object({
  VITE_API_URL: optionalText,
  VITE_WC_PROJECT_ID: optionalText,
  VITE_RPC_URLS: optionalText,
  VITE_ROUND_SOURCE: optionalText,
  VITE_FAKE_SCENARIO: optionalText,
  DEV: z.boolean().optional().catch(undefined),
});

const isFakeScenario = (value: string | undefined): value is FakeScenario =>
  FAKE_SCENARIOS.some((scenario) => scenario === value);

function normalizeApiUrl(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (value === '/') return '';
  return value.replace(/\/+$/, '');
}

const splitList = (value: string | undefined): readonly string[] =>
  value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : [];

export function readEnv(raw: Record<string, unknown>): AppEnv {
  const parsed = RawEnvSchema.safeParse(raw);
  const values = parsed.success ? parsed.data : RawEnvSchema.parse({});
  return {
    apiUrl: normalizeApiUrl(values.VITE_API_URL),
    wcProjectId: values.VITE_WC_PROJECT_ID ?? null,
    rpcUrls: splitList(values.VITE_RPC_URLS),
    roundSource: values.VITE_ROUND_SOURCE === 'fake' ? 'fake' : 'api',
    fakeScenario: isFakeScenario(values.VITE_FAKE_SCENARIO) ? values.VITE_FAKE_SCENARIO : 'win',
    dev: values.DEV === true,
  };
}

const importMetaEnv: Record<string, unknown> =
  (import.meta as ImportMeta & { readonly env?: Record<string, unknown> }).env ?? {};

export const env: AppEnv = readEnv(importMetaEnv);
