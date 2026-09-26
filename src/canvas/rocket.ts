import { PositionDirection } from '../types/game';
import { ParticleSystem } from './particles';

type RGB = [number, number, number];

/** Charge ladder by tier magnitude; index 0 is the idle steel hull. */
// Cyan retired (docs/DESIGN_TOKENS.md: "not a fifth primary semantic
// color") — the top tier escalates into bright brand-yellow instead of a
// foreign hue, keeping the ladder's visual escalation without introducing one.
const CHARGE_LADDER: RGB[] = [
  [226, 232, 240],
  [240, 185, 11],  // --bnb-yellow
  [0, 232, 154],   // --long
  [255, 210, 30],  // --bnb-yellow-bright ("hyperdrive")
  [235, 251, 255],
];
const DAMAGE_LADDER: RGB[] = [
  [148, 163, 184],
  [255, 122, 0],
  [255, 59, 107],  // --short / --loss
  [255, 30, 78],
  [255, 70, 70],
];

const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Surface points on the fuselage with outward normals, sampled off the bezier. */
const HULL_SKIN: readonly [number, number, number, number][] = [
  [15.6, -4.0, 0.42, -0.91],
  [11.4, -5.4, 0.24, -0.97],
  [7.0, -6.4, 0.14, -0.99],
  [2.4, -7.1, 0.04, -1.0],
  [-2.1, -7.5, -0.03, -1.0],
  [-6.3, -7.5, -0.1, -0.99],
  [-11.6, -7.1, -0.34, -0.94],
  [-11.6, 7.1, -0.34, 0.94],
  [-6.3, 7.5, -0.1, 0.99],
  [-2.1, 7.5, -0.03, 1.0],
  [2.4, 7.1, 0.04, 1.0],
  [7.0, 6.4, 0.14, 0.99],
  [11.4, 5.4, 0.24, 0.97],
  [15.6, 4.0, 0.42, 0.91],
];

export class RocketAvatar {
  public x: number = 0;
  public y: number = 0;
  public targetX: number = 0;
  public targetY: number = 0;
  public angle: number = 0;
  public targetAngle: number = 0;
  public hoverOffset: number = 0;
  public engineActive: boolean = true;
  public thrusterColor: string = '#00E89A';
  public boostIntensity: number = 1.0;
  public isTargetHit: boolean = false;
  public isDrifting: boolean = false;
  public targetProgressPct: number = 0;
  public currentPnl: number = 0;

  /** Smoothed vertical velocity. Positive = climbing, i.e. the "plus" side. */
  public climbRate: number = 0;
  /** Fired on a surge so the scene can kick the camera and the audio. */
  public onSurge: ((power: number, climbing: boolean) => void) | null = null;
  /** Fired when a $2.50 P&L milestone is crossed. Visual + haptic only. */
  public onTier: ((tier: number, gained: boolean) => void) | null = null;

  /** -1..1 from P&L. The primary plus/minus read; drives the hull state. */
  public chargeLevel: number = 0;
  /** -1..1 from the sign of recent P&L change. Flavours transient bursts. */
  public favour: number = 0;
  /** Current $2.50 milestone tier, signed. */
  public tier: number = 0;

  private time: number = 0;
  private prevSignal: number = 0;
  private speed: number = 0;
  private stretch: number = 0;
  private surgeCooldown: number = 0;
  private reduced: boolean = false;
  private prevPnl: number = 0;
  private chargePulse: number = 0;
  private impactFlash: number = 0;
  /** Soot ratchets: rises fast, heals slowly. It does not wipe off on a tick up. */
  private scorch: number = 0;
  private rimFlare: number = 0;
  private veinBrownout: number = 0;
  private pulseT: number = 1;
  private pulseDir: 1 | -1 = 1;
  private pulseCooldown: number = 0;
  /** Local-space hit marks, so a spark lights the plate it came off. */
  private hullHits: { x: number; y: number; life: number }[] = [];
  /** Hoisted out of render() so emitted sparks agree with the drawn body. */
  private jitterX: number = 0;
  private jitterY: number = 0;
  private readonly fuselage: Path2D;
  private readonly veins: Path2D;
  private readonly visorArc: Path2D;
  /** Gradient coordinates resolve against the CTM at paint time, so caching is safe. */
  private gradCache = new Map<string, CanvasGradient>();
  private trail: { x: number; y: number; climb: number }[] = [];

  /**
   * Organic ticks peak near 0.14 raw while the demo toolbar reaches 7.6 — a
   * ~180x range. REF sets where the curve is sensitive, MAX where it saturates;
   * a linear map can only serve one end of that range.
   */
  private static readonly REF = 0.08;
  private static readonly MAX = 6.0;
  private static readonly DENOM = Math.log1p(RocketAvatar.MAX / RocketAvatar.REF);

  /** this.time advances 0.05/frame ~ 3.0/s, so sin(time * HZ * f) runs at f Hz. */
  private static readonly HZ = (2 * Math.PI) / 3.0;

  /** Tier colour ladder by magnitude; losses have their own colour. */
  private static readonly TIER_COLORS = ['#F0B90B', '#00E89A', '#FFD21E', '#FFFFFF'];

