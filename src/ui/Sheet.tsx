import React, { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { MICRO, STANDARD } from './motion';

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
   * more conventional dim-and-blur modal treatment.
   */
  variant?: 'game' | 'app';
}

/**
 * The one bottom-sheet mechanic every new screen in this refactor shares —
 * Trade Setup, Menu, Asset Selector, PIX Chat, Position Details. Per
 * docs/DESIGN_TOKENS.md: rounded top corners, a visible drag handle,
 * background blur, max 85% screen height, drag down to dismiss.
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
    <motion.div
      initial={{ opacity: 0 }}
      // zIndex drops on exit so a fading sheet never blocks the HUD, and is restored on enter because a re-entering sheet reuses the exited element.
      animate={{ opacity: 1, zIndex: 40, transition: STANDARD }}
      exit={{ opacity: 0, zIndex: 10, transition: MICRO }}
      onClick={onClose}
      className={`absolute inset-0 z-40 flex items-end justify-center px-3 pointer-events-auto ${
        isGame ? '' : 'bg-black/50 backdrop-blur-sm'
      }`}
      style={{
        paddingBottom: 'calc(var(--sa-bottom) + 0.75rem)',
        // Same light, non-blurring vignette ResultPanel already uses for the
        // same reason (§24/§26: the game world stays visible) — enough
        // contrast to read the sheet, none of the "modal took over" weight.
        background: isGame
          ? 'radial-gradient(130% 78% at 50% 108%, rgba(5,8,20,0.55) 0%, rgba(5,8,20,0.28) 45%, rgba(5,8,20,0) 80%)'
          : undefined,
      }}
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
          if (info.offset.y > 120 || info.velocity.y > 500) onClose();
        }}
        onClick={(event) => event.stopPropagation()}
        className={`w-full max-w-sm rounded-t-[var(--radius-xl)] border border-[color:var(--color-line)] bg-[color:var(--color-panel)] backdrop-blur-2xl shadow-2xl flex flex-col cursor-grab active:cursor-grabbing ${className}`}
        style={{ maxHeight: '85vh' }}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <span className="h-1 w-10 rounded-full bg-white/25" />
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </motion.div>
    </motion.div>
  );
};
