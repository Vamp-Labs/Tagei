import { motion, type Transition } from 'motion/react';
import { EASE_OUT, MICRO } from '../../../ui/motion';
import { Icon } from '../../../ui/lucky';
import { cn } from '../../../ui/cn';
import { statusAt, type ChainPhase, type ChainStep, type ChainStepStatus } from './steps';

const PIECE_SECONDS = 0.18;
const PIECE_STAGGER = 0.06;
const CHECK_SIZE = 12;
const CHECK_STROKE = 3.2;
const NODE_POP_FROM = 0.5;

const FILL_CLASS =
  'absolute inset-0 origin-left bg-lucky-bar bg-[image:repeating-linear-gradient(135deg,color-mix(in_srgb,var(--color-ink)_14%,transparent)_0_4px,transparent_4px_8px)]';

const LABEL_CLASS: Record<ChainStepStatus, string> = {
  pending: 'text-ink-muted',
  active: 'text-ink',
  failed: 'text-ink',
  done: 'text-lucky',
};

const STATUS_TEXT: Record<ChainStepStatus, string> = {
  pending: 'pending',
  active: 'in progress',
  failed: 'not confirmed',
  done: 'done',
};

interface LineProps {
  filled: boolean;
  order: number;
  reduced: boolean;
  className?: string;
}

function Line({ filled, order, reduced, className }: LineProps) {
  const transition: Transition = reduced
    ? MICRO
    : { duration: PIECE_SECONDS, ease: EASE_OUT, delay: filled ? order * PIECE_STAGGER : 0 };
  return (
    <span aria-hidden="true" className={cn('relative h-1 min-w-1 flex-1 overflow-hidden bg-well', className)}>
      <motion.span
        className={FILL_CLASS}
        initial={false}
        animate={reduced ? { scaleX: 1, opacity: filled ? 1 : 0 } : { scaleX: filled ? 1 : 0, opacity: 1 }}
        transition={transition}
      />
    </span>
  );
}

function Node({ status, reduced }: { status: ChainStepStatus; reduced: boolean }) {
  const done = status === 'done';
  return (
    <span aria-hidden="true" className="relative size-4 shrink-0 rounded-full bg-well ring-2 ring-inset ring-control-ring">
      <motion.span
        className="absolute inset-0 flex items-center justify-center rounded-full bg-well ring-2 ring-inset ring-ink"
        initial={false}
        animate={{ opacity: status === 'active' ? 1 : 0 }}
        transition={MICRO}
      >
        <span className="size-1.5 rounded-full bg-ink" />
      </motion.span>
      <motion.span
        className="absolute inset-0 flex items-center justify-center rounded-full bg-well ring-2 ring-inset ring-loss"
        initial={false}
        animate={{ opacity: status === 'failed' ? 1 : 0 }}
        transition={MICRO}
      >
        <span className="size-1.5 rounded-full bg-loss" />
      </motion.span>
      <motion.span
        className="absolute inset-0 flex items-center justify-center rounded-full bg-lucky-bar text-on-lucky"
        initial={false}
        animate={{ opacity: done ? 1 : 0, scale: done || reduced ? 1 : NODE_POP_FROM }}
        transition={MICRO}
      >
        <Icon name="check" size={CHECK_SIZE} strokeWidth={CHECK_STROKE} />
      </motion.span>
    </span>
  );
}

export interface ChainStepperProps {
  steps: readonly ChainStep[];
  activeIndex: number;
  phase: ChainPhase;
  reduced: boolean;
}

export function ChainStepper({ steps, activeIndex, phase, reduced }: ChainStepperProps) {
  const last = steps.length - 1;
  const segmentFilled = (index: number) => index >= 0 && index < last && statusAt(index, activeIndex, phase) === 'done';

  return (
    <ol aria-label="Settlement steps" className="flex w-full items-start">
      {steps.map((step, index) => {
        const status = statusAt(index, activeIndex, phase);
        return (
          <li
            key={step.id}
            aria-current={status === 'active' || status === 'failed' ? 'step' : undefined}
            className={cn('flex items-start', index > 0 && 'flex-auto')}
          >
            {index > 0 && <Line filled={segmentFilled(index - 1)} order={1} reduced={reduced} className="mt-1.5" />}
            <span className="flex flex-col items-center">
              <span className="flex w-full items-center">
                <Line filled={segmentFilled(index - 1)} order={2} reduced={reduced} className={cn(index === 0 && 'invisible')} />
                <Node status={status} reduced={reduced} />
                <Line filled={segmentFilled(index)} order={0} reduced={reduced} className={cn(index === last && 'invisible')} />
              </span>
              <span
                className={cn(
                  'mt-2 whitespace-nowrap text-micro font-bold uppercase tracking-[0.04em]',
                  LABEL_CLASS[status],
                )}
              >
                {step.label}
                <span className="sr-only">, {STATUS_TEXT[status]}</span>
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
