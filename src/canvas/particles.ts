import { CLEAR, PARTICLE, TEXT_HALO, font } from './theme';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  shape?: 'circle' | 'star' | 'streak' | 'coin' | 'text' | 'smoke';
  rotation?: number;
  vRot?: number;
  gravity?: number;
  text?: string;
  fontSize?: number;
}

export interface ShockwaveRing {
  x: number;
  y: number;
  radius: number;
  /** Target radius. For a collapsing ring this is smaller than the start. */
  maxRadius: number;
  color: string;
  alpha: number;
  lineWidth: number;
  /** Converges inward instead of expanding — reads as energy being absorbed. */
  collapse?: boolean;
  /** Where a collapsing ring started, so its fade can be normalised. */
  startRadius?: number;
}

export interface WarpStreak {
  x: number;
  y: number;
  length: number;
  speed: number;
  alpha: number;
  color: string;
}

export class ParticleSystem {
  public particles: Particle[] = [];
  public shockwaves: ShockwaveRing[] = [];
  public warpStreaks: WarpStreak[] = [];

  public emitThruster(
    x: number,
    y: number,
    angle: number,
    color: string = PARTICLE.thruster,
    intensity: number = 1.0
  ) {
    const count = Math.floor(2.5 * intensity);
    for (let i = 0; i < count; i++) {
      // Thrust pushes backwards relative to rocket angle
      const spread = (Math.random() - 0.5) * 0.4;
      const speed = (2.5 + Math.random() * 4.5) * intensity;
      const thrustAngle = angle + Math.PI + spread;

      this.particles.push({
        x: x + Math.cos(thrustAngle) * 4,
        y: y + Math.sin(thrustAngle) * 4,
        vx: Math.cos(thrustAngle) * speed,
        vy: Math.sin(thrustAngle) * speed,
        size: (2.5 + Math.random() * 3) * intensity,
        color,
        alpha: 0.95,
        life: 0,
        maxLife: 16 + Math.random() * 12,
        shape: Math.random() > 0.35 ? 'circle' : 'streak',
        rotation: thrustAngle,
      });
    }

    // Occasional high-speed supersonic ember spark
    if (Math.random() < 0.4 * intensity) {
      const sparkAngle = angle + Math.PI + (Math.random() - 0.5) * 0.6;
      this.particles.push({
        x,
        y,
        vx: Math.cos(sparkAngle) * (6 + Math.random() * 5) * intensity,
        vy: Math.sin(sparkAngle) * (6 + Math.random() * 5) * intensity,
        size: 1.5,
        color: PARTICLE.spark,
        alpha: 1.0,
        life: 0,
        maxLife: 10 + Math.random() * 8,
        shape: 'streak',
        rotation: sparkAngle,
      });
    }
  }