  constructor() {
    this.x = 100;
    this.y = 200;
    this.targetX = 100;
    this.targetY = 200;

    // Built once. Re-specifying this bezier every frame for the tint, vein
    // clip and rim light would be four extra path constructions per frame.
    this.fuselage = new Path2D();
    this.fuselage.moveTo(22, 0);
    this.fuselage.bezierCurveTo(14, -8, -10, -9, -15, -6);
    this.fuselage.lineTo(-15, 6);
    this.fuselage.bezierCurveTo(-10, 9, 14, 8, 22, 0);
    this.fuselage.closePath();

    // Three conduits, each defined tail -> nose so a negative lineDashOffset
    // makes the dashes travel forward. All in one Path2D: a flow layer costs
    // one stroke() call instead of three.
    this.veins = new Path2D();
    this.veins.moveTo(-13.5, -3.4);
    this.veins.bezierCurveTo(-6, -5.4, 2, -5.6, 16.5, -1.8);
    this.veins.moveTo(-13.5, 3.6);
    this.veins.bezierCurveTo(-6, 5.6, 4, 5.4, 17.0, 1.2);
    this.veins.moveTo(-8.5, -2.0);
    this.veins.bezierCurveTo(-3, 0.6, 3, 1.4, 11.5, 0.2);

    this.visorArc = new Path2D();
    this.visorArc.arc(8, 0, 4.5, -Math.PI / 2, Math.PI / 2);
    this.visorArc.closePath();
  }

  /** Keeps stroke weight visually constant under the non-uniform squash. */
  private strokeComp(): number {
    const s = this.stretch;
    return 1 / Math.sqrt(Math.max(0.2, (1 + s) * (1 - s * 0.55)));
  }

  private grad(key: string, build: () => CanvasGradient): CanvasGradient {
    let g = this.gradCache.get(key);
    if (!g) {
      if (this.gradCache.size > 64) this.gradCache.clear();
      g = build();
      this.gradCache.set(key, g);
    }
    return g;
  }

  /** Colour for the current tier, blended across the band so the ladder is continuous. */
  private tierRGB(): RGB {
    if (this.tier > 0) {
      const i = Math.min(4, this.tier);
      const frac = Math.max(0, Math.min(1, (this.currentPnl - this.tier * 2.5) / 2.5));
      return mixRGB(CHARGE_LADDER[i], CHARGE_LADDER[Math.min(4, i + 1)], frac * 0.6);
    }
    if (this.tier < 0) return DAMAGE_LADDER[Math.min(4, -this.tier)];
    return CHARGE_LADDER[0];
  }

  /** Clears the hull between rounds so soot never carries over. */
  public resetHull() {
    this.chargeLevel = 0;
    this.scorch = 0;
    this.tier = 0;
    this.prevPnl = 0;
    this.favour = 0;
    this.rimFlare = 0;
    this.veinBrownout = 0;
    this.impactFlash = 0;
    this.chargePulse = 0;
    this.pulseT = 1;
    this.hullHits.length = 0;
  }

  private firePulse(amp: number, dir: 1 | -1) {
    if (this.reduced) return;
    this.chargePulse = Math.max(this.chargePulse, amp);
    this.pulseT = 0;
    this.pulseDir = dir;
    this.pulseCooldown = 14;
  }

  private tierColor(): string {
    if (this.tier < 0) return '#FF3B6B';
    const i = Math.min(3, Math.max(0, Math.abs(this.tier) - 1));
    return RocketAvatar.TIER_COLORS[i];
  }

  /**
   * Local hull coordinate -> world. Particles render outside the rocket's
   * transform, so hull sparks have to be converted here or they land at the
   * canvas origin and ignore the rocket's rotation.
   */
  private toWorld(lx: number, ly: number) {
    const sx = lx * (1 + this.stretch);
    const sy = ly * (1 - this.stretch * 0.55);
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    return {
      x: this.x + this.jitterX + sx * cos - sy * sin,
      y: this.y + this.hoverOffset + this.jitterY + sx * sin + sy * cos,
    };
  }

  /**
   * Climb rate mapped to roughly -1..1.
   *
   * Measured against the live feed: a drop swings about three times harder
   * than an equivalent rise, because the visible price window rescales and
   * carries the rocket further down the canvas. A single threshold would
   * therefore either never fire on the way up or fire constantly on the way
   * down, so each side gets its own normaliser and every effect below reads
   * from this one value.
   */
  private climbSignal(): number {
    const c = this.climbRate;
    // A drop swings harder than an equal rise: the visible price window
    // rescales every frame and carries the rocket further down the canvas.
    // PRD §22 asks a loss to be clear but never punitive, so damp that side.
    const a = Math.abs(c) / (c < 0 ? 3.4 : 1);
    return Math.sign(c) * Math.min(1, Math.log1p(a / RocketAvatar.REF) / RocketAvatar.DENOM);
  }

  public setPosition(x: number, y: number, immediate: boolean = false) {
    this.targetX = x;
    this.targetY = y;
    if (immediate) {
      this.x = x;
      this.y = y;
    }
  }

  public setPlayerDirection(direction: PositionDirection | null, isGood: boolean) {
    if (!direction) {
      this.thrusterColor = '#F0B90B'; // BNB gold default
      this.boostIntensity = 1.0;
      return;
    }

    if (direction === 'LONG') {
      this.thrusterColor = isGood ? '#00E89A' : '#F0B90B';
      this.boostIntensity = isGood ? 1.6 : 0.8;
    } else {
      // SHORT
      this.thrusterColor = isGood ? '#00E89A' : '#FF3B6B';
      this.boostIntensity = isGood ? 1.5 : 0.7;
    }
  }

