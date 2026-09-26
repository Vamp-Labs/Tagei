import React, { useEffect, useRef, useState } from 'react';
import { marketFeed } from '../services/marketFeed';
import { MarketTrackRenderer } from './renderer';
import { RocketAvatar } from './rocket';
import { ParticleSystem } from './particles';
import { ActiveTradeRound, GameStage, LastRoundSummary, PositionDirection } from '../types/game';
import { AssetSymbol } from '../types/market';
import { soundEngine } from '../services/audioHaptics';

interface MarketTrackCanvasProps {
  gameStage: GameStage;
  activeRound: ActiveTradeRound | null;
  selectedDirection: PositionDirection | null;
  lastRound: LastRoundSummary | null;
  targetProgressPct: number;
  currentAsset?: AssetSymbol;
  reducedMotion?: boolean;
  onWarpTrigger?: (triggerFn: () => void) => void;
  /** Bumped by App.tsx each time a Hold to Cash Out commits — a one-shot
   * signal, same idea as onWarpTrigger, since the canvas has no other way
   * to distinguish a cash-out's LIVE_TRADE→SETTLING jump from a timeout's. */
  cashOutSignal?: number;
}

export const MarketTrackCanvas: React.FC<MarketTrackCanvasProps> = ({
  gameStage,
  activeRound,
  selectedDirection,
  lastRound,
  targetProgressPct,
  currentAsset = 'BNB',
  reducedMotion = false,
  onWarpTrigger,
  cashOutSignal = 0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const rendererRef = useRef<MarketTrackRenderer>(new MarketTrackRenderer());
  const rocketRef = useRef<RocketAvatar>(new RocketAvatar());
  const particlesRef = useRef<ParticleSystem>(new ParticleSystem());
  const shakeMagnitudeRef = useRef<number>(0);
  // Two beats of the same TARGET_HIT impact, sharing a trigger moment but
  // decaying at different rates: punchRef is the fast hit-stop camera kick,
  // boomRef is the slower background surge (and also drives the existing
  // rocket-centered victory flash, so the near-field and far-field reaction
  // stay in sync instead of drifting apart).
  const punchRef = useRef<number>(0);
  const boomRef = useRef<number>(0);
  // Rocket-following live P&L number — a small persistent label redrawn
  // every frame at the rocket's position (see render loop, after
  // rocket.render). alphaRef fades it in/out with LIVE_TRADE the same
  // lerp idiom the rocket's own movement uses; popRef spikes and decays
  // on a meaningful P&L tick, same idiom as punchRef/boomRef above.
  const pnlTrackerAlphaRef = useRef<number>(0);
  const pnlTrackerPopRef = useRef<number>(0);
  const prevTrackerPnlRef = useRef<number>(0);
  const lastPnlTierRef = useRef<number>(0);
  const lastDangerAlertRef = useRef<number>(0);
  const lastSurgeCueRef = useRef<number>(0);
  const lastHandledStageRef = useRef<GameStage | null>(null);
  const dprRef = useRef<number>(1);

  const [, setTickCount] = useState<number>(0);

  // Listen to live market price ticks
  useEffect(() => {
    const unsub = marketFeed.subscribe((_) => {
      setTickCount((c) => c + 1);
    });
    return () => unsub();
  }, []);

  // Expose warp effect trigger (e.g. for asset switching)
  useEffect(() => {
    if (onWarpTrigger) {
      onWarpTrigger(() => {
        const canvas = canvasRef.current;
        if (canvas) {
          particlesRef.current.triggerWarpStreaks(canvas.width, canvas.height);
          shakeMagnitudeRef.current = 4;
        }
      });
    }
  }, [onWarpTrigger]);

  // Cash-out's own, smaller payoff beat — see cashOutSignal's doc comment.
  // Skips the initial mount (signal starts at 0 in App.tsx) so this only
  // fires on a genuine commit, never on first render.
  const hasMountedCashOutRef = useRef(false);
  useEffect(() => {
    if (!hasMountedCashOutRef.current) {
      hasMountedCashOutRef.current = true;
      return;
    }
    const rocket = rocketRef.current;
    particlesRef.current.emitCashOutSparkle(rocket.x, rocket.y + rocket.hoverOffset);
  }, [cashOutSignal]);

  // Handle stage-specific rocket states and tactile impact effects
  useEffect(() => {
    const rocket = rocketRef.current;
    const particles = particlesRef.current;

    rocket.isTargetHit = gameStage === 'TARGET_HIT';
    rocket.isDrifting = gameStage === 'LOSS_HIT';
    rocket.engineActive = gameStage === 'LIVE_TRADE' || gameStage === 'TARGET_HIT';

    if (lastHandledStageRef.current !== gameStage) {
      lastHandledStageRef.current = gameStage;

      if (gameStage === 'TARGET_HIT') {
        shakeMagnitudeRef.current = 14; // Punchy victory camera screen shake
        punchRef.current = 1; // Fast hit-stop punch-zoom (PRD §20 Frame 1: Impact)
        boomRef.current = 1; // Slow background surge + victory flash (Frames 2-3)
        const rewardText =
          activeRound && activeRound.currentPnl >= 0
            ? `+$${activeRound.currentPnl.toFixed(2)}`
            : '+$18.40';
        particles.emitTargetHitBurst(rocket.x, rocket.y, rewardText);
      } else if (gameStage === 'LOSS_HIT') {
        shakeMagnitudeRef.current = 6; // Tactile rumble thud
        particles.emitLossMist(rocket.x, rocket.y);
      } else if (gameStage === 'PRE_TRADE' || gameStage === 'HOME') {
        // Scorch ratchets and heals slowly by design, so it has to be cleared
        // explicitly or last round's damage carries into the next one.
        rocket.resetHull();
        // Otherwise the next round's first frame would diff against the
        // previous round's final P&L and fire a spurious pop.
        prevTrackerPnlRef.current = 0;
      }
    }
  }, [gameStage, activeRound]);

  // Main 60 FPS Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const renderer = rendererRef.current;
    const rocket = rocketRef.current;
    const particles = particlesRef.current;

    let animationFrameId: number;

    const render = () => {
      // CSS pixels. canvas.width is the device-pixel backing store and the
      // context is already scaled by dpr in the resize handler, so using it
      // here would lay the scene out at dpr x its intended size.
      const width = canvas.width / dprRef.current;
      const height = canvas.height / dprRef.current;

      ctx.save();

      // Camera Screen Shake Translation (Spring decay)
      if (shakeMagnitudeRef.current > 0.1 && !reducedMotion) {
        const sx = (Math.random() - 0.5) * shakeMagnitudeRef.current;
        const sy = (Math.random() - 0.5) * shakeMagnitudeRef.current;
        ctx.translate(sx, sy);
        shakeMagnitudeRef.current *= 0.88;
      }

      // Victory Punch-Zoom (hit-stop): a brief scale kick pivoted on the
      // rocket so the hit point never drifts — PRD §20's "clearly see where
      // the rocket hit" survives because everything scales around it, not
      // away from it. Matrix op only, no redraw — effectively free.
      //
      // Decay runs every frame regardless of reducedMotion — only the visual
      // application (the scale itself) is motion-gated. Gating the decay too
      // would leave punchRef/boomRef stuck at their trigger value forever
      // under reduced motion, since nothing outside these blocks decrements
      // them: the background would stay permanently "boomed" after the first
      // win instead of settling like the rest of this effect.
      if (punchRef.current > 0.01) {
        if (!reducedMotion) {
          const punch = 1 + punchRef.current * 0.05; // caps at 5% — a kick, not a lurch
          ctx.translate(rocket.x, rocket.y);
          ctx.scale(punch, punch);
          ctx.translate(-rocket.x, -rocket.y);
        }
        punchRef.current *= 0.55; // gone within ~5 frames, inside Frame 1's 80-120ms
      }

      // 1. Render Background & Clean Cosmic Void
      const activeAsset = activeRound ? activeRound.asset : currentAsset;
      renderer.renderBackground(ctx, width, height, reducedMotion, activeAsset, boomRef.current);

      // 2. Calculate Screen Points
      const currentHistory = marketFeed.getHistory();
      const points = renderer.calculateScreenPoints(currentHistory, width, height, activeRound);

      // Determine track color scheme. Cyan retired (docs/DESIGN_TOKENS.md: not
      // a fifth semantic color) — the neutral/no-round state uses brand yellow.
      let colorScheme = {
        stroke: '#F0B90B',
        glow: 'rgba(240, 185, 11, 0.4)',
        fill: 'rgba(240, 185, 11, 0.08)',
      };

      if (activeRound) {
        const isGood = activeRound.currentPnl >= 0;
        if (isGood) {
          colorScheme = {
            stroke: '#00E89A',
            glow: 'rgba(0, 232, 154, 0.55)',
            fill: 'rgba(0, 232, 154, 0.12)',
          };
        } else {
          colorScheme = {
            stroke: '#FF3B6B',
            glow: 'rgba(255, 59, 107, 0.55)',
            fill: 'rgba(255, 59, 107, 0.12)',
          };
        }
      }

      // 3. Render Market Track Spline
      renderer.renderTrack(ctx, points, width, height, colorScheme);

      // 4. Update Rocket target position to newest price point
      if (points.length > 0) {
        const latest = points[points.length - 1];
        if (gameStage === 'TARGET_HIT') {
          // Shoot slightly beyond the target on hit (PRD §20.3)
          rocket.setPosition(latest.x + 35, latest.y - 15);
        } else {
          rocket.setPosition(latest.x, latest.y);
        }
      }

      // Update rocket direction & player alignment
      const effectiveDirection = activeRound ? activeRound.direction : selectedDirection;
      const isGoodOutcome = activeRound ? activeRound.currentPnl >= 0 : true;
      rocket.setPlayerDirection(effectiveDirection, isGoodOutcome);
      rocket.targetProgressPct = targetProgressPct;
      rocket.currentPnl = activeRound ? activeRound.currentPnl : 0;

      // Audio Escalation & Real-Time Milestone Monitoring
      if (activeRound) {
        soundEngine.updateEnginePitch(activeRound.currentPnl / 6);

        // Milestone Pings (every +$5 profit gain)
        const currentTier = Math.floor(Math.max(0, activeRound.currentPnl) / 5);
        if (currentTier > lastPnlTierRef.current) {
          soundEngine.playMilestonePing();
          lastPnlTierRef.current = currentTier;
        } else if (currentTier < lastPnlTierRef.current) {
          lastPnlTierRef.current = currentTier;
        }

        // Deep Loss Emergency Radar Pulse (< -$6.00)
        if (activeRound.currentPnl <= -6.0) {
          const now = performance.now();
          if (now - lastDangerAlertRef.current > 2200) {
            soundEngine.playDangerWarningPulse();
            lastDangerAlertRef.current = now;
          }
        }

        // Hyperdrive Warp Streaks streaming at high profit (+$8.00+)
        if (activeRound.currentPnl >= 8.0 && Math.random() < 0.08 && !reducedMotion) {
          particles.triggerWarpStreaks(width, height);
        }
      } else {
        lastPnlTierRef.current = 0;
      }

      // 5. Render Pre-Trade Projected Path (PRD §14)
      if (gameStage === 'PRE_TRADE' && selectedDirection && points.length > 0) {
        const latest = points[points.length - 1];
        renderer.renderProjectedPath(ctx, latest.x, latest.y, selectedDirection);
      }

      // 6. Render Active Markers (Entry, Target Beacon, Stop Loss Marker)
      if (activeRound) {
        const entryY = renderer.priceToY(activeRound.entryPrice, currentHistory, height, activeRound);
        const targetY = renderer.priceToY(activeRound.targetPrice, currentHistory, height, activeRound);
        const stopY = renderer.priceToY(activeRound.stopLossPrice, currentHistory, height, activeRound);

        renderer.renderMarkers(
          ctx,
          width,
          entryY,
          targetY,
          stopY,
          activeRound.entryPrice,
          activeRound.targetPrice,
          activeRound.stopLossPrice,
          targetProgressPct,
          rocket.x,
          rocket.y,
          activeRound.direction,
          activeRound.currentPnl
        );
      }

      // 7. Render Last Round Marker on Home & Pre-Trade (PRD §31)
      if ((gameStage === 'HOME' || gameStage === 'PRE_TRADE') && lastRound && points.length > 15) {
        const markerPoint = points[Math.floor(points.length * 0.45)];
        renderer.renderLastRoundMarker(ctx, markerPoint.x, markerPoint.y, lastRound);
      }

      // 8. Update & Render Particles & Rocket
      particles.update();
      particles.render(ctx);

      // A sharp move should be felt, not just seen. The rocket detects the
      // surge on a rising edge; the scene answers with a camera kick and — far
      // more sparingly — a sound, so a volatile stretch does not become noise.
      rocket.onSurge = (power, climbing) => {
        shakeMagnitudeRef.current = Math.max(
          shakeMagnitudeRef.current,
          (climbing ? 5.5 : 4) * power
        );

        const now = performance.now();
        if (power > 0.55 && now - lastSurgeCueRef.current > 900) {
          lastSurgeCueRef.current = now;
          if (climbing) {
            soundEngine.playSurgeThrum();
            soundEngine.hapticLight();
          } else {
            soundEngine.playCountTick();
          }
        }
      };

      rocket.onTier = (tier, gained) => {
        // The $2.50 visual ladder and the $5 audio ladder coincide on every
        // even tier, and playMilestonePing() already fires hapticLight()
        // internally — so skip those or the device double-buzzes.
        const collidesWithAudioPing = gained && tier > 0 && tier % 2 === 0;
        if (gained) {
          if (!collidesWithAudioPing) soundEngine.hapticMedium();
        } else if (tier <= -1) {
          soundEngine.hapticWarning();
        }
      };

      rocket.update(particles, reducedMotion);
      rocket.render(ctx);

      // 8b. Rocket-Following Live P&L Number — a small persistent label
      // drawn every frame at the rocket's live position, redrawn like
      // everything else in this loop rather than spawned once as a
      // particle. Complements the fixed P&L readout in LiveTradeOverlay's
      // HUD with direct spatial feedback right where the action is
      // happening. Same font/shadow technique particles.ts's 'text' shape
      // already uses, and the same manual lerp/decay idiom as
      // punchRef/boomRef above.
      {
        const wantsTracker = gameStage === 'LIVE_TRADE' && !!activeRound;
        pnlTrackerAlphaRef.current += ((wantsTracker ? 1 : 0) - pnlTrackerAlphaRef.current) * 0.15;

        if (activeRound) {
          const trackerDelta = activeRound.currentPnl - prevTrackerPnlRef.current;
          prevTrackerPnlRef.current = activeRound.currentPnl;
          if (Math.abs(trackerDelta) >= 0.05) {
            pnlTrackerPopRef.current = 1;
          }
        }
        pnlTrackerPopRef.current *= 0.85;

        if (activeRound && pnlTrackerAlphaRef.current > 0.01) {
          const trackerPnl = activeRound.currentPnl;
          const trackerColor = trackerPnl >= 0 ? '#00E89A' : '#FF3B6B';
          const trackerLabel = `${trackerPnl < 0 ? '-' : '+'}$${Math.abs(trackerPnl).toFixed(2)}`;
          // Reduced motion keeps the number legible but drops the pop kick.
          const pop = reducedMotion ? 0 : pnlTrackerPopRef.current;
          const trackerFontSize = 15 + pop * 5;

          ctx.save();
          ctx.globalAlpha = pnlTrackerAlphaRef.current;
          ctx.font = `900 ${trackerFontSize}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = trackerColor;
          ctx.shadowColor = trackerColor;
          ctx.shadowBlur = 10;
          ctx.fillText(trackerLabel, rocket.x, rocket.y + rocket.hoverOffset - 34);
          ctx.restore();
        }
      }

      // 9. Tiered Dynamic PnL Edge Atmosphere (Plus & Minus Escalation)
      if (gameStage === 'LIVE_TRADE' && activeRound && !reducedMotion) {
        const isProfit = activeRound.currentPnl > 0;

        if (isProfit) {
          // --- PLUS ESCALATION ---
          const pnlIntensity = Math.min(1, activeRound.currentPnl / 12);
          const auraAlpha = 0.08 + pnlIntensity * 0.28;
          const pulse = 1 + Math.sin(performance.now() * 0.008) * 0.18;

          ctx.strokeStyle = `rgba(0, 255, 163, ${auraAlpha * pulse})`;
          ctx.lineWidth = 10 + pnlIntensity * 12;
          ctx.strokeRect(0, 0, width, height);

          // Corner Speed Laser Flares at >= $6.00
          if (activeRound.currentPnl >= 6.0) {
            ctx.strokeStyle = `rgba(0, 240, 255, ${0.45 * pulse})`;
            ctx.lineWidth = 2.5;
            const cornerLen = 24 + pnlIntensity * 24;
            // Top-left
            ctx.beginPath(); ctx.moveTo(0, cornerLen); ctx.lineTo(0, 0); ctx.lineTo(cornerLen, 0); ctx.stroke();
            // Top-right
            ctx.beginPath(); ctx.moveTo(width - cornerLen, 0); ctx.lineTo(width, 0); ctx.lineTo(width, cornerLen); ctx.stroke();
            // Bottom-left
            ctx.beginPath(); ctx.moveTo(0, height - cornerLen); ctx.lineTo(0, height); ctx.lineTo(cornerLen, height); ctx.stroke();
            // Bottom-right
            ctx.beginPath(); ctx.moveTo(width - cornerLen, height); ctx.lineTo(width, height); ctx.lineTo(width, height - cornerLen); ctx.stroke();
          }
        } else if (activeRound.currentPnl < 0) {
          // --- MINUS ESCALATION ---
          const lossIntensity = Math.min(1, Math.abs(activeRound.currentPnl) / 9);
          // Heartbeat tempo: accelerates with deeper loss
          const beatSpeed = 0.007 + lossIntensity * 0.014;
          const heartbeat = Math.pow(Math.max(0, Math.sin(performance.now() * beatSpeed)), 4);
          const alertAlpha = 0.1 + lossIntensity * 0.38 * heartbeat;

          ctx.strokeStyle = `rgba(255, 0, 85, ${alertAlpha})`;
          ctx.lineWidth = 12 + lossIntensity * 14;
          ctx.strokeRect(0, 0, width, height);

          // Emergency Hazard scanlines when deep in minus (<= -$5.00)
          if (activeRound.currentPnl <= -5.0) {
            ctx.strokeStyle = `rgba(255, 0, 85, ${0.35 * heartbeat})`;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([8, 8]);
            ctx.strokeRect(6, 6, width - 12, height - 12);
            ctx.setLineDash([]);
          }
        }
      }

      // 10. Radial Victory Bloom Flash on Win — shares boomRef with the
      // background surge in renderBackground so the near-field flash and the
      // far-field environment reaction decay together, not independently.
      //
      // This is boomRef's only decay site, so it must run every frame
      // regardless of reducedMotion (see the punch-zoom comment above for
      // why) — only the flash draw itself is motion-gated.
      if (boomRef.current > 0.01) {
        if (!reducedMotion) {
          const flashGrad = ctx.createRadialGradient(
            rocket.x,
            rocket.y,
            8,
            rocket.x,
            rocket.y,
            Math.max(width, height) * 0.9
          );
          flashGrad.addColorStop(0, `rgba(255, 255, 255, ${boomRef.current * 0.95})`);
          flashGrad.addColorStop(0.35, `rgba(0, 255, 163, ${boomRef.current * 0.55})`);
          flashGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = flashGrad;
          ctx.fillRect(0, 0, width, height);
        }
        boomRef.current *= 0.9;
      }

      ctx.restore();

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [gameStage, activeRound, selectedDirection, lastRound, targetProgressPct, reducedMotion, currentAsset]);

  // Handle Retina DPR and Resize
  useEffect(() => {
    const handleResize = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      dprRef.current = dpr;
      const rect = container.getBoundingClientRect();

      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden select-none"
    >
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
      />
    </div>
  );
};
