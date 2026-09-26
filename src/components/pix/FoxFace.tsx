import React from 'react';
import { motion } from 'motion/react';
import { MICRO, POP, STANDARD, useMotionPref } from '../../ui/motion';
import type { PositionDirection } from '../../types/game';
import type { PixExpression } from './expressions';
import { useBlink } from './useBlink';

export interface FoxFaceProps {
  expression: PixExpression;
  direction?: PositionDirection | null;
}

type EyeStyle = 'round' | 'arc' | 'caret';

interface ExpressionPose {
  earRotate: readonly [number, number];
  earLift: number;
  eyeStyle: EyeStyle;
  eyeScale: number;
  gaze: readonly [number, number];
  mouthControlY: number;
  brows: boolean;
  headTilt: number;
}

const HEAD_D =
  'M20 8.5C14.8 8.5 10.5 12.2 9.3 17.3C8.3 21.6 9.6 25.9 12.8 28.9C15.1 31 17.4 32.3 20 32.3C22.6 32.3 24.9 31 27.2 28.9C30.4 25.9 31.7 21.6 30.7 17.3C29.5 12.2 25.2 8.5 20 8.5Z';
const EAR_LEFT_OUTER = '8,15 6,8.6 17,9';
const EAR_LEFT_INNER = '9.5,13 8.5,10.4 14.5,9';
const EAR_RIGHT_OUTER = '32,15 34,8.6 23,9';
const EAR_RIGHT_INNER = '30.5,13 31.5,10.4 25.5,9';
const MOUTH_X1 = 16.5;
const MOUTH_X2 = 23.5;
const MOUTH_Y = 27;
const mouthPath = (controlY: number) => `M${MOUTH_X1} ${MOUTH_Y}Q20 ${controlY} ${MOUTH_X2} ${MOUTH_Y}`;

const POSES: Record<PixExpression, ExpressionPose> = {
  idle: { earRotate: [0, 0], earLift: 0, eyeStyle: 'round', eyeScale: 1, gaze: [0, 0], mouthControlY: 30.5, brows: false, headTilt: 0 },
  ready: { earRotate: [-6, 6], earLift: -1, eyeStyle: 'round', eyeScale: 1, gaze: [0, 0], mouthControlY: 31.5, brows: false, headTilt: 0 },
  happy: { earRotate: [-3, 3], earLift: -2, eyeStyle: 'arc', eyeScale: 1, gaze: [0, 0], mouthControlY: 34, brows: false, headTilt: 0 },
  alert: { earRotate: [-24, 24], earLift: 2, eyeStyle: 'round', eyeScale: 1.35, gaze: [0, 0], mouthControlY: 28.5, brows: false, headTilt: 0 },
  celebrate: { earRotate: [-2, -16], earLift: -2, eyeStyle: 'caret', eyeScale: 1, gaze: [0, 0], mouthControlY: 36, brows: false, headTilt: 0 },
  concerned: { earRotate: [9, -9], earLift: 4, eyeStyle: 'round', eyeScale: 1, gaze: [0, 1], mouthControlY: 23.5, brows: true, headTilt: 0 },
  loading: { earRotate: [2, -2], earLift: 1, eyeStyle: 'round', eyeScale: 0.85, gaze: [0, 1], mouthControlY: 29.5, brows: false, headTilt: 0 },
  thinking: { earRotate: [-18, 3], earLift: 0, eyeStyle: 'round', eyeScale: 1, gaze: [2, -2], mouthControlY: 29.5, brows: false, headTilt: 0 },
  wave: { earRotate: [-10, 14], earLift: -1, eyeStyle: 'round', eyeScale: 1, gaze: [0, 0], mouthControlY: 31, brows: false, headTilt: -6 },
};

const READY_GAZE_Y: Record<PositionDirection, number> = { LONG: -3, SHORT: 3 };