  public update(particles: ParticleSystem, reducedMotion: boolean = false) {
    this.time += 0.05;
    // render() has no access to the flag, and the motion-reactive visuals
    // below it must honour it too (PRD §35).
    this.reduced = reducedMotion;

    // Smooth hover bobbing when idle
    this.hoverOffset = reducedMotion ? 0 : Math.sin(this.time * 2.5) * 3.5;

    // Smooth position interpolation (spring-lerp)
    const lerpSpeed = this.isTargetHit ? 0.25 : 0.12;
    const prevX = this.x;
    const prevY = this.y;

    this.x += (this.targetX - this.x) * lerpSpeed;
    this.y += (this.targetY - this.y) * lerpSpeed;

    // Calculate velocity vector for pitch angle
    const vx = this.x - prevX;
    const vy = this.y - prevY;

    if (!reducedMotion) {
      if (this.isDrifting) {
        // Slow downward drift
        this.targetAngle = 0.25;
      } else {
        // Angle points along motion vector, clamped to realistic pitch
        const rawAngle = Math.atan2(vy, Math.max(0.5, vx));
        this.targetAngle = Math.max(-0.55, Math.min(0.55, rawAngle));
      }
      this.angle += (this.targetAngle - this.angle) * 0.15;
    } else {
      this.angle = 0;
    }

    // --- Motion response -------------------------------------------------
    // Everything else about this rocket reacts to P&L *level*, so a sharp
    // move up looks the same as drifting up. These derive from the frame's
    // actual displacement, which is what makes a plus or minus land.
    // Screen y grows downward, so a negative vy is a climb.
    this.prevSignal = this.climbSignal();
    this.climbRate += (-vy - this.climbRate) * 0.28;
    this.speed += (Math.hypot(vx, vy) - this.speed) * 0.3;

    // Squash and stretch along the travel axis — the oldest trick there is
    // for making movement feel like it has weight. Square-rooted so a small
    // move still registers instead of only the extremes showing.
    const targetStretch = reducedMotion
      ? 0
      : Math.min(0.32, Math.sqrt(Math.abs(this.climbSignal())) * 0.32);
    this.stretch += (targetStretch - this.stretch) * 0.35;

    if (reducedMotion) {
      this.trail.length = 0;
    } else {
      this.trail.push({ x: this.x, y: this.y + this.hoverOffset, climb: this.climbSignal() });
      if (this.trail.length > 18) this.trail.shift();
    }

    if (this.surgeCooldown > 0) this.surgeCooldown--;

    // --- P&L response ----------------------------------------------------
    // Screen motion cannot express plus/minus: the Y axis rescales to the
    // visible window every frame, so a sustained rally pins the newest point
    // and the rocket stops moving entirely. P&L is monotonic and already
    // direction-aware (settlementEngine:81 flips the sign for SHORT), so the
    // hull state reads from it instead.
    const chargeTarget = Math.max(-1, Math.min(1, this.currentPnl / 12));
    this.chargeLevel += (chargeTarget - this.chargeLevel) * 0.06;

    // Soot ratchets. It builds quickly under load and fades far more slowly,
    // because scorching does not wipe itself off when the price ticks back up.
    const scorchTarget = Math.max(0, Math.min(1, -this.currentPnl / 9));
    this.scorch += (scorchTarget - this.scorch) * (scorchTarget > this.scorch ? 0.12 : 0.015);

    // Airframe jitter is computed here rather than in render() so hull sparks
    // are emitted from the body the player actually sees.
    if (this.currentPnl <= -3.0 && !this.isDrifting && !reducedMotion) {
      const amp = Math.min(2.8, (Math.abs(this.currentPnl) - 2.5) * 0.45);
      this.jitterX = (Math.random() - 0.5) * amp;
      this.jitterY = (Math.random() - 0.5) * amp;
    } else {
      this.jitterX = 0;
      this.jitterY = 0;
    }

    // P&L only changes on a tick (~4/sec), so hold the sign and decay between
    // ticks. A burst firing a few frames later must still know which way the
    // money went — a profitable SHORT dives, and that is a win (PRD §18).
    const dPnl = this.currentPnl - this.prevPnl;
    if (dPnl !== 0) {
      this.favour = Math.sign(dPnl) * Math.min(1, Math.abs(dPnl) * 8);
    } else {
      this.favour *= 0.94;
    }
    this.prevPnl = this.currentPnl;

    // Milestone tiers every $2.50, banded on magnitude so the ladder is
    // symmetric, with a $0.50 deadband so a P&L sitting on a boundary cannot
    // strobe between tiers.
    const mag = Math.abs(this.currentPnl) / 2.5;
    const pnlSign = Math.sign(this.currentPnl);
    const prevTier = this.tier;
    let m =
      Math.sign(this.tier) !== pnlSign && this.tier !== 0 ? 0 : Math.abs(this.tier);
    while (mag > m + 1) m++;
    while (m > 0 && mag < m - 0.2) m--;
    // Capped to the colour ladder's depth. Past it the hull is already
    // saturated, so further tiers would only spam rings and haptics.
    this.tier = Math.min(4, m) * (pnlSign || 1);

    if (this.tier !== prevTier) {
      const gained = this.tier > prevTier;
      if (!reducedMotion) {
        particles.emitTierRing(this.x, this.y + this.hoverOffset, this.tierColor(), gained);
        if (gained) {
          this.rimFlare = 1;
          this.firePulse(1, 1);
        } else {
          this.veinBrownout = 1;
          this.firePulse(0.7, -1);
          // Only real damage flashes. Giving back a profit tier is a retrace,
          // not a hit — PRD §22 asks a loss to be clear, never punitive.
          if (this.tier <= -1) this.impactFlash = 1;
        }
      }
      this.onTier?.(this.tier, gained);
    }

    // A fast rise in charge inside a tier still deserves a wavefront.
    if (this.pulseCooldown > 0) this.pulseCooldown--;
    const dCharge = chargeTarget - this.chargeLevel;
    if (!reducedMotion && dCharge > 0.05 && this.pulseCooldown === 0) {
      this.firePulse(Math.min(1, dCharge * 6), 1);
    }

    if (this.chargePulse > 0.01) {
      this.pulseT += reducedMotion ? 1 : 0.085;
      if (this.pulseT >= 1) this.chargePulse = 0;
    }
    this.rimFlare *= 0.9;
    this.veinBrownout *= 0.88;
    this.impactFlash *= 0.86;

    for (let i = this.hullHits.length - 1; i >= 0; i--) {
      this.hullHits[i].life -= 0.12;
      if (this.hullHits[i].life <= 0) this.hullHits.splice(i, 1);
    }

    // Emit thruster particles if engine active
    if (this.engineActive && !this.isDrifting) {
      const actualY = this.y + this.hoverOffset;
      const nozzleX = this.x - Math.cos(this.angle) * 18;
      const nozzleY = actualY - Math.sin(this.angle) * 18;

      particles.emitThruster(
        nozzleX,
        nozzleY,
        this.angle,
        this.thrusterColor,
        reducedMotion ? 0.5 : this.boostIntensity
      );

      // Continuous Escalation Particle Emitters based on PnL
      if (!reducedMotion) {
        if (this.currentPnl >= 3.5) {
          particles.emitProfitCoinGlint(nozzleX, nozzleY, this.currentPnl);
        } else if (this.currentPnl <= -2.5) {
          const severity = Math.min(4, Math.abs(this.currentPnl) / 2.2);
          particles.emitDamageSmokeAndSparks(nozzleX, nozzleY, severity);
        }

        const signal = this.climbSignal();
        const magnitude = Math.abs(signal);

        // Sparks struck off the plating while the position is bleeding. These
        // leave along the surface normal so they read as damage, not exhaust.
        if (this.currentPnl <= -2.5) {
          const d = Math.min(1, -this.currentPnl / 9);
          if (Math.random() < 0.06 + d * 0.3) {
            const sk = HULL_SKIN[(Math.random() * HULL_SKIN.length) | 0];
            const pt = this.toWorld(sk[0], sk[1]);
            const c = Math.cos(this.angle);
            const si = Math.sin(this.angle);
            particles.emitHullSpark(
              pt.x,
              pt.y,
              sk[2] * c - sk[3] * si,
              sk[2] * si + sk[3] * c,
              this.angle,
              d
            );
            this.hullHits.push({ x: sk[0], y: sk[1], life: 1 });
          }
        }

        // Wingtip vortices while pulling up — sells the climb as effort.
        if (signal > 0.12 && Math.random() < 0.55) {
          particles.emitVortexCurl(
            this.x,
            actualY,
            this.angle,
            Math.random() > 0.5 ? 1 : -1,
            Math.min(1, signal * 1.6),
            this.currentPnl >= 8 ? '#FFD21E' : '#00E89A'
          );
        }

        // The surge itself: a rising edge, not a level, so it fires once per
        // move instead of buzzing for as long as the price stays high.
        // On the compressed curve organic p90 sits at 0.074 and p99 at 0.234,
        // so 0.18 keeps ~90% of frames quiet while letting real ticks land.
        const SURGE_THRESHOLD = 0.18;
        if (
          this.surgeCooldown === 0 &&
          magnitude > SURGE_THRESHOLD &&
          magnitude > Math.abs(this.prevSignal)
        ) {
          const power = Math.min(1, 0.3 + (magnitude - SURGE_THRESHOLD) * 1.1);
          const climbing = signal > 0;

          // Flavour follows the money, not the screen. A SHORT that is
          // winning dives, and PRD §18 calls that a success state — it must
          // not throw red damage embers.
          const good = this.favour >= 0;
          const accent = this.currentPnl >= 8 ? '#FFD21E' : '#00E89A';

          if (good) {
            particles.emitClimbBurst(nozzleX, nozzleY, this.angle, power, accent);
            particles.emitGForceRing(this.x, actualY, accent, power);
            this.chargePulse = Math.max(this.chargePulse, power);
          } else {
            particles.emitDiveEmbers(nozzleX, nozzleY, power);
            particles.emitGForceRing(this.x, actualY, '#FF3B6B', power * 0.7);
            this.impactFlash = Math.max(this.impactFlash, power);
          }

          this.onSurge?.(power, climbing);
          this.surgeCooldown = 12;
        }
      }
    }
  }

