import { useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion, type Transition } from 'motion/react';
import { EASE_OUT, MICRO, POP, STANDARD } from '../../../ui/motion';
import { Icon, type IconName } from '../../../ui/lucky';
import { cn } from '../../../ui/cn';
import { doneCount, statusAt, stepDescription, type ChainPhase, type ChainStep, type ChainStepStatus } from './steps';

const RING_SIZE = 136;
const RING_STROKE = 8;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CENTER = RING_SIZE / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const ARC_GAP_PX = 7;
const ACTIVE_FILL = 0.6;
const COORD_DECIMALS = 3;

const SWEEP_SPAN = 0.32;
const SWEEP_DELAY_MS = 600;
const SHIMMER_PERIOD_MS = 1600;
const RETRY_PERIOD_MS = 2800;
const SWEEP_FADE_AT = 0.2;

const PAYOFF_ARC_SECONDS = 0.14;
const PAYOFF_ARC_STAGGER = 0.025;
const PAYOFF_GLOW_FROM = 0.5;
const PAYOFF_GLOW_TO = 1.14;
const PAYOFF_GLOW_SECONDS = 0.44;
const PAYOFF_GLOW_HOLD = 0.35;

const GLYPH_SIZE = 30;
const GLYPH_STROKE = 2.4;
const GLYPH_STROKE_CONFIRMED = 3;
const GLYPH_ENTER_SCALE = 0.6;
const GLYPH_ENTER_ROTATE = -20;
const GLYPH_POP_FROM = 0.4;
const TILE_POP_FROM = 0.72;
const TILE_EXIT_SCALE = 0.9;

type TileTone = 'gold' | 'lucky' | 'loss';

const TILE_CLASS: Record<TileTone, string> = {
  gold: 'bg-gold shadow-glow-gold',
  lucky: 'bg-lucky-bar',
  loss: 'bg-well ring-2 ring-inset ring-control-ring',
};

const GLYPH_CLASS: Record<TileTone, string> = {
  gold: 'text-on-gold',
  lucky: 'text-on-lucky',
  loss: 'text-loss',
};

const INSTANT: Transition = { duration: 0 };

interface ArcGeometry {
  d: string;
  length: number;
}

const coord = (value: number) => value.toFixed(COORD_DECIMALS);

function arcGeometry(index: number, count: number): ArcGeometry {
  const span = (2 * Math.PI) / count;
  const gap = (ARC_GAP_PX + RING_STROKE) / RING_RADIUS;
  const start = -Math.PI / 2 + index * span + gap / 2;
  const sweep = span - gap;
  const end = start + sweep;
  const x0 = RING_CENTER + RING_RADIUS * Math.cos(start);
  const y0 = RING_CENTER + RING_RADIUS * Math.sin(start);
  const x1 = RING_CENTER + RING_RADIUS * Math.cos(end);
  const y1 = RING_CENTER + RING_RADIUS * Math.sin(end);
  const largeArc = sweep > Math.PI ? 1 : 0;
  return {
    d: `M ${coord(x0)} ${coord(y0)} A ${RING_RADIUS} ${RING_RADIUS} 0 ${largeArc} 1 ${coord(x1)} ${coord(y1)}`,
    length: RING_RADIUS * sweep,
  };
}

const hiddenOffset = (length: number) => length + RING_STROKE;
const offsetFor = (length: number, fill: number) => (fill <= 0 ? hiddenOffset(length) : length * (1 - fill));

const goldFill = (status: ChainStepStatus) => (status === 'done' ? 1 : status === 'pending' ? 0 : ACTIVE_FILL);

const strokeProps = {
  fill: 'none',
  strokeWidth: RING_STROKE,
  strokeLinecap: 'round',
} as const;

interface SweepArcProps {
  geometry: ArcGeometry;
  tone: 'shimmer' | 'retry';
}

function SweepArc({ geometry, tone }: SweepArcProps) {
  const ref = useRef<SVGPathElement>(null);
  const { d, length } = geometry;
  const dash = length * SWEEP_SPAN;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') return undefined;
    const from = dash + RING_STROKE;
    const to = -(length + RING_STROKE);
    const at = (t: number) => `${from + (to - from) * t}px`;
    const animation = el.animate(
      [
        { strokeDashoffset: at(0), opacity: 0 },
        { strokeDashoffset: at(SWEEP_FADE_AT), opacity: 1, offset: SWEEP_FADE_AT },
        { strokeDashoffset: at(1 - SWEEP_FADE_AT), opacity: 1, offset: 1 - SWEEP_FADE_AT },
        { strokeDashoffset: at(1), opacity: 0 },
      ],
      {
        duration: tone === 'retry' ? RETRY_PERIOD_MS : SHIMMER_PERIOD_MS,
        delay: SWEEP_DELAY_MS,
        iterations: Infinity,
        easing: 'linear',
        fill: 'backwards',
      },
    );
    return () => animation.cancel();
  }, [dash, length, tone]);

  return (
    <path
      ref={ref}
      d={d}
      {...strokeProps}
      strokeDasharray={`${dash} ${RING_CIRCUMFERENCE}`}
      strokeDashoffset={dash + RING_STROKE}
      opacity={0}
      className={tone === 'retry' ? 'stroke-ink/20' : 'stroke-ink/40'}
    />
  );
}

interface ArcProps {
  geometry: ArcGeometry;
  index: number;
  status: ChainStepStatus;
  phase: ChainPhase;
  reduced: boolean;
}