const Ear: React.FC<{ outer: string; inner: string; side: 'left' | 'right'; rotate: number; lift: number; reduced: boolean }> = ({
  outer,
  inner,
  side,
  rotate,
  lift,
  reduced,
}) => (
  <motion.g
    style={{ transformBox: 'fill-box', transformOrigin: side === 'left' ? '80% 100%' : '20% 100%' }}
    animate={{ rotate, y: lift }}
    transition={reduced ? { duration: 0.15 } : STANDARD}
  >
    <polygon points={outer} className="fill-amber" />
    <polygon points={inner} className="fill-ink-soft" />
  </motion.g>
);

const RoundEyes: React.FC<{ scale: number; gazeX: number; gazeY: number; blinking: boolean; reduced: boolean }> = ({
  scale,
  gazeX,
  gazeY,
  blinking,
  reduced,
}) => (
  <motion.g
    style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
    animate={{ scale, x: gazeX, y: gazeY, scaleY: blinking ? 0.08 : 1 }}
    transition={reduced ? { duration: 0.15 } : blinking ? MICRO : STANDARD}
  >
    <circle cx="15" cy="20" r="2.2" className="fill-canvas" />
    <circle cx="25" cy="20" r="2.2" className="fill-canvas" />
  </motion.g>
);

const ArcEyes: React.FC<{ gazeX: number; gazeY: number; reduced: boolean }> = ({ gazeX, gazeY, reduced }) => (
  <motion.g
    style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
    animate={{ x: gazeX, y: gazeY }}
    fill="none"
    strokeWidth={1.8}
    strokeLinecap="round"
    className="stroke-canvas"
    transition={reduced ? { duration: 0.15 } : STANDARD}
  >
    <path d="M12.3 20.5Q15 17 17.7 20.5" />
    <path d="M22.3 20.5Q25 17 27.7 20.5" />
  </motion.g>
);

const CaretEyes: React.FC<{ gazeX: number; gazeY: number; reduced: boolean }> = ({ gazeX, gazeY, reduced }) => (
  <motion.g
    style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
    animate={{ x: gazeX, y: gazeY }}
    fill="none"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="stroke-canvas"
    transition={reduced ? { duration: 0.15 } : STANDARD}
  >
    <path d="M12.5 21Q15 17.8 17.5 21" />
    <path d="M22.5 21Q25 17.8 27.5 21" />
  </motion.g>
);

const Brows: React.FC<{ visible: boolean; reduced: boolean }> = ({ visible, reduced }) => (
  <motion.g
    animate={{ opacity: visible ? 1 : 0 }}
    transition={reduced ? { duration: 0.15 } : STANDARD}
    fill="none"
    strokeWidth={1.5}
    strokeLinecap="round"
    className="stroke-ink-soft"
  >
    <path d="M12.5 16.2Q15 14.8 17.7 16.2" />
    <path d="M22.3 16.2Q25 14.8 27.5 16.2" />
  </motion.g>
);