  /**
   * Drawn in world space, before the rocket's own transform, so the ribbon
   * traces the path actually flown. Colour keys off the climb at each sample,
   * which makes a reversal read instantly: green behind, red ahead.
   */
  private renderTrail(ctx: CanvasRenderingContext2D) {
    if (this.reduced || this.trail.length < 3) return;

    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      const t = i / this.trail.length;
      const climb = b.climb;
      const intensity = Math.min(1, Math.abs(climb) * 2.2);

      ctx.strokeStyle =
        climb >= 0
          ? `rgba(0, 255, 163, ${t * 0.5 * intensity})`
          : `rgba(255, 0, 85, ${t * 0.45 * intensity})`;
      ctx.lineWidth = t * (2 + intensity * 6);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  public render(ctx: CanvasRenderingContext2D) {
    const drawY = this.y + this.hoverOffset;

    this.renderTrail(ctx);

    ctx.save();

    // Airframe turbulent vibration jitter when deep in loss
    let jitterX = 0;
    let jitterY = 0;
    if (this.currentPnl <= -3.0 && !this.isDrifting) {
      const jitterAmp = Math.min(2.8, (Math.abs(this.currentPnl) - 2.5) * 0.45);
      jitterX = (Math.random() - 0.5) * jitterAmp;
      jitterY = (Math.random() - 0.5) * jitterAmp;
    }

    ctx.translate(this.x + jitterX, drawY + jitterY);
    ctx.rotate(this.angle);
    // Stretch along travel, pinch across it — conserves apparent volume, so
    // the rocket reads as accelerating rather than just being scaled up.
    ctx.scale(1 + this.stretch, 1 - this.stretch * 0.55);

    // Dynamic flame length & color based on real-time PnL
    let effectiveFlameColor = this.thrusterColor;
    let baseFlameLen = 16 + (this.boostIntensity - 1) * 14;

    if (this.currentPnl > 0) {
      // Escalating profit flame length
      const profitBoost = Math.min(38, this.currentPnl * 2.8);
      baseFlameLen = 18 + profitBoost;
      effectiveFlameColor = this.currentPnl >= 8 ? '#FFD21E' : '#00E89A';
    } else if (this.currentPnl < 0) {
      // Sputtering loss flame
      const lossPenalty = Math.min(10, Math.abs(this.currentPnl) * 1.2);
      const sputter = (Math.random() - 0.5) * 6;
      baseFlameLen = Math.max(8, 14 - lossPenalty + sputter);
      effectiveFlameColor = Math.random() > 0.3 ? '#FF3B6B' : '#FF4400';
    }

    // The throttle answers the climb too: pulling up lights the afterburner,
    // dropping cuts it. Without this the flame ignores the move entirely.
    // The floor keeps a dive from extinguishing the engine outright.
    const climbSignal = this.reduced ? 0 : this.climbSignal();
    baseFlameLen += climbSignal >= 0 ? climbSignal * 24 : Math.max(-9, climbSignal * 14);

    // 1. Rocket Glow halo & Supersonic Plasma Jet Exhaust
    if (this.engineActive && !this.isDrifting) {
      const glowGrad = ctx.createRadialGradient(-12, 0, 2, -12, 0, 28);
      glowGrad.addColorStop(0, effectiveFlameColor + 'bb');
      glowGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(-12, 0, 28, 0, Math.PI * 2);
      ctx.fill();

      // Dynamic Flame Plume Geometry
      const flicker = Math.sin(this.time * 28) * 3;
      const flameLen = Math.max(10, baseFlameLen + flicker);
      const flameHalfWidth = 4.5 * (1 + Math.sin(this.time * 22) * 0.12);

      // A. Outer Plasma Flame Plume
      const flameGrad = ctx.createLinearGradient(-18, 0, -18 - flameLen, 0);
      flameGrad.addColorStop(0, effectiveFlameColor);
      flameGrad.addColorStop(0.55, `${effectiveFlameColor}88`);
      flameGrad.addColorStop(1, 'transparent');

      ctx.fillStyle = flameGrad;
      ctx.beginPath();
      ctx.moveTo(-18, -flameHalfWidth);
      ctx.quadraticCurveTo(-18 - flameLen * 0.45, -flameHalfWidth * 1.3, -18 - flameLen, 0);
      ctx.quadraticCurveTo(-18 - flameLen * 0.45, flameHalfWidth * 1.3, -18, flameHalfWidth);
      ctx.closePath();
      ctx.fill();

      // B. Inner Hot Core Torch (White-Hot Supersonic Core)
      const coreLen = flameLen * 0.52;
      const coreGrad = ctx.createLinearGradient(-18, 0, -18 - coreLen, 0);
      coreGrad.addColorStop(0, '#FFFFFF');
      coreGrad.addColorStop(0.6, effectiveFlameColor);
      coreGrad.addColorStop(1, 'transparent');

      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.moveTo(-18, -2.2);
      ctx.quadraticCurveTo(-18 - coreLen * 0.5, -2.8, -18 - coreLen, 0);
      ctx.quadraticCurveTo(-18 - coreLen * 0.5, 2.8, -18, 2.2);
      ctx.closePath();
      ctx.fill();

      // C. Supersonic Mach Shock Diamonds (Supersonic standing shock nodes)
      const diamondCount = this.currentPnl >= 4 ? 4 : this.boostIntensity > 1.2 ? 3 : 2;
      for (let d = 1; d <= diamondCount; d++) {
        const dX = -18 - d * (flameLen / (diamondCount + 1.2));
        const dPulse = 1 + Math.sin(this.time * 32 + d) * 0.22;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.moveTo(dX - 2 * dPulse, 0);
        ctx.lineTo(dX, -1.6 * dPulse);
        ctx.lineTo(dX + 2 * dPulse, 0);
        ctx.lineTo(dX, 1.6 * dPulse);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Hyperdrive Plasma Energy Shield Bubble (>= $10.00 Profit)
    if (this.currentPnl >= 10 && !this.isDrifting) {
      const shieldPulse = 1 + Math.sin(this.time * 16) * 0.08;
      ctx.save();
      const shieldGrad = ctx.createRadialGradient(2, 0, 8, 2, 0, 32 * shieldPulse);
      shieldGrad.addColorStop(0, 'rgba(0, 255, 163, 0.12)');
      shieldGrad.addColorStop(0.7, 'rgba(0, 240, 255, 0.28)');
      shieldGrad.addColorStop(1, 'rgba(240, 185, 11, 0.55)');
      ctx.fillStyle = shieldGrad;
      ctx.beginPath();
      ctx.ellipse(2, 0, 30 * shieldPulse, 19 * shieldPulse, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#00E89A';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      ctx.ellipse(2, 0, 30 * shieldPulse, 19 * shieldPulse, this.time * 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // --- Rocket Hull ---
    // Charge and damage are rendered ON the plating. Everything else in this
    // scene renders around the rocket, which left the craft itself inert while
    // P&L moved. These read from chargeLevel/scorch, never from screen motion:
    // the Y axis rescales every frame, so a sustained rally pins the rocket
    // still, and a winning SHORT dives (PRD §18).
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const charge = Math.max(0, this.chargeLevel);
    const scorch = this.scorch;
    const col = this.tierRGB();
    const comp = this.strokeComp();
    // Quantised so a smoothly moving charge does not blow the gradient cache.
    const gk = `${this.tier}|${(charge * 16) | 0}|${(scorch * 16) | 0}`;

    // Outer bloom — the only shadowBlur in this layer, and mutually exclusive
    // with the electrical arcs below (they need pnl <= -6, this needs ~+6.6).
    if (charge > 0.55 && !this.isDrifting) {
      ctx.save();
      ctx.shadowColor = rgba(col, 0.9);
      ctx.shadowBlur = 8 + charge * 12;
      ctx.strokeStyle = rgba(col, 0.22 * charge);
      ctx.lineWidth = 1.2;
      ctx.stroke(this.fuselage);
      ctx.restore();
    }

    // Tail Fins
    ctx.fillStyle = '#192348';
    ctx.strokeStyle = '#253366';
    ctx.lineWidth = 1.5;

    // Top fin
    ctx.beginPath();
    ctx.moveTo(-10, -4);
    ctx.lineTo(-20, -14);
    ctx.lineTo(-12, -4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Bottom fin
    ctx.beginPath();
    ctx.moveTo(-10, 4);
    ctx.lineTo(-20, 14);
    ctx.lineTo(-12, 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Main fuselage. The path is built once in the constructor and reused for
    // fill, stroke and clip rather than re-specified four times per frame.
    ctx.fillStyle = this.grad('hull', () => {
      const g = ctx.createLinearGradient(0, -9, 0, 9);
      g.addColorStop(0, '#FFFFFF');
      g.addColorStop(0.5, '#E2E8F0');
      g.addColorStop(1, '#94A3B8');
      return g;
    });
    ctx.fill(this.fuselage);

    ctx.strokeStyle = rgba(
      mixRGB(mixRGB([100, 116, 139], col, charge * 0.7), [58, 20, 20], scorch * 0.8),
      1
    );
    ctx.lineWidth = 1.5;
    ctx.stroke(this.fuselage);

    // ---- One clip for eight effects. A per-effect clip would rebuild the
    //      raster mask each time; the region is only ~37x18 units. ----
    ctx.save();
    ctx.clip(this.fuselage);

    // a. Energy conduits under the plating
    const veinLife = (1 - this.veinBrownout * 0.85) * Math.max(charge, scorch * 0.5);
    if (veinLife > 0.02) {
      const vc = this.tier < 0 ? DAMAGE_LADDER[1] : col;
      // Two wide low-alpha strokes fake a bloom for a fraction of what one
      // shadowBlur costs, and they clip cleanly to the hull.
      ctx.setLineDash([]);
      ctx.strokeStyle = rgba(vc, 0.1 + veinLife * 0.16);
      ctx.lineWidth = 3.4 * comp;
      ctx.stroke(this.veins);

      ctx.strokeStyle = rgba(vc, 0.3 + veinLife * 0.55);
      ctx.lineWidth = 1.1 * comp;
      ctx.setLineDash([5, 9]);
      // Dash phase follows arc length along the real curve — a moving gradient
      // would need reallocating every frame and would desync on a bend.
      ctx.lineDashOffset = this.reduced ? 0 : -(this.time * 9) % 14;
      ctx.stroke(this.veins);

      if (!this.reduced && veinLife > 0.25) {
        ctx.strokeStyle = `rgba(255,255,255,${0.45 * veinLife})`;
        ctx.lineWidth = 1.7 * comp;
        ctx.setLineDash([3, 41]);
        ctx.lineDashOffset = -(this.time * 26) % 44;
        ctx.stroke(this.veins);
      }
      ctx.setLineDash([]);
    }

    // b. BNB Gold Stripe Accent — inside the clip, so soot browns it out too
    ctx.fillStyle = '#F0B90B';
    ctx.beginPath();
    ctx.moveTo(3, -7.5);
    ctx.lineTo(8, -6.5);
    ctx.lineTo(6, 6.5);
    ctx.lineTo(1, 7.5);
    ctx.closePath();
    ctx.fill();

    // c. Profit tint. 'overlay' multiplies the dark end and screens the light
    //    end, so the plating keeps its value structure and only takes the hue —
    //    rebuilding the hull gradient's stops would flatten the metal.
    if (charge > 0.02) {
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = this.grad(`tint|${gk}`, () => {
        const g = ctx.createLinearGradient(-15, 0, 22, 0);
        g.addColorStop(0, rgba(col, 0.1 * charge));
        g.addColorStop(0.55, rgba(col, 0.42 * charge));
        g.addColorStop(1, rgba(mixRGB(col, [255, 255, 255], 0.5), 0.3 * charge));
        return g;
      });
      ctx.fillRect(-22, -12, 48, 24);
      ctx.globalCompositeOperation = 'source-over';
    }

    // d. Scorch, running forward from the tail where the exhaust licks the
    //    plating. 'multiply' darkens toward black the way soot actually does.
    if (scorch > 0.02) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = this.grad(`scorch|${gk}`, () => {
        const g = ctx.createLinearGradient(-15, 0, 14, 0);
        g.addColorStop(0, `rgba(48,30,32,${0.2 + scorch * 0.75})`);
        g.addColorStop(0.45, `rgba(96,66,64,${0.15 + scorch * 0.55})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        return g;
      });
      ctx.fillRect(-22, -12, 48, 24);

      // Fixed patches, not random — soot is damage, not per-frame noise.
      const soot: [number, number, number][] = [
        [-9, -3.2, 5.5],
        [-4, 4.0, 4.5],
        [3, -1.5, 3.5],
      ];
      for (const [sx, sy, sr] of soot) {
        ctx.fillStyle = this.grad(`soot|${sx}|${(scorch * 12) | 0}`, () => {
          const g = ctx.createRadialGradient(sx, sy, 0.5, sx, sy, sr);
          g.addColorStop(0, `rgba(24,16,18,${0.7 * scorch})`);
          g.addColorStop(1, 'rgba(255,255,255,0)');
          return g;
        });
        ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // e. Travelling wavefront. Direction is the whole tell: a tier gained runs
    //    tail -> nose, a tier lost runs nose -> tail in red.
    if (this.chargePulse > 0.01 && this.pulseT < 1) {
      const t = this.pulseDir === 1 ? this.pulseT : 1 - this.pulseT;
      const px = -17 + t * 41;
      const a = this.chargePulse * Math.sin(this.pulseT * Math.PI);
      const bandCol =
        this.pulseDir === 1 ? mixRGB(col, [255, 255, 255], 0.65) : DAMAGE_LADDER[2];

      ctx.globalCompositeOperation = 'lighter';
      const band = ctx.createLinearGradient(px - 7, 0, px + 7, 0);
      band.addColorStop(0, rgba(bandCol, 0));
      band.addColorStop(0.5, rgba(bandCol, 0.55 * a));
      band.addColorStop(1, rgba(bandCol, 0));
      ctx.fillStyle = band;
      ctx.fillRect(px - 7, -12, 14, 24);

      ctx.strokeStyle = `rgba(255,255,255,${0.5 * a})`;
      ctx.lineWidth = 1.2 * comp;
      ctx.beginPath();
      ctx.moveTo(px + this.pulseDir * 2.5, -9);
      ctx.lineTo(px + this.pulseDir * 2.5, 9);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }

    // f. Hazard lamps at the fin roots
    const dmg = Math.max(0, Math.min(1, -this.currentPnl / 9));
    if (dmg > 0.08) {
      // 0.9Hz at first blood to 3.5Hz at -$9. pow(.,8) gives a short sharp
      // blink with a long dark gap; the 0.12 floor keeps the lamp present.
      const hz = 0.9 + dmg * 2.6;
      const raw = Math.max(0, Math.sin(this.time * RocketAvatar.HZ * hz));
      const strobe = this.reduced ? 0.55 : 0.12 + Math.pow(raw, 8) * 0.88;

      ctx.globalCompositeOperation = 'lighter';
      for (const ly of [-4.6, 4.6]) {
        ctx.fillStyle = this.grad(
          `lamp|${ly}|${(strobe * 10) | 0}|${(dmg * 8) | 0}`,
          () => {
            const g = ctx.createRadialGradient(-6, ly, 0.4, -6, ly, 5.2);
            g.addColorStop(0, `rgba(255,255,255,${0.75 * strobe * dmg})`);
            g.addColorStop(0.35, `rgba(255,0,85,${0.7 * strobe * dmg})`);
            g.addColorStop(1, 'rgba(255,0,85,0)');
            return g;
          }
        );
        ctx.fillRect(-11.2, ly - 5.2, 10.4, 10.4);
      }
      ctx.globalCompositeOperation = 'source-over';

      ctx.fillStyle = `rgba(255,${60 - 60 * strobe},90,${0.5 + 0.5 * strobe})`;
      ctx.beginPath();
      ctx.arc(-6, -4.6, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-6, 4.6, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // g. Hit flashes — the plate lights where the spark came off, so the eye
    //    reads "struck, then spark" rather than "spark, therefore exhaust".
    if (this.hullHits.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (const h of this.hullHits) {
        ctx.fillStyle = `rgba(255,${180 * h.life + 60},120,${0.85 * h.life})`;
        ctx.beginPath();
        ctx.arc(h.x, h.y, 0.8 + (1 - h.life) * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // h. Impact flash
    if (this.impactFlash > 0.01) {
      const f = this.impactFlash;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,${40 + 120 * (1 - f)},${70 + 60 * (1 - f)},${0.55 * f})`;
      ctx.fillRect(-22, -12, 48, 24);
      ctx.globalCompositeOperation = 'source-over';
      if (f > 0.6) {
        ctx.strokeStyle = `rgba(255,255,255,${(f - 0.6) * 1.8})`;
        ctx.lineWidth = 3 * comp;
        ctx.stroke(this.fuselage);
      }
    }

    // i. Inner rim light, last so nothing paints over the silhouette edge.
    //    Stroking centres the pen on the outline and the clip discards the
    //    outer half, leaving a clean inner rim — no shadowBlur needed.
    const rimA = Math.min(1, 0.16 + charge * 0.62 + this.rimFlare * 0.5);
    ctx.strokeStyle = this.grad(`rim|${gk}|${(this.rimFlare * 8) | 0}`, () => {
      const g = ctx.createLinearGradient(0, -9, 0, 9);
      g.addColorStop(0, rgba(col, rimA));
      g.addColorStop(0.3, rgba(mixRGB(col, [255, 255, 255], 0.55), rimA * 0.9));
      g.addColorStop(0.72, rgba(col, rimA * 0.35));
      g.addColorStop(1, rgba(col, rimA * 0.7));
      return g;
    });
    ctx.lineWidth = (2.6 + charge * 2.4 + this.rimFlare * 2.0) * comp;
    ctx.stroke(this.fuselage);

    ctx.restore();

    // Cockpit Visor / Glass Dome. Loss desaturates rather than reddens — red
    // is already the hull's job, and a browning-out screen reads as systems
    // failing rather than as anger.
    const visorHot = Math.min(1, charge * 1.15);
    const flick =
      scorch > 0.25 && !this.reduced
        ? 0.62 + 0.38 * Math.sin(this.time * 17.1) * Math.sin(this.time * 6.3)
        : 1;

    ctx.fillStyle = this.grad(`visor|${gk}`, () => {
      const g = ctx.createLinearGradient(4, -4, 12, 4);
      if (scorch > 0.15) {
        const k = scorch;
        g.addColorStop(0, `rgb(${43 * k},${240 - 166 * k},${255 - 168 * k})`);
        g.addColorStop(1, `rgb(${22 * k},${136 - 86 * k},${204 - 142 * k})`);
      } else {
        // Cockpit glass base is a cool neutral (--text-2), not cyan — the
        // palette's "white/gray for neutral UI" rule applies to the hull too.
        g.addColorStop(
          0,
          rgba(mixRGB([154, 168, 189], mixRGB(col, [255, 255, 255], 0.55), visorHot), 1)
        );
        g.addColorStop(1, rgba(mixRGB([101, 117, 140], col, visorHot * 0.7), 1));
      }
      return g;
    });
    ctx.save();
    ctx.globalAlpha = flick;
    ctx.fill(this.visorArc);
    ctx.restore();

    ctx.strokeStyle =
      scorch > 0.3
        ? `rgba(200,210,220,${0.5 + 0.3 * flick})`
        : `rgba(255,255,255,${0.7 + visorHot * 0.3})`;
    ctx.lineWidth = 1 + visorHot * 0.6;
    ctx.stroke(this.visorArc);

    if (this.currentPnl <= -6.0) {
      ctx.save();
      ctx.clip(this.visorArc);
      ctx.strokeStyle = `rgba(230,240,255,${0.35 + 0.35 * flick})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(6.2, -4.2);
      ctx.lineTo(8.1, -0.9);
      ctx.lineTo(7.0, 2.6);
      ctx.moveTo(8.1, -0.9);
      ctx.lineTo(11.4, -1.8);
      ctx.moveTo(8.1, -0.9);
      ctx.lineTo(9.6, 3.9);
      ctx.stroke();
      ctx.restore();
    }

    // Cockpit specular reflection glint
    const gr = 1.2 + visorHot * 1.1;
    ctx.fillStyle = `rgba(255,255,255,${0.85 + visorHot * 0.15})`;
    ctx.beginPath();
    ctx.arc(
      7 + (this.reduced ? 0 : Math.sin(this.time * 1.7) * 0.25),
      -1.8,
      gr * (scorch > 0.3 ? 0.55 : 1),
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Anamorphic cross flare — two 1px lines, the cheapest "this is bright"
    // signal there is, and far cheaper than a second shadowBlur.
    if (visorHot > 0.55) {
      const fl = (visorHot - 0.55) / 0.45;
      ctx.strokeStyle = `rgba(255,255,255,${0.55 * fl})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(7 - 5 * fl, -1.8);
      ctx.lineTo(7 + 5 * fl, -1.8);
      ctx.moveTo(7, -1.8 - 3.4 * fl);
      ctx.lineTo(7, -1.8 + 3.4 * fl);
      ctx.stroke();
    }

    // Thruster Nozzle
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.roundRect(-18, -4, 4, 8, 2);
    ctx.fill();

    // Aerodynamic Sonic Vapor Condensation Cone (Forms at high speed / target lock >= 80% or profit >= $6)
    const shouldShowCone = (this.targetProgressPct >= 80 || this.currentPnl >= 6.0) && !this.isDrifting;
    if (shouldShowCone) {
      const coneAlpha = this.currentPnl >= 6.0
        ? Math.min(0.7, 0.3 + (this.currentPnl - 6.0) / 10 * 0.4)
        : Math.min(0.65, ((this.targetProgressPct - 80) / 20) * 0.65);

      ctx.save();
      ctx.strokeStyle = `rgba(255, 255, 255, ${coneAlpha})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(22, 0, 10, -Math.PI * 0.42, Math.PI * 0.42);
      ctx.stroke();

      ctx.strokeStyle = `rgba(0, 240, 255, ${coneAlpha * 0.75})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(20, 0, 14, -Math.PI * 0.48, Math.PI * 0.48);
      ctx.stroke();
      ctx.restore();
    }

    // Air piling up on the nose during a hard pull-up.
    if (climbSignal > 0.30 && !this.isDrifting && !this.reduced) {
      const bloom = Math.min(1, (climbSignal - 0.30) / 0.7);
      const noseGrad = ctx.createRadialGradient(20, 0, 1, 20, 0, 16 + bloom * 12);
      noseGrad.addColorStop(0, `rgba(255, 255, 255, ${0.35 * bloom})`);
      noseGrad.addColorStop(0.5, `rgba(0, 240, 255, ${0.22 * bloom})`);
      noseGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = noseGrad;
      ctx.beginPath();
      ctx.arc(20, 0, 16 + bloom * 12, 0, Math.PI * 2);
      ctx.fill();
    }

    // Critical Overload High-Voltage Electrical Arcs (<= -$6.00 Loss)
    if (this.currentPnl <= -6.0 && !this.isDrifting) {
      ctx.save();
      ctx.strokeStyle = Math.random() > 0.5 ? '#FF3B6B' : '#FFD21E';
      ctx.lineWidth = 1.4;
      ctx.shadowColor = '#FF3B6B';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(-16 + (Math.random() - 0.5) * 4, -4);
      ctx.lineTo(2 + (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
      ctx.lineTo(16 + (Math.random() - 0.5) * 4, 0);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }
}