  public emitTargetHitBurst(x: number, y: number, rewardText?: string) {
    // 1. Multi-ring lucky shockwaves
    this.shockwaves.push(
      {
        x,
        y,
        radius: 6,
        maxRadius: 150,
        color: PARTICLE.ringWin,
        alpha: 1.0,
        lineWidth: 4.5,
      },
      {
        x,
        y,
        radius: 3,
        maxRadius: 105,
        color: PARTICLE.ringWinInner,
        alpha: 0.9,
        lineWidth: 3,
      },
      {
        x,
        y,
        radius: 1,
        maxRadius: 65,
        color: PARTICLE.ringWin,
        alpha: 0.8,
        lineWidth: 2,
      }
    );

    // 2. Arcade Jackpot Spinning BNB Coins (Gravity fountain arc!)
    const coinCount = 28;
    for (let i = 0; i < coinCount; i++) {
      const launchAngle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6; // Upward fountain arc
      const launchSpeed = 3.5 + Math.random() * 6.5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(launchAngle) * launchSpeed,
        vy: Math.sin(launchAngle) * launchSpeed,
        size: 4 + Math.random() * 3.5,
        color: Math.random() > 0.3 ? PARTICLE.coin : PARTICLE.coinDeep,
        alpha: 1.0,
        life: 0,
        maxLife: 45 + Math.random() * 25,
        shape: 'coin',
        rotation: Math.random() * Math.PI * 2,
        vRot: 0.15 + Math.random() * 0.25,
        gravity: 0.15, // Cascades down like an arcade payout!
      });
    }

    // 3. 360-Degree Radiant 4-Point Star Gems & Sparks
    const starCount = 42;
    for (let i = 0; i < starCount; i++) {
      const angle = (Math.PI * 2 * i) / starCount + (Math.random() - 0.5) * 0.25;
      const speed = 2.5 + Math.random() * 7;
      const isLucky = Math.random() > 0.4;

      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 3.5 + Math.random() * 4,
        color: isLucky ? PARTICLE.gem : PARTICLE.gemGold,
        alpha: 1.0,
        life: 0,
        maxLife: 35 + Math.random() * 25,
        shape: 'star',
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.2,
      });
    }

    // 4. Floating text milestones
    if (rewardText) {
      this.particles.push({
        x,
        y: y - 10,
        vx: 0.4,
        vy: -1.6,
        size: 16,
        color: PARTICLE.rewardText,
        alpha: 1.0,
        life: 0,
        maxLife: 50,
        shape: 'text',
        text: rewardText,
        fontSize: 16,
      });
    }

    this.particles.push({
      x: x + 15,
      y: y + 8,
      vx: -0.3,
      vy: -1.1,
      size: 13,
      color: PARTICLE.headlineText,
      alpha: 0.9,
      life: 0,
      maxLife: 42,
      shape: 'text',
      text: 'TARGET HIT',
      fontSize: 13,
    });
  }

  /**
   * A deliberate "cashed in" beat for a manual, profitable Hold to Cash Out —
   * distinct from emitTargetHitBurst on purpose. Reaching the exact target is
   * a bigger, separate achievement (full boom/shake/coin-fountain there); this
   * is proportionate to "chose to take the win": one ring, a modest spark
   * fan, a handful of coins, no camera shake, no screen flash, no text.
   */
  public emitCashOutSparkle(x: number, y: number) {
    this.shockwaves.push({
      x,
      y,
      radius: 4,
      maxRadius: 85,
      color: PARTICLE.ringWin,
      alpha: 0.85,
      lineWidth: 3,
    });

    const starCount = 14;
    for (let i = 0; i < starCount; i++) {
      const angle = (Math.PI * 2 * i) / starCount + (Math.random() - 0.5) * 0.3;
      const speed = 1.8 + Math.random() * 3.5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2.5 + Math.random() * 3,
        color: Math.random() > 0.5 ? PARTICLE.gem : PARTICLE.gemGold,
        alpha: 1.0,
        life: 0,
        maxLife: 24 + Math.random() * 16,
        shape: 'star',
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.15,
      });
    }

    const coinCount = 6;
    for (let i = 0; i < coinCount; i++) {
      const launchAngle = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
      const launchSpeed = 2 + Math.random() * 3.5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(launchAngle) * launchSpeed,
        vy: Math.sin(launchAngle) * launchSpeed,
        size: 3 + Math.random() * 2.5,
        color: PARTICLE.coin,
        alpha: 1.0,
        life: 0,
        maxLife: 30 + Math.random() * 16,
        shape: 'coin',
        rotation: Math.random() * Math.PI * 2,
        vRot: 0.15 + Math.random() * 0.2,
        gravity: 0.13,
      });
    }
  }

  public emitLossMist(x: number, y: number) {
    this.shockwaves.push({
      x,
      y,
      radius: 4,
      maxRadius: 65,
      color: PARTICLE.mist,
      alpha: 0.8,
      lineWidth: 2.5,
    });

    for (let i = 0; i < 22; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.8 + Math.random() * 2.2;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2.5 + Math.random() * 3.5,
        color: Math.random() > 0.5 ? PARTICLE.mist : PARTICLE.mistSoft,
        alpha: 0.7,
        life: 0,
        maxLife: 32 + Math.random() * 18,
        shape: 'circle',
      });
    }
  }

  /**
   * Continuously emits coin glints and star gems when flying in profit (+PnL)
   */
  public emitProfitCoinGlint(x: number, y: number, pnl: number) {
    const isMega = pnl >= 10;
    const count = isMega ? 2 : 1;

    for (let i = 0; i < count; i++) {
      const isCoin = Math.random() > 0.45;
      const angle = Math.PI + (Math.random() - 0.5) * 0.8;
      const speed = 2.5 + Math.random() * 4.5;

      this.particles.push({
        x: x - 15,
        y: y + (Math.random() - 0.5) * 8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed + (Math.random() - 0.5) * 1.5,
        size: isCoin ? 3.5 + Math.random() * 2.5 : 2.5 + Math.random() * 3,
        color: isCoin ? PARTICLE.coin : PARTICLE.coinShine,
        alpha: 0.95,
        life: 0,
        maxLife: 24 + Math.random() * 16,
        shape: isCoin ? 'coin' : 'star',
        rotation: Math.random() * Math.PI * 2,
        vRot: 0.2 + Math.random() * 0.25,
        gravity: 0.08,
      });
    }
  }

  /**
   * Emits billowing carbon smoke clouds and fiery friction sparks when deep in minus (-PnL)
   */
  public emitDamageSmokeAndSparks(x: number, y: number, severity: number) {
    const smokeCount = Math.min(3, Math.floor(severity));
    for (let i = 0; i < smokeCount; i++) {
      const angle = Math.PI + (Math.random() - 0.5) * 0.7;
      const speed = 1.2 + Math.random() * 2.2;
      this.particles.push({
        x: x - 18,
        y: y + (Math.random() - 0.5) * 6,
        vx: Math.cos(angle) * speed,
        vy: (Math.random() - 0.5) * 1.5 - 0.5, // slightly drifting upward
        size: 4.5 + Math.random() * 4,
        color: Math.random() > 0.4 ? PARTICLE.smoke : PARTICLE.smokeDark,
        alpha: 0.8,
        life: 0,
        maxLife: 28 + Math.random() * 18,
        shape: 'smoke',
      });
    }

    // Amber friction sparks
    const sparkCount = Math.floor(1.5 * severity);
    for (let i = 0; i < sparkCount; i++) {
      const angle = Math.PI + (Math.random() - 0.5) * 0.9;
      const speed = 4 + Math.random() * 5;
      this.particles.push({
        x: x - 18,
        y: y + (Math.random() - 0.5) * 4,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 1.8 + Math.random() * 1.5,
        color: Math.random() > 0.4 ? PARTICLE.ember : PARTICLE.emberDeep,
        alpha: 1.0,
        life: 0,
        maxLife: 14 + Math.random() * 8,
        shape: 'streak',
        rotation: angle,
      });
    }
  }

  /**
   * A hard climb. Everything else in this scene reacts to P&L *level*, which
   * means a sharp upward move looks identical to drifting up slowly. This is
   * the acceleration itself: a wide, bright cone of thrust punched backwards
   * and down, so the eye reads the kick and not just the new position.
   */
  public emitClimbBurst(
    x: number,
    y: number,
    angle: number,
    power: number,
    color: string = PARTICLE.thruster
  ) {
    const count = Math.floor(5 + power * 11);
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * 1.15;
      const a = angle + Math.PI + spread;
      const speed = (3.2 + Math.random() * 7) * (0.55 + power);
      this.particles.push({
        x: x + (Math.random() - 0.5) * 5,
        y: y + (Math.random() - 0.5) * 5,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed + 1.4 * power,
        size: (2 + Math.random() * 3.4) * (0.7 + power * 0.6),
        color: Math.random() > 0.45 ? color : PARTICLE.spark,
        alpha: 1,
        life: 0,
        maxLife: 14 + Math.random() * 14,
        shape: Math.random() > 0.4 ? 'streak' : 'circle',
        rotation: a,
      });
    }

    // A couple of white-hot flecks thrown clear of the plume for punch.
    for (let i = 0; i < 2; i++) {
      const a = angle + Math.PI + (Math.random() - 0.5) * 1.8;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * (9 + Math.random() * 7),
        vy: Math.sin(a) * (9 + Math.random() * 7),
        size: 1.6,
        color: PARTICLE.spark,
        alpha: 1,
        life: 0,
        maxLife: 9 + Math.random() * 7,
        shape: 'streak',
        rotation: a,
      });
    }
  }

  /**
   * A hard dive. Deliberately heavier and slower than the climb burst —
   * losing altitude should feel like shedding debris, not like an explosion.
   * PRD §22: a loss is clear, never punitive.
   */
  public emitDiveEmbers(
    x: number,
    y: number,
    power: number,
    palette: [string, string] = [PARTICLE.ember, PARTICLE.emberDeep]
  ) {
    const count = Math.floor(3 + power * 6);
    for (let i = 0; i < count; i++) {
      const a = Math.PI + (Math.random() - 0.5) * 1.0;
      const speed = 1.6 + Math.random() * 3.4;
      this.particles.push({
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 4,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 0.8,
        size: 1.6 + Math.random() * 2,
        color: Math.random() > 0.45 ? palette[0] : palette[1],
        alpha: 0.95,
        life: 0,
        maxLife: 20 + Math.random() * 16,
        shape: 'streak',
        rotation: a,
        gravity: 0.16 + power * 0.14,
      });
    }

    // Trailing smoke so the dive leaves a readable wake.
    const smoke = Math.floor(1 + power * 2);
    for (let i = 0; i < smoke; i++) {
      this.particles.push({
        x: x - 12,
        y: y + (Math.random() - 0.5) * 6,
        vx: -(1 + Math.random() * 1.8),
        vy: -(0.3 + Math.random() * 0.8),
        size: 4 + Math.random() * 3.5,
        color: PARTICLE.smokeDark,
        alpha: 0.55,
        life: 0,
        maxLife: 26 + Math.random() * 16,
        shape: 'smoke',
      });
    }
  }

  /**
   * Wingtip vortices. Real aircraft shed these when they pull G, and they are
   * what sells a climb as *effort* rather than translation.
   */
  public emitVortexCurl(
    x: number,
    y: number,
    angle: number,
    side: 1 | -1,
    power: number,
    color: string = PARTICLE.thruster
  ) {
    const perp = angle + (Math.PI / 2) * side;
    const back = angle + Math.PI;
    this.particles.push({
      x: x + Math.cos(perp) * 10,
      y: y + Math.sin(perp) * 10,
      vx: Math.cos(back) * (2.2 + Math.random() * 2) + Math.cos(perp) * 1.5 * power,
      vy: Math.sin(back) * (2.2 + Math.random() * 2) + Math.sin(perp) * 1.5 * power,
      size: 2.4 + Math.random() * 2.6 * power,
      color,
      alpha: 0.4 + power * 0.35,
      life: 0,
      maxLife: 18 + Math.random() * 12,
      shape: 'smoke',
    });
  }

  /** The G-force ring that snaps outward at the moment of a surge. */
  public emitGForceRing(x: number, y: number, color: string, power: number) {
    this.shockwaves.push({
      x,
      y,
      radius: 6,
      maxRadius: 34 + power * 46,
      color,
      alpha: 0.4 + power * 0.4,
      lineWidth: 1.5 + power * 2,
    });
  }

  /**
   * A spark struck off the hull plating. Every other emitter here pushes
   * backwards from the nozzle, which reads as exhaust; this one leaves along
   * the surface normal so it reads as the airframe taking a hit.
   *
   * Coordinates are world-space: the particle system renders before the rocket
   * and outside its transform, so the caller must convert.
   */
  /**
   * Sparks struck off the plating, not ejected from the tail. The read depends
   * entirely on the velocity ratio: mostly tangential — skidding backwards
   * along the skin — with only a small kick along the surface normal. Reverse
   * that and they instantly look like they are being fired out of the rocket.
   *
   * Coordinates are world-space: the particle system renders before the rocket
   * and outside its transform, so the caller must convert.
   */
  public emitHullSpark(
    x: number,
    y: number,
    nx: number,
    ny: number,
    angle: number,
    power: number
  ) {
    const back = angle + Math.PI;
    const count = 2 + Math.floor(power * 3);
    for (let i = 0; i < count; i++) {
      const skid = 1.8 + Math.random() * 3.4;
      const kick = 0.35 + Math.random() * 0.95;
      const vx = Math.cos(back) * skid + nx * kick;
      const vy = Math.sin(back) * skid + ny * kick;
      this.particles.push({
        x,
        y,
        vx,
        vy,
        size: 0.9 + Math.random() * 0.9,
        color: Math.random() > 0.35 ? PARTICLE.ember : PARTICLE.emberDeep,
        alpha: 1,
        life: 0,
        // Short, so they die before drifting far enough to read as exhaust.
        maxLife: 7 + Math.random() * 7,
        shape: 'streak',
        rotation: Math.atan2(vy, vx),
      });
    }

    // One heavier ember that tumbles clear and falls away.
    this.particles.push({
      x,
      y,
      vx: Math.cos(back) * 1.2 + nx * 1.6,
      vy: Math.sin(back) * 1.2 + ny * 1.6,
      size: 1.4,
      color: PARTICLE.emberDeep,
      alpha: 0.9,
      life: 0,
      maxLife: 20 + Math.random() * 12,
      shape: 'streak',
      rotation: Math.atan2(ny, nx),
      gravity: 0.09,
    });
  }

  /**
   * Milestone ring. A tier gained collapses INWARD onto the hull, a tier given
   * back expands away from it — so the two are never read as the same event.
   */
  public emitTierRing(x: number, y: number, color: string, gained: boolean) {
    if (gained) {
      this.shockwaves.push({
        x,
        y,
        radius: 56,
        startRadius: 56,
        maxRadius: 12,
        color,
        alpha: 0.9,
        lineWidth: 3,
        collapse: true,
      });
      return;
    }
    this.shockwaves.push({
      x,
      y,
      radius: 8,
      maxRadius: 52,
      color,
      alpha: 0.5,
      lineWidth: 2,
    });
  }

  public triggerWarpStreaks(width: number, height: number) {
    this.warpStreaks = [];
    for (let i = 0; i < 35; i++) {
      this.warpStreaks.push({
        x: Math.random() * width,
        y: Math.random() * height,
        length: 40 + Math.random() * 120,
        speed: 16 + Math.random() * 22,
        alpha: 0.85,
        color: PARTICLE.warp,
      });
    }
  }

  public update() {
    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;

      // Apply downward physical gravity for coin fountains
      if (p.gravity) {
        p.vy += p.gravity;
      }

      // Billowing smoke puffs expand and decelerate
      if (p.shape === 'smoke') {
        p.size += 0.16;
        p.vx *= 0.94;
        p.vy *= 0.94;
      }

      p.life++;
      p.alpha = Math.max(0, 1 - p.life / p.maxLife);

      if (p.vRot) {
        p.rotation = (p.rotation || 0) + p.vRot;
      }

      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
      }
    }

    // Update shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];

      if (s.collapse) {
        // Converges on the target radius and brightens as it arrives, then
        // pops. The shared expanding path below would cull it on frame one,
        // since its alpha term assumes radius grows toward maxRadius.
        const start = s.startRadius ?? s.radius;
        s.radius += (s.maxRadius - s.radius) * 0.22 - 0.8;
        const travelled = (start - s.radius) / Math.max(1, start - s.maxRadius);
        s.alpha = Math.max(0, 1 - Math.pow(travelled, 3));
        if (s.radius <= s.maxRadius + 1 || s.alpha <= 0.02) {
          this.shockwaves.splice(i, 1);
        }
        continue;
      }

      s.radius += (s.maxRadius - s.radius) * 0.14 + 1.4;
      s.alpha = Math.max(0, 1 - s.radius / s.maxRadius);

      if (s.radius >= s.maxRadius || s.alpha <= 0.02) {
        this.shockwaves.splice(i, 1);
      }
    }

    // Update warp streaks
    for (let i = this.warpStreaks.length - 1; i >= 0; i--) {
      const w = this.warpStreaks[i];
      w.x -= w.speed;
      w.alpha *= 0.93;

      if (w.alpha < 0.05 || w.x + w.length < 0) {
        this.warpStreaks.splice(i, 1);
      }
    }
  }

  public render(ctx: CanvasRenderingContext2D) {
    ctx.save();

    // Render shockwaves
    for (const s of this.shockwaves) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(0.1, s.radius), 0, Math.PI * 2);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.lineWidth;
      ctx.globalAlpha = s.alpha;
      ctx.stroke();
    }

    // Render warp streaks
    for (const w of this.warpStreaks) {
      ctx.beginPath();
      ctx.moveTo(w.x, w.y);
      ctx.lineTo(w.x - w.length, w.y);
      ctx.strokeStyle = w.color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = w.alpha;
      ctx.stroke();
    }

    // Render particles
    for (const p of this.particles) {
      ctx.globalAlpha = p.alpha;

      if (p.shape === 'star') {
        ctx.fillStyle = p.color;
        this.drawStar(ctx, p.x, p.y, 4, p.size, p.size * 0.35, p.rotation || 0);
      } else if (p.shape === 'coin') {
        // Spinning golden BNB coin
        const rot = p.rotation || 0;
        const scaleY = Math.max(0.12, Math.abs(Math.sin(rot)));
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * scaleY, 0, 0, Math.PI * 2);
        ctx.fill();

        // Shiny inner coin rim
        ctx.strokeStyle = PARTICLE.coinShine;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 0.75, p.size * 0.75 * scaleY, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (p.shape === 'streak') {
        // High-velocity directional spark streak
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        const angle = p.rotation || 0;
        const len = p.size * 3.5;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - Math.cos(angle) * len, p.y - Math.sin(angle) * len);
        ctx.stroke();
      } else if (p.shape === 'text' && p.text) {
        // Floating Arcade Milestone Text
        ctx.save();
        ctx.font = font(p.fontSize || 14);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = TEXT_HALO;
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
      } else if (p.shape === 'smoke') {
        // Billowing carbon smoke puff with soft feathered edge
        ctx.save();
        const smokeGrad = ctx.createRadialGradient(p.x, p.y, p.size * 0.2, p.x, p.y, p.size);
        smokeGrad.addColorStop(0, p.color);
        smokeGrad.addColorStop(1, CLEAR);
        ctx.fillStyle = smokeGrad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        // Circle
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private drawStar(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    spikes: number,
    outerRadius: number,
    innerRadius: number,
    rot: number
  ) {
    let rotAngle = (Math.PI / 2) * 3 + rot;
    let x = cx;
    let y = cy;
    const step = Math.PI / spikes;

    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rotAngle) * outerRadius, cy + Math.sin(rotAngle) * outerRadius);
    for (let i = 0; i < spikes; i++) {
      x = cx + Math.cos(rotAngle) * outerRadius;
      y = cy + Math.sin(rotAngle) * outerRadius;
      ctx.lineTo(x, y);
      rotAngle += step;

      x = cx + Math.cos(rotAngle) * innerRadius;
      y = cy + Math.sin(rotAngle) * innerRadius;
      ctx.lineTo(x, y);
      rotAngle += step;
    }
    ctx.lineTo(cx + Math.cos(rotAngle) * outerRadius, cy + Math.sin(rotAngle) * outerRadius);
    ctx.closePath();
    ctx.fill();
  }
}