function Arc({ geometry, index, status, phase, reduced }: ArcProps) {
  const { d, length } = geometry;
  const dashArray = `${length} ${RING_CIRCUMFERENCE}`;
  const confirmed = phase === 'confirmed';
  const failed = status === 'failed';

  const luckyTransition: Transition = reduced
    ? { strokeDashoffset: INSTANT, opacity: MICRO }
    : { duration: PAYOFF_ARC_SECONDS, delay: index * PAYOFF_ARC_STAGGER, ease: EASE_OUT };

  return (
    <g>
      <path d={d} {...strokeProps} className="stroke-well" />
      <motion.path
        d={d}
        {...strokeProps}
        strokeDasharray={dashArray}
        className="stroke-gold"
        initial={reduced ? false : { strokeDashoffset: hiddenOffset(length) }}
        animate={{ strokeDashoffset: offsetFor(length, goldFill(status)) }}
        transition={reduced ? INSTANT : STANDARD}
      />
      <motion.path
        d={d}
        {...strokeProps}
        strokeDasharray={dashArray}
        strokeDashoffset={offsetFor(length, ACTIVE_FILL)}
        className="stroke-loss"
        initial={false}
        animate={{ opacity: failed ? 1 : 0 }}
        transition={reduced ? INSTANT : STANDARD}
      />
      <motion.path
        d={d}
        {...strokeProps}
        strokeDasharray={dashArray}
        className="stroke-lucky-bar"
        initial={{ strokeDashoffset: hiddenOffset(length), opacity: reduced ? 0 : 1 }}
        animate={{
          strokeDashoffset: confirmed || reduced ? 0 : hiddenOffset(length),
          opacity: confirmed || !reduced ? 1 : 0,
        }}
        transition={luckyTransition}
      />
      {!reduced && (status === 'active' || failed) && (
        <SweepArc key={status} geometry={geometry} tone={failed ? 'retry' : 'shimmer'} />
      )}
    </g>
  );
}

export interface ChainRingProps {
  steps: readonly ChainStep[];
  activeIndex: number;
  phase: ChainPhase;
  reduced: boolean;
}

export function ChainRing({ steps, activeIndex, phase, reduced }: ChainRingProps) {
  const count = steps.length;
  const geometries = useMemo(() => Array.from({ length: count }, (_, i) => arcGeometry(i, count)), [count]);
  const confirmed = phase === 'confirmed';
  const tone: TileTone = confirmed ? 'lucky' : phase === 'failed' ? 'loss' : 'gold';
  const glyph: IconName = confirmed ? 'check' : phase === 'failed' ? 'close' : (steps[Math.min(activeIndex, count - 1)]?.glyph ?? 'bolt');

  const tileEnter = reduced ? { opacity: 0 } : { opacity: 0, scale: tone === 'lucky' ? TILE_POP_FROM : 1 };
  const glyphEnter = reduced
    ? { opacity: 0 }
    : confirmed
      ? { opacity: 0, scale: GLYPH_POP_FROM, rotate: 0 }
      : { opacity: 0, scale: GLYPH_ENTER_SCALE, rotate: GLYPH_ENTER_ROTATE };
  const popIn = confirmed && !reduced ? POP : STANDARD;

  return (
    <div
      role="progressbar"
      aria-label="Settlement progress"
      aria-valuemin={0}
      aria-valuemax={count}
      aria-valuenow={doneCount(activeIndex, count, phase)}
      aria-valuetext={stepDescription(steps, activeIndex, phase)}
      className="relative"
      style={{ width: RING_SIZE, height: RING_SIZE }}
    >
      {confirmed && !reduced && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full shadow-glow-lucky"
          initial={{ opacity: 1, scale: PAYOFF_GLOW_FROM }}
          animate={{ opacity: [1, 1, 0], scale: PAYOFF_GLOW_TO }}
          transition={{
            scale: { duration: PAYOFF_GLOW_SECONDS, ease: EASE_OUT },
            opacity: { duration: PAYOFF_GLOW_SECONDS, times: [0, PAYOFF_GLOW_HOLD, 1] },
          }}
        />
      )}
      <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true">
        {geometries.map((geometry, index) => (
          <Arc
            key={index}
            geometry={geometry}
            index={index}
            status={statusAt(index, activeIndex, phase)}
            phase={phase}
            reduced={reduced}
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
        <div className="relative size-16">
          <AnimatePresence initial={false}>
            <motion.div
              key={tone}
              className={cn('absolute inset-0 rounded-md', TILE_CLASS[tone])}
              initial={tileEnter}
              animate={{ opacity: 1, scale: 1, transition: popIn }}
              exit={{ opacity: 0, scale: reduced ? 1 : TILE_EXIT_SCALE, transition: MICRO }}
            />
          </AnimatePresence>
          <AnimatePresence initial={false}>
            <motion.span
              key={glyph}
              className={cn('absolute inset-0 flex items-center justify-center', GLYPH_CLASS[tone])}
              initial={glyphEnter}
              animate={{ opacity: 1, scale: 1, rotate: 0, transition: popIn }}
              exit={{ opacity: 0, scale: reduced ? 1 : GLYPH_ENTER_SCALE, transition: MICRO }}
            >
              <Icon name={glyph} size={GLYPH_SIZE} strokeWidth={confirmed ? GLYPH_STROKE_CONFIRMED : GLYPH_STROKE} />
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
