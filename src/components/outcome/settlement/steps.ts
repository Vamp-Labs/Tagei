import type { SettlementStep } from '../../../services/web3Service';
import type { IconName } from '../../../ui/lucky';

export type SettlementVariant = 'live' | 'practice';

export type ChainPhase = 'running' | 'confirmed' | 'failed';

export type ChainStepStatus = 'done' | 'active' | 'pending' | 'failed';

export interface ChainStep {
  id: 'prepare' | 'sign' | 'broadcast' | 'confirm';
  label: string;
  verb: string;
  glyph: IconName;
}

const PREPARE: ChainStep = { id: 'prepare', label: 'PREPARE', verb: 'preparing', glyph: 'bolt' };
const SIGN: ChainStep = { id: 'sign', label: 'SIGN', verb: 'signing', glyph: 'key' };
const BROADCAST: ChainStep = { id: 'broadcast', label: 'BROADCAST', verb: 'broadcasting', glyph: 'broadcast' };
const CONFIRM: ChainStep = { id: 'confirm', label: 'CONFIRM', verb: 'confirming', glyph: 'check' };

export const LIVE_STEPS: readonly ChainStep[] = [PREPARE, SIGN, BROADCAST, CONFIRM];
export const PRACTICE_STEPS: readonly ChainStep[] = [PREPARE, BROADCAST, CONFIRM];

export const stepsFor = (variant: SettlementVariant): readonly ChainStep[] =>
  variant === 'practice' ? PRACTICE_STEPS : LIVE_STEPS;

const BROADCAST_INDEX: Record<SettlementVariant, number> = { live: 2, practice: 1 };

export function runningIndex(step: SettlementStep, variant: SettlementVariant): number | null {
  switch (step) {
    case 'idle':
    case 'preparing':
      return 0;
    case 'signing':
      return variant === 'practice' ? 0 : 1;
    case 'submitted':
      return BROADCAST_INDEX[variant];
    case 'confirmed':
      return stepsFor(variant).length - 1;
    case 'failed':
      return null;
  }
}

export const failedFallbackIndex = (variant: SettlementVariant): number => BROADCAST_INDEX[variant];

export const phaseOf = (step: SettlementStep): ChainPhase =>
  step === 'confirmed' ? 'confirmed' : step === 'failed' ? 'failed' : 'running';

export function statusAt(index: number, activeIndex: number, phase: ChainPhase): ChainStepStatus {
  if (phase === 'confirmed' || index < activeIndex) return 'done';
  if (index > activeIndex) return 'pending';
  return phase === 'failed' ? 'failed' : 'active';
}

export const doneCount = (activeIndex: number, total: number, phase: ChainPhase): number =>
  phase === 'confirmed' ? total : Math.min(activeIndex, total);

export function stepDescription(steps: readonly ChainStep[], activeIndex: number, phase: ChainPhase): string {
  const total = steps.length;
  if (phase === 'confirmed') return `Step ${total} of ${total}, confirmed`;
  const index = Math.min(activeIndex, total - 1);
  const step = steps[index] ?? PREPARE;
  if (phase === 'failed') return `Step ${index + 1} of ${total}, ${step.id} not confirmed, retrying`;
  return `Step ${index + 1} of ${total}, ${step.verb}`;
}
