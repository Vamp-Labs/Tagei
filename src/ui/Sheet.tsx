import React, { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { DISMISS_OFFSET, DISMISS_VELOCITY, MICRO, STANDARD } from './motion';
import { cn } from './cn';
import { Scrim } from './lucky/Scrim';

interface SheetProps {
  onClose: () => void;
  children: React.ReactNode;
  /** Extra classes on the panel — e.g. to add a max-width on wider frames. */
  className?: string;
  /**
   * 'game' (default: Trade Setup) keeps the market track fully visible and
   * un-blurred behind the sheet — the old always-docked cockpit HUD blurred
   * only its own small glass card, never the canvas, so the game world
   * stayed vibrant through the entire play → win → play-again loop. A
   * full-screen blurred scrim on that specific path reads as "you left the
   * game," not "the HUD updated," which is the regression this fixes.
   * 'app' (Menu, Asset Selector, PIX Chat, Position Details) is a real
   * navigation destination per docs/UI_UX_SPEC.md, so it keeps the heavier,
   * more conventional dim treatment (flat canvas/60, no blur).
   */
  variant?: 'game' | 'app';
}

/**
 * The one bottom-sheet mechanic every new screen in this refactor shares —
 * Trade Setup, Menu, Asset Selector, PIX Chat, Position Details. Per
 * docs/DESIGN_TOKENS.md: rounded top corners, a visible drag handle,
 * max 85% screen height, drag down to dismiss.
 */
export const Sheet: React.FC<SheetProps> = ({
  onClose,
  children,
  className = '',
  variant = 'app',
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canDrag, setCanDrag] = useState<boolean>(true);
  const isGame = variant === 'game';

  return (
    <Scrim
      tone={isGame ? 'game' : 'dim'}
      initial={{ opacity: 0 }}
      // zIndex drops on exit so a fading sheet never blocks the HUD, and is restored on enter because a re-entering sheet reuses the exited element.
      animate={{ opacity: 1, zIndex: 40, transition: STANDARD }}
      exit={{ opacity: 0, zIndex: 10, transition: MICRO }}
      onClick={onClose}
      className="absolute inset-0 z-40 flex items-end justify-center pointer-events-auto"
    >
      <motion.div
        initial={{ y: '100%' }}
        // Opening is routine, not a dramatic beat — HERO (600-1200ms, meant
        // for a target hit or launch) made every menu and selector feel
        // sluggish. STANDARD (250-450ms) is the right tier for a panel
        // entrance per src/ui/motion.ts and the docs' own "Standard:
        // 240-400ms... bottom sheet" band.
        animate={{ y: 0, transition: STANDARD }}
        // Exit is faster still (MICRO): see the scrim's comment above — a
        // trade launch needs this sheet out of the way immediately, not
        // gracefully sliding off over ~350ms while it covers the live HUD
        // that already started underneath it.
        exit={{ y: '100%', transition: MICRO }}
        drag="y"
        dragSnapToOrigin
        dragElastic={{ top: 0, bottom: 0.4 }}
        dragConstraints={{ top: 0, bottom: 0 }}
        onPointerDownCapture={() => setCanDrag((scrollRef.current?.scrollTop ?? 0) <= 0)}
        dragListener={canDrag}
        onDragEnd={(_, info) => {
          if (info.offset.y > DISMISS_OFFSET || info.velocity.y > DISMISS_VELOCITY) onClose();
        }}
        onClick={(event) => event.stopPropagation()}
        className={cn('lg-sheet flex flex-col cursor-grab active:cursor-grabbing', className)}
        style={{ maxHeight: '85vh' }}
      >
        <div className="flex justify-center pt-3 pb-2 shrink-0">
          <span className="lg-grabber" aria-hidden="true" />
        </div>
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overscroll-contain"
          style={{ paddingBottom: 'calc(var(--sa-bottom) + 12px)' }}
        >
          {children}
        </div>
      </motion.div>
    </Scrim>
  );
};
