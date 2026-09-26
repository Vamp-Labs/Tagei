import { PositionDirection } from '../types/game';
import { ParticleSystem } from './particles';
import { mix } from '../ui/lucky/palette';
import { CLEAR, ROCKET, TONE, Tone, chargeTone, damageTone } from './theme';

const LAMP_MAX_HZ = 2.5;
const TIME_UNITS_PER_SECOND = 3.0;
const DEFAULT_FRAME_SECONDS = 1 / 60;
const SOOT_STROKE_SHARE = 0.8;

/** Surface points on the fuselage with outward normals, sampled off the new nose/cylinder/tail-taper outline. */
const HULL_SKIN: readonly [number, number, number, number][] = [
  [20.5, -3.2, 0.55, -0.83],
  [17.5, -6.2, 0.3, -0.95],
  [13.5, -8.4, 0.12, -0.99],
  [8.0, -8.75, 0.02, -1.0],
  [0.0, -8.8, 0.0, -1.0],
  [-6.5, -8.5, -0.08, -0.99],
  [-11.5, -7.7, -0.28, -0.96],
  [-15.0, -6.0, -0.55, -0.83],
  [-15.0, 6.0, -0.55, 0.83],
  [-11.5, 7.7, -0.28, 0.96],
  [-6.5, 8.5, -0.08, 0.99],
  [0.0, 8.8, 0.0, 1.0],
  [8.0, 8.75, 0.02, 1.0],
  [13.5, 8.4, 0.12, 0.99],
  [17.5, 6.2, 0.3, 0.95],
  [20.5, 3.2, 0.55, 0.83],
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
  public thrusterColor: string = ROCKET.profitFlame.hex;
  private thrusterTone: Tone = ROCKET.profitFlame;
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
  private readonly fins: Path2D;
  private readonly nozzleBell: Path2D;
  private readonly veins: Path2D;
  private readonly visorArc: Path2D;
  /** Gradient coordinates resolve against the CTM at paint time, so caching is safe. */
  private gradCache = new Map<string, CanvasGradient>();
  private edgeKey: number = -1;
  private edgeColor: string = ROCKET.hullEdge;
  private trail: { x: number; y: number; climb: number; good: boolean }[] = [];

  /**
   * Organic ticks peak near 0.14 raw while the demo toolbar reaches 7.6 — a
   * ~180x range. REF sets where the curve is sensitive, MAX where it saturates;
   * a linear map can only serve one end of that range.
   */
  private static readonly REF = 0.08;
  private static readonly MAX = 6.0;
  private static readonly DENOM = Math.log1p(RocketAvatar.MAX / RocketAvatar.REF);

  /** this.time advances TIME_UNITS_PER_SECOND per real second, so sin(time * HZ * f) runs at f Hz. */
  private static readonly HZ = (2 * Math.PI) / TIME_UNITS_PER_SECOND;

  /** Tier colour ladder by magnitude; losses have their own colour. */
  private static readonly TIER_COLORS = ROCKET.tiers;

  constructor() {
    this.x = 100;
    this.y = 200;
    this.targetX = 100;
    this.targetY = 200;

    // Built once. Re-specifying this bezier every frame for the tint, vein
    // clip and rim light would be four extra path constructions per frame.
    // Nose cone (tight curvature reaching near-full radius fast) and
    // cylindrical mid-body (near-parallel sides) are two distinct bezier
    // segments rather than one long taper, then a short boat-tail into the fins.
    this.fuselage = new Path2D();
    this.fuselage.moveTo(22, 0);
    this.fuselage.bezierCurveTo(19.5, -6.6, 15, -8.6, 12, -8.7);
    this.fuselage.bezierCurveTo(5, -8.8, -3, -8.6, -9.5, -8.3);
    this.fuselage.bezierCurveTo(-13, -8.0, -15, -6.8, -16.5, -5.5);
    this.fuselage.lineTo(-16.5, 5.5);
    this.fuselage.bezierCurveTo(-15, 6.8, -13, 8.0, -9.5, 8.3);
    this.fuselage.bezierCurveTo(-3, 8.6, 5, 8.8, 12, 8.7);
    this.fuselage.bezierCurveTo(15, 8.6, 19.5, 6.6, 22, 0);
    this.fuselage.closePath();

    // Three flared fins in one Path2D so the fanned tail costs one fill and
    // one stroke instead of one pair per blade: an "up" fin and two fanned
    // "down" fins, each a curved sail rather than a flat triangle.
    this.fins = new Path2D();
    this.fins.moveTo(-8.5, -8.0);
    this.fins.quadraticCurveTo(-14.0, -11.5, -20.0, -14.0);
    this.fins.quadraticCurveTo(-17.0, -11.8, -14.0, -6.2);
    this.fins.closePath();
    this.fins.moveTo(-7.0, 8.2);
    this.fins.quadraticCurveTo(-10.5, 11.8, -15.0, 14.0);
    this.fins.quadraticCurveTo(-13.0, 11.3, -9.5, 6.9);
    this.fins.closePath();
    this.fins.moveTo(-11.5, 7.6);
    this.fins.quadraticCurveTo(-16.0, 10.2, -20.0, 12.5);
    this.fins.quadraticCurveTo(-18.0, 9.3, -15.0, 6.3);
    this.fins.closePath();

    // Tapered engine bell: narrow at the throat where it meets the hull,
    // flaring to a wider exit rim.
    this.nozzleBell = new Path2D();
    this.nozzleBell.moveTo(-14.5, -2.0);
    this.nozzleBell.bezierCurveTo(-16.0, -2.2, -17.7, -2.9, -19.0, -4.2);
    this.nozzleBell.lineTo(-19.0, 4.2);
    this.nozzleBell.bezierCurveTo(-17.7, 2.9, -16.0, 2.2, -14.5, 2.0);
    this.nozzleBell.closePath();

    // Three conduits, each defined tail -> nose so a negative lineDashOffset
    // makes the dashes travel forward. All in one Path2D: a flow layer costs
    // one stroke() call instead of three.
    this.veins = new Path2D();
    this.veins.moveTo(-14.5, -3.4);
    this.veins.bezierCurveTo(-7, -5.4, 2, -5.6, 16.5, -1.8);
    this.veins.moveTo(-14.5, 3.6);
    this.veins.bezierCurveTo(-7, 5.6, 4, 5.4, 17.0, 1.2);
    this.veins.moveTo(-9.5, -2.0);
    this.veins.bezierCurveTo(-3, 0.6, 3, 1.4, 11.5, 0.2);

    // Full porthole, centered inside the cylindrical mid-body.
    this.visorArc = new Path2D();
    this.visorArc.arc(10.5, 0, 4.2, 0, Math.PI * 2);
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
  private tierTone(): Tone {
    if (this.tier > 0) {
      const frac = Math.max(0, Math.min(1, (this.currentPnl - this.tier * 2.5) / 2.5));
      return chargeTone(this.tier, frac);
    }
    if (this.tier < 0) return damageTone(-this.tier);
    return chargeTone(0, 0);
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
    if (this.tier < 0) return ROCKET.tierLoss;
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
      this.thrusterTone = ROCKET.idleFlame;
      this.thrusterColor = this.thrusterTone.hex;
      this.boostIntensity = 1.0;
      return;
    }

    this.thrusterTone = isGood ? ROCKET.profitFlame : ROCKET.lossFlame;
    this.thrusterColor = this.thrusterTone.hex;
    if (direction === 'LONG') {
      this.boostIntensity = isGood ? 1.6 : 0.8;
    } else {
      this.boostIntensity = isGood ? 1.5 : 0.7;
    }
  }

  public update(
    particles: ParticleSystem,
    reducedMotion: boolean = false,
    dtSeconds: number = DEFAULT_FRAME_SECONDS
  ) {
    this.time += dtSeconds * TIME_UNITS_PER_SECOND;
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
      this.trail.push({
        x: this.x,
        y: this.y + this.hoverOffset,
        climb: this.climbSignal(),
        good: this.currentPnl >= 0,
      });
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
            this.currentPnl >= 8 ? ROCKET.surgeHyper : ROCKET.surgeGood
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
          const accent = this.currentPnl >= 8 ? ROCKET.surgeHyper : ROCKET.surgeGood;

          if (good) {
            particles.emitClimbBurst(nozzleX, nozzleY, this.angle, power, accent);
            particles.emitGForceRing(this.x, actualY, accent, power);
            this.chargePulse = Math.max(this.chargePulse, power);
          } else {
            particles.emitDiveEmbers(nozzleX, nozzleY, power);
            particles.emitGForceRing(this.x, actualY, ROCKET.surgeBad, power * 0.7);
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
   * traces the path actually flown. Colour keys off the P&L sign at each
   * sample and intensity off the climb, so a winning SHORT dive stays lucky.
   */
  private renderTrail(ctx: CanvasRenderingContext2D) {
    if (this.reduced || this.trail.length < 3) return;

    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      const t = i / this.trail.length;
      const intensity = Math.min(1, Math.abs(b.climb) * 2.2);

      ctx.strokeStyle = b.good
        ? ROCKET.trailGood.a(t * 0.5 * intensity)
        : ROCKET.trailBad.a(t * 0.45 * intensity);
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

    // Airframe jitter comes from update(), which already gates it on reduced motion
    ctx.translate(this.x + this.jitterX, drawY + this.jitterY);
    ctx.rotate(this.angle);
    // Stretch along travel, pinch across it — conserves apparent volume, so
    // the rocket reads as accelerating rather than just being scaled up.
    ctx.scale(1 + this.stretch, 1 - this.stretch * 0.55);

    // Dynamic flame length & color based on real-time PnL
    let flame = this.thrusterTone;
    let baseFlameLen = 16 + (this.boostIntensity - 1) * 14;

    if (this.currentPnl > 0) {
      // Escalating profit flame length
      const profitBoost = Math.min(38, this.currentPnl * 2.8);
      baseFlameLen = 18 + profitBoost;
      flame = this.currentPnl >= 8 ? ROCKET.hyperFlame : ROCKET.profitFlame;
    } else if (this.currentPnl < 0) {
      // Sputtering loss flame, in one stable amber
      const lossPenalty = Math.min(10, Math.abs(this.currentPnl) * 1.2);
      const sputter = this.reduced ? 0 : (Math.random() - 0.5) * 6;
      baseFlameLen = Math.max(8, 14 - lossPenalty + sputter);
      flame = ROCKET.lossFlame;
    }

    // The throttle answers the climb too: pulling up lights the afterburner,
    // dropping cuts it. Without this the flame ignores the move entirely.
    // The floor keeps a dive from extinguishing the engine outright.
    const climbSignal = this.reduced ? 0 : this.climbSignal();
    baseFlameLen += climbSignal >= 0 ? climbSignal * 24 : Math.max(-9, climbSignal * 14);

    // 1. Rocket Glow halo & Supersonic Plasma Jet Exhaust
    if (this.engineActive && !this.isDrifting) {
      const glowGrad = ctx.createRadialGradient(-12, 0, 2, -12, 0, 28);
      glowGrad.addColorStop(0, flame.a(0.73));
      glowGrad.addColorStop(1, CLEAR);
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(-12, 0, 28, 0, Math.PI * 2);
      ctx.fill();

      // Dynamic Flame Plume Geometry
      const flicker = this.reduced ? 0 : Math.sin(this.time * 28) * 3;
      const flameLen = Math.max(10, baseFlameLen + flicker);
      const flameHalfWidth = 4.5 * (1 + (this.reduced ? 0 : Math.sin(this.time * 22) * 0.12));

      // A. Outer Plasma Flame Plume — anchored at the engine bell's exit rim
      const flameGrad = ctx.createLinearGradient(-19, 0, -19 - flameLen, 0);
      flameGrad.addColorStop(0, flame.hex);
      flameGrad.addColorStop(0.55, flame.a(0.53));
      flameGrad.addColorStop(1, CLEAR);

      ctx.fillStyle = flameGrad;
      ctx.beginPath();
      ctx.moveTo(-19, -flameHalfWidth);
      ctx.quadraticCurveTo(-19 - flameLen * 0.45, -flameHalfWidth * 1.3, -19 - flameLen, 0);
      ctx.quadraticCurveTo(-19 - flameLen * 0.45, flameHalfWidth * 1.3, -19, flameHalfWidth);
      ctx.closePath();
      ctx.fill();

      // B. Inner Hot Core Torch (White-Hot Supersonic Core)
      const coreLen = flameLen * 0.52;
      const coreGrad = ctx.createLinearGradient(-19, 0, -19 - coreLen, 0);
      coreGrad.addColorStop(0, ROCKET.flameCore);
      coreGrad.addColorStop(0.6, flame.hex);
      coreGrad.addColorStop(1, CLEAR);

      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.moveTo(-19, -2.2);
      ctx.quadraticCurveTo(-19 - coreLen * 0.5, -2.8, -19 - coreLen, 0);
      ctx.quadraticCurveTo(-19 - coreLen * 0.5, 2.8, -19, 2.2);
      ctx.closePath();
      ctx.fill();

      // C. Supersonic Mach Shock Diamonds (Supersonic standing shock nodes)
      const diamondCount = this.currentPnl >= 4 ? 4 : this.boostIntensity > 1.2 ? 3 : 2;
      for (let d = 1; d <= diamondCount; d++) {
        const dX = -19 - d * (flameLen / (diamondCount + 1.2));
        const dPulse = this.reduced ? 1 : 1 + Math.sin(this.time * 32 + d) * 0.22;
        ctx.fillStyle = ROCKET.flameCore;
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
      const shieldPulse = this.reduced ? 1 : 1 + Math.sin(this.time * 16) * 0.08;
      ctx.save();
      const shieldGrad = ctx.createRadialGradient(2, 0, 8, 2, 0, 32 * shieldPulse);
      shieldGrad.addColorStop(0, ROCKET.shieldCore);
      shieldGrad.addColorStop(0.7, ROCKET.shieldMid);
      shieldGrad.addColorStop(1, ROCKET.shieldRim);
      ctx.fillStyle = shieldGrad;
      ctx.beginPath();
      ctx.ellipse(2, 0, 30 * shieldPulse, 19 * shieldPulse, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = ROCKET.shieldStroke;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      ctx.ellipse(2, 0, 30 * shieldPulse, 19 * shieldPulse, this.reduced ? 0 : this.time * 4, 0, Math.PI * 2);
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
    const col = this.tierTone();
    const comp = this.strokeComp();
    // Quantised so a smoothly moving charge does not blow the gradient cache.
    const gk = `${this.tier}|${(charge * 16) | 0}|${(scorch * 16) | 0}`;

    // Outer bloom — the only shadowBlur in this layer, and mutually exclusive
    // with the electrical arcs below (they need pnl <= -6, this needs ~+6.6).
    if (charge > 0.55 && !this.isDrifting) {
      ctx.save();
      ctx.shadowColor = col.a(0.9);
      ctx.shadowBlur = 8 + charge * 12;
      ctx.strokeStyle = col.a(0.22 * charge);
      ctx.lineWidth = 1.2;
      ctx.stroke(this.fuselage);
      ctx.restore();
    }

    // Tail Fins — one up, two fanned down, all in one Path2D
    ctx.fillStyle = ROCKET.finFill;
    ctx.strokeStyle = ROCKET.finEdge;
    ctx.lineWidth = 1.5;
    ctx.fill(this.fins);
    ctx.stroke(this.fins);

    // Main fuselage. The path is built once in the constructor and reused for
    // fill, stroke and clip rather than re-specified four times per frame.
    ctx.fillStyle = this.grad('hull', () => {
      const g = ctx.createLinearGradient(0, -8.8, 0, 8.8);
      g.addColorStop(0, ROCKET.hullLight);
      g.addColorStop(0.5, ROCKET.hullMid);
      g.addColorStop(1, ROCKET.hullDark);
      return g;
    });
    ctx.fill(this.fuselage);

    const edgeKey = col.id * 1024 + ((charge * 16) | 0) * 32 + ((scorch * 16) | 0);
    if (edgeKey !== this.edgeKey) {
      this.edgeKey = edgeKey;
      this.edgeColor = mix(
        mix(ROCKET.hullEdge, col.hex, charge * 0.7),
        ROCKET.hullSoot,
        scorch * SOOT_STROKE_SHARE
      );
    }
    ctx.strokeStyle = this.edgeColor;
    ctx.lineWidth = 1.5;
    ctx.stroke(this.fuselage);

    // ---- One clip for eight effects. A per-effect clip would rebuild the
    //      raster mask each time; the region is only ~37x18 units. ----
    ctx.save();
    ctx.clip(this.fuselage);

    // a. Energy conduits under the plating
    const veinLife = (1 - this.veinBrownout * 0.85) * Math.max(charge, scorch * 0.5);
    if (veinLife > 0.02) {
      const vc = this.tier < 0 ? damageTone(1) : col;
      // Two wide low-alpha strokes fake a bloom for a fraction of what one
      // shadowBlur costs, and they clip cleanly to the hull.
      ctx.setLineDash([]);
      ctx.strokeStyle = vc.a(0.1 + veinLife * 0.16);
      ctx.lineWidth = 3.4 * comp;
      ctx.stroke(this.veins);

      ctx.strokeStyle = vc.a(0.3 + veinLife * 0.55);
      ctx.lineWidth = 1.1 * comp;
      ctx.setLineDash([5, 9]);
      // Dash phase follows arc length along the real curve — a moving gradient
      // would need reallocating every frame and would desync on a bend.
      ctx.lineDashOffset = this.reduced ? 0 : -(this.time * 9) % 14;
      ctx.stroke(this.veins);

      if (!this.reduced && veinLife > 0.25) {
        ctx.strokeStyle = TONE.ink.a(0.45 * veinLife);
        ctx.lineWidth = 1.7 * comp;
        ctx.setLineDash([3, 41]);
        ctx.lineDashOffset = -(this.time * 26) % 44;
        ctx.stroke(this.veins);
      }
      ctx.setLineDash([]);
    }

    // b. BNB Gold Stripe Accent — inside the clip, so soot browns it out too
    ctx.fillStyle = ROCKET.stripe;
    ctx.beginPath();
    ctx.moveTo(0.5, -8.3);
    ctx.lineTo(6, -7.2);
    ctx.lineTo(4.5, 7.2);
    ctx.lineTo(-0.5, 8.3);
    ctx.closePath();
    ctx.fill();

    // c. Profit tint. 'overlay' multiplies the dark end and screens the light
    //    end, so the plating keeps its value structure and only takes the hue —
    //    rebuilding the hull gradient's stops would flatten the metal.
    if (charge > 0.02) {
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = this.grad(`tint|${gk}`, () => {
        const g = ctx.createLinearGradient(-16.5, 0, 22, 0);
        g.addColorStop(0, col.a(0.1 * charge));
        g.addColorStop(0.55, col.a(0.42 * charge));
        g.addColorStop(1, col.lift.a(0.3 * charge));
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
        const g = ctx.createLinearGradient(-16.5, 0, 14, 0);
        g.addColorStop(0, ROCKET.sootDark.a(0.2 + scorch * 0.75));
        g.addColorStop(0.45, ROCKET.sootMid.a(0.15 + scorch * 0.55));
        g.addColorStop(1, TONE.ink.a(0));
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
          g.addColorStop(0, ROCKET.sootDark.a(0.7 * scorch));
          g.addColorStop(1, TONE.ink.a(0));
          return g;
        });
        ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // e. Travelling wavefront. Direction is the whole tell: a tier gained runs
    //    tail -> nose, a tier lost runs nose -> tail in amber.
    if (this.chargePulse > 0.01 && this.pulseT < 1) {
      const t = this.pulseDir === 1 ? this.pulseT : 1 - this.pulseT;
      const px = -17 + t * 41;
      const a = this.chargePulse * Math.sin(this.pulseT * Math.PI);
      const bandCol = this.pulseDir === 1 ? col.lift : damageTone(2);

      ctx.globalCompositeOperation = 'lighter';
      const band = ctx.createLinearGradient(px - 7, 0, px + 7, 0);
      band.addColorStop(0, bandCol.a(0));
      band.addColorStop(0.5, bandCol.a(0.55 * a));
      band.addColorStop(1, bandCol.a(0));
      ctx.fillStyle = band;
      ctx.fillRect(px - 7, -12, 14, 24);

      ctx.strokeStyle = TONE.ink.a(0.5 * a);
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
      // 0.9Hz at first blood, capped at 2.5Hz to stay clear of flash limits.
      // pow(.,8) gives a short sharp blink with a long dark gap; the 0.12
      // floor keeps the lamp present.
      const hz = Math.min(LAMP_MAX_HZ, 0.9 + dmg * 2.6);
      const raw = Math.max(0, Math.sin(this.time * RocketAvatar.HZ * hz));
      const strobe = this.reduced ? 0.55 : 0.12 + Math.pow(raw, 8) * 0.88;

      ctx.globalCompositeOperation = 'lighter';
      for (const ly of [-7.3, 7.3]) {
        ctx.fillStyle = this.grad(
          `lamp|${ly}|${(strobe * 10) | 0}|${(dmg * 8) | 0}`,
          () => {
            const g = ctx.createRadialGradient(-10, ly, 0.4, -10, ly, 5.2);
            g.addColorStop(0, TONE.ink.a(0.75 * strobe * dmg));
            g.addColorStop(0.35, ROCKET.hazard.a(0.7 * strobe * dmg));
            g.addColorStop(1, ROCKET.hazard.a(0));
            return g;
          }
        );
        ctx.fillRect(-15.2, ly - 5.2, 10.4, 10.4);
      }
      ctx.globalCompositeOperation = 'source-over';

      ctx.fillStyle = ROCKET.hazard.a(0.5 + 0.5 * strobe);
      ctx.beginPath();
      ctx.arc(-10, -7.3, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-10, 7.3, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // g. Hit flashes — the plate lights where the spark came off, so the eye
    //    reads "struck, then spark" rather than "spark, therefore exhaust".
    if (this.hullHits.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (const h of this.hullHits) {
        ctx.fillStyle = ROCKET.hit.a(0.85 * h.life);
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
      ctx.fillStyle = ROCKET.hit.a(0.55 * f);
      ctx.fillRect(-22, -12, 48, 24);
      ctx.globalCompositeOperation = 'source-over';
      if (f > 0.6) {
        ctx.strokeStyle = TONE.ink.a((f - 0.6) * 1.8);
        ctx.lineWidth = 3 * comp;
        ctx.stroke(this.fuselage);
      }
    }

    // i. Inner rim light, last so nothing paints over the silhouette edge.
    //    Stroking centres the pen on the outline and the clip discards the
    //    outer half, leaving a clean inner rim — no shadowBlur needed.
    const rimA = Math.min(1, 0.16 + charge * 0.62 + this.rimFlare * 0.5);
    ctx.strokeStyle = this.grad(`rim|${gk}|${(this.rimFlare * 8) | 0}`, () => {
      const g = ctx.createLinearGradient(0, -8.8, 0, 8.8);
      g.addColorStop(0, col.a(rimA));
      g.addColorStop(0.3, col.lift.a(rimA * 0.9));
      g.addColorStop(0.72, col.a(rimA * 0.35));
      g.addColorStop(1, col.a(rimA * 0.7));
      return g;
    });
    ctx.lineWidth = (2.6 + charge * 2.4 + this.rimFlare * 2.0) * comp;
    ctx.stroke(this.fuselage);

    ctx.restore();

    // Cockpit Visor / Glass Dome. Loss desaturates rather than tints — the
    // hull already carries the amber, and a dimming screen reads as systems
    // failing rather than as anger.
    const visorHot = Math.min(1, charge * 1.15);
    const flick =
      scorch > 0.25 && !this.reduced
        ? 0.62 + 0.38 * Math.sin(this.time * 17.1) * Math.sin(this.time * 6.3)
        : 1;

    ctx.fillStyle = this.grad(`visor|${gk}`, () => {
      const g = ctx.createLinearGradient(6.5, -4.2, 14.5, 4.2);
      if (scorch > 0.15) {
        const k = scorch;
        g.addColorStop(0, mix(ROCKET.visorScorchLight, ROCKET.visorScorchSink, k));
        g.addColorStop(1, mix(ROCKET.visorScorchDark, ROCKET.visorScorchFloor, k));
      } else {
        // Cockpit glass base is a cool neutral, tinted by the charge tier.
        g.addColorStop(0, mix(ROCKET.visorBase, col.lift.hex, visorHot));
        g.addColorStop(1, mix(ROCKET.visorDeep, col.hex, visorHot * 0.7));
      }
      return g;
    });
    ctx.save();
    ctx.globalAlpha = flick;
    ctx.fill(this.visorArc);
    ctx.restore();

    ctx.strokeStyle =
      scorch > 0.3 ? ROCKET.glass.a(0.5 + 0.3 * flick) : TONE.ink.a(0.7 + visorHot * 0.3);
    ctx.lineWidth = 1 + visorHot * 0.6;
    ctx.stroke(this.visorArc);

    if (this.currentPnl <= -6.0) {
      ctx.save();
      ctx.clip(this.visorArc);
      ctx.strokeStyle = ROCKET.glass.a(0.35 + 0.35 * flick);
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(8.8, -3.9);
      ctx.lineTo(10.6, -0.8);
      ctx.lineTo(9.6, 2.4);
      ctx.moveTo(10.6, -0.8);
      ctx.lineTo(13.7, -1.7);
      ctx.moveTo(10.6, -0.8);
      ctx.lineTo(12.0, 3.6);
      ctx.stroke();
      ctx.restore();
    }

    // Cockpit specular reflection glint
    const gr = 1.2 + visorHot * 1.1;
    ctx.fillStyle = TONE.ink.a(0.85 + visorHot * 0.15);
    ctx.beginPath();
    ctx.arc(
      9.6 + (this.reduced ? 0 : Math.sin(this.time * 1.7) * 0.25),
      -1.7,
      gr * (scorch > 0.3 ? 0.55 : 1),
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Anamorphic cross flare — two 1px lines, the cheapest "this is bright"
    // signal there is, and far cheaper than a second shadowBlur.
    if (visorHot > 0.55) {
      const fl = (visorHot - 0.55) / 0.45;
      ctx.strokeStyle = TONE.ink.a(0.55 * fl);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(9.6 - 5 * fl, -1.7);
      ctx.lineTo(9.6 + 5 * fl, -1.7);
      ctx.moveTo(9.6, -1.7 - 3.4 * fl);
      ctx.lineTo(9.6, -1.7 + 3.4 * fl);
      ctx.stroke();
    }

    // Thruster Nozzle — tapered engine bell, cached in the constructor
    ctx.fillStyle = ROCKET.nozzle;
    ctx.fill(this.nozzleBell);

    // Aerodynamic Sonic Vapor Condensation Cone (Forms at high speed / target lock >= 80% or profit >= $6)
    const shouldShowCone = (this.targetProgressPct >= 80 || this.currentPnl >= 6.0) && !this.isDrifting;
    if (shouldShowCone) {
      const coneAlpha = this.currentPnl >= 6.0
        ? Math.min(0.7, 0.3 + (this.currentPnl - 6.0) / 10 * 0.4)
        : Math.min(0.65, ((this.targetProgressPct - 80) / 20) * 0.65);

      ctx.save();
      ctx.strokeStyle = ROCKET.cone.a(coneAlpha);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(22, 0, 10, -Math.PI * 0.42, Math.PI * 0.42);
      ctx.stroke();

      ctx.strokeStyle = ROCKET.coneOuter.a(coneAlpha * 0.75);
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
      noseGrad.addColorStop(0, ROCKET.cone.a(0.35 * bloom));
      noseGrad.addColorStop(0.5, ROCKET.coneOuter.a(0.22 * bloom));
      noseGrad.addColorStop(1, CLEAR);
      ctx.fillStyle = noseGrad;
      ctx.beginPath();
      ctx.arc(20, 0, 16 + bloom * 12, 0, Math.PI * 2);
      ctx.fill();
    }

    // Critical Overload High-Voltage Electrical Arcs (<= -$6.00 Loss)
    if (this.currentPnl <= -6.0 && !this.isDrifting && !this.reduced) {
      ctx.save();
      ctx.strokeStyle = ROCKET.arc;
      ctx.lineWidth = 1.4;
      ctx.shadowColor = ROCKET.arc;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(-15 + (Math.random() - 0.5) * 4, -4);
      ctx.lineTo(3 + (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
      ctx.lineTo(18 + (Math.random() - 0.5) * 4, 0);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }
}