const ThoughtDots: React.FC<{ reduced: boolean }> = ({ reduced }) => (
  <g className="fill-ink-soft">
    {[0, 1, 2].map((i) => (
      <motion.circle
        key={i}
        cx={27 + i * 3.4}
        cy={7.5 - i * 1.6}
        r="1.3"
        animate={reduced ? { opacity: 0.55 + i * 0.15 } : { opacity: [0.3, 1, 0.3] }}
        transition={reduced ? { duration: 0 } : { duration: 1.2, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
      />
    ))}
  </g>
);

const OrbitDot: React.FC<{ reduced: boolean }> = ({ reduced }) => (
  <motion.g
    style={{ transformBox: 'view-box', transformOrigin: '20px 20px' }}
    animate={reduced ? { rotate: 0 } : { rotate: 360 }}
    transition={reduced ? { duration: 0 } : { duration: 2.2, repeat: Infinity, ease: 'linear' }}
  >
    <circle cx="30" cy="20" r="1.6" className="fill-ink-soft" />
  </motion.g>
);

const SPARKLE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [7.5, 11],
  [33.5, 10],
  [20, 3.5],
];

const Sparkles: React.FC<{ reduced: boolean }> = ({ reduced }) => (
  <g className="fill-lucky">
    {SPARKLE_POINTS.map(([cx, cy], i) => (
      <motion.g
        key={i}
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        initial={reduced ? false : { opacity: 0, scale: 0.3 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={reduced ? { duration: 0 } : { ...POP, delay: i * 0.06 }}
      >
        <path
          d={`M${cx} ${cy - 1.6}L${cx + 0.5} ${cy - 0.5}L${cx + 1.6} ${cy}L${cx + 0.5} ${cy + 0.5}L${cx} ${cy + 1.6}L${cx - 0.5} ${cy + 0.5}L${cx - 1.6} ${cy}L${cx - 0.5} ${cy - 0.5}Z`}
        />
      </motion.g>
    ))}
  </g>
);

const HalfLids: React.FC = () => (
  <g className="fill-ink-soft">
    <path d="M12.8 19.2Q15 17.6 17.2 19.2Q15 19.5 12.8 19.2Z" />
    <path d="M22.8 19.2Q25 17.6 27.2 19.2Q25 19.5 22.8 19.2Z" />
  </g>
);

export const FoxFace: React.FC<FoxFaceProps> = ({ expression, direction }) => {
  const reduced = useMotionPref();
  const blinking = useBlink(!reduced && expression !== 'thinking' && expression !== 'wave');
  const pose = POSES[expression];

  const gazeY = expression === 'ready' && direction ? READY_GAZE_Y[direction] : pose.gaze[1];
  const isIdleLook = expression === 'idle' && !reduced;

  return (
    <svg viewBox="0 0 40 40" width="100%" height="100%" fill="none" aria-hidden="true">
      <motion.g
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        animate={{ rotate: pose.headTilt }}
        transition={reduced ? { duration: 0.15 } : STANDARD}
      >
        <Ear outer={EAR_LEFT_OUTER} inner={EAR_LEFT_INNER} side="left" rotate={pose.earRotate[0]} lift={pose.earLift} reduced={reduced} />
        <Ear
          outer={EAR_RIGHT_OUTER}
          inner={EAR_RIGHT_INNER}
          side="right"
          rotate={pose.earRotate[1]}
          lift={pose.earLift}
          reduced={reduced}
        />
        <path d={HEAD_D} className="fill-amber" />
        <ellipse cx="20" cy="25" rx="7.2" ry="6.2" className="fill-ink-soft" />
        <circle cx="11" cy="24" r="2.6" className="fill-ink-soft" />
        <circle cx="29" cy="24" r="2.6" className="fill-ink-soft" />

        <motion.g animate={{ x: pose.gaze[0], y: isIdleLook ? 0 : gazeY }} transition={reduced ? { duration: 0.15 } : STANDARD}>
          <motion.g
            animate={isIdleLook ? { x: [-1.4, 1.4, -1.4] } : { x: 0 }}
            transition={isIdleLook ? { duration: 6.4, repeat: Infinity, ease: 'easeInOut' } : { duration: 0 }}
          >
            {pose.eyeStyle === 'round' && (
              <RoundEyes scale={pose.eyeScale} gazeX={0} gazeY={0} blinking={blinking} reduced={reduced} />
            )}
            {pose.eyeStyle === 'arc' && <ArcEyes gazeX={0} gazeY={0} reduced={reduced} />}
            {pose.eyeStyle === 'caret' && <CaretEyes gazeX={0} gazeY={0} reduced={reduced} />}
            {expression === 'loading' && <HalfLids />}
          </motion.g>
        </motion.g>

        <circle cx="20" cy="23" r="1.15" className="fill-canvas" />
        <Brows visible={pose.brows} reduced={reduced} />
        <motion.path
          className="stroke-canvas"
          fill="none"
          strokeWidth={1.6}
          strokeLinecap="round"
          initial={false}
          animate={{ d: mouthPath(pose.mouthControlY) }}
          transition={reduced ? { duration: 0.15 } : STANDARD}
        />
      </motion.g>

      {expression === 'loading' && <OrbitDot reduced={reduced} />}
      {expression === 'thinking' && <ThoughtDots reduced={reduced} />}
      {expression === 'celebrate' && <Sparkles reduced={reduced} />}
    </svg>
  );
};
