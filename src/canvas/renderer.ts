import { PriceTick, AssetSymbol } from '../types/market';
import { ActiveTradeRound, LastRoundSummary, PositionDirection } from '../types/game';

interface Star {
  x: number;
  y: number;
  size: number;
  alpha: number;
  speed: number;
  twinkleSpeed: number;
}

interface Star {
  x: number;
  y: number;
  size: number;
  alpha: number;
  speed: number;
  twinkleSpeed: number;
}

export class MarketTrackRenderer {
  private stars: Star[] = [];
  private time: number = 0;

  constructor() {
    this.initStars(140);
  }

  private initStars(count: number) {
    this.stars = [];
    for (let i = 0; i < count; i++) {
      this.stars.push({
        x: Math.random(),
        y: Math.random(),
        size: 0.8 + Math.random() * 2.2,
        alpha: 0.2 + Math.random() * 0.8,
        speed: 0.00015 + Math.random() * 0.00045,
        twinkleSpeed: 0.02 + Math.random() * 0.06,
      });
    }
  }

  /**
   * Renders clean deep-space background:
   * Cosmic void gradient, parallax twinkling stars, subtle horizon glow, and grid lines
   */
  public renderBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    reducedMotion: boolean = false,
    _asset: AssetSymbol = 'BNB',
    // 0..1, decaying — the win boom. Warms every layer below rather than
    // drawing a shape on top, so the background itself reads as reacting
    // instead of something being overlaid on an unchanged scene.
    boom: number = 0
  ) {
    this.time += 0.016;

    // 1. Deep Cosmic Void Gradient — warms toward gold/emerald on a win
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, `rgb(${4 + boom * 44}, ${7 + boom * 26}, ${17 - boom * 6})`);
    bgGrad.addColorStop(0.55, `rgb(${7 + boom * 18}, ${11 + boom * 40}, ${25 + boom * 8})`);
    bgGrad.addColorStop(1, `rgb(${14 + boom * 10}, ${21 + boom * 46}, ${46 + boom * 12})`);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // 2. Parallax Starfield — flares brighter and bigger on a win
    const starAlphaMul = 1 + boom * 0.7;
    const starSizeMul = 1 + boom * 1.6;
    for (const star of this.stars) {
      if (!reducedMotion) {
        star.x -= star.speed;
        if (star.x < 0) star.x = 1.0;
      }

      const twinkle = reducedMotion ? 1 : Math.sin(this.time * 60 * star.twinkleSpeed);
      const currentAlpha = Math.max(
        0.1,
        Math.min(1, (star.alpha + twinkle * 0.25) * starAlphaMul)
      );

      ctx.fillStyle = boom > 0.15 ? '#FFF3D6' : '#FFFFFF';
      ctx.globalAlpha = currentAlpha;
      ctx.beginPath();
      ctx.arc(star.x * width, star.y * height, star.size * starSizeMul, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // 3. Subtle Ambient Horizon Glow at bottom right — surges on a win
    const glowX = width * 0.85;
    const glowY = height * 0.95;
    const glowRadius = width * (0.35 + boom * 0.28);
    const ambientGrad = ctx.createRadialGradient(
      glowX,
      glowY,
      glowRadius * 0.2,
      glowX,
      glowY,
      glowRadius
    );
    ambientGrad.addColorStop(
      0,
      `rgba(${boom * 240}, ${240 - boom * 55}, ${255 - boom * 100}, ${0.05 + boom * 0.22})`
    );
    ambientGrad.addColorStop(
      0.5,
      `rgba(${boom * 240}, ${255 - boom * 4}, ${163 - boom * 80}, ${0.02 + boom * 0.12})`
    );
    ambientGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = ambientGrad;
    ctx.beginPath();
    ctx.arc(glowX, glowY, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    // 4. Subtle horizontal celestial grid lines — faint gold wash on a win,
    //    so the boom reaches every layer of the background stack
    ctx.strokeStyle =
      boom > 0.05
        ? `rgba(240, 185, 11, ${0.025 + boom * 0.05})`
        : 'rgba(255, 255, 255, 0.025)';
    ctx.lineWidth = 1;
    const gridStep = height / 6;
    for (let y = gridStep; y < height; y += gridStep) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  /**
   * Transforms price history to 2D viewport coordinates
   */
  public calculateScreenPoints(
    history: PriceTick[],
    width: number,
    height: number,
    activeRound: ActiveTradeRound | null
  ): { x: number; y: number; price: number }[] {
    if (history.length < 2) return [];

    let minPrice = Infinity;
    let maxPrice = -Infinity;

    for (const tick of history) {
      if (tick.price < minPrice) minPrice = tick.price;
      if (tick.price > maxPrice) maxPrice = tick.price;
    }

    if (activeRound) {
      minPrice = Math.min(minPrice, activeRound.stopLossPrice, activeRound.targetPrice);
      maxPrice = Math.max(maxPrice, activeRound.stopLossPrice, activeRound.targetPrice);
    }

    const span = Math.max(minPrice * 0.004, maxPrice - minPrice);
    const paddedMin = minPrice - span * 0.18;
    const paddedMax = maxPrice + span * 0.18;
    const paddedSpan = paddedMax - paddedMin;

    const topPad = height * 0.14;
    const bottomPad = height * 0.36; // Preserves space for floating cockpit HUD
    const usableHeight = height - topPad - bottomPad;
    const usableWidth = width * 0.78; // Leave right 22% for the rocket head & target planet

    const count = history.length;
    const points = history.map((tick, i) => {
      const x = (i / (count - 1)) * usableWidth;
      const normalizedY = 1 - (tick.price - paddedMin) / paddedSpan;
      const y = topPad + normalizedY * usableHeight;
      return { x, y, price: tick.price };
    });

    return points;
  }

  public priceToY(
    price: number,
    history: PriceTick[],
    height: number,
    activeRound: ActiveTradeRound | null
  ): number {
    let minPrice = Infinity;
    let maxPrice = -Infinity;

    for (const tick of history) {
      if (tick.price < minPrice) minPrice = tick.price;
      if (tick.price > maxPrice) maxPrice = tick.price;
    }

    if (activeRound) {
      minPrice = Math.min(minPrice, activeRound.stopLossPrice, activeRound.targetPrice);
      maxPrice = Math.max(maxPrice, activeRound.stopLossPrice, activeRound.targetPrice);
    }

    const span = Math.max(minPrice * 0.004, maxPrice - minPrice);
    const paddedMin = minPrice - span * 0.18;
    const paddedMax = maxPrice + span * 0.18;
    const paddedSpan = paddedMax - paddedMin;

    const topPad = height * 0.14;
    const bottomPad = height * 0.36; // Preserves space for floating cockpit HUD
    const usableHeight = height - topPad - bottomPad;

    const normalizedY = 1 - (price - paddedMin) / paddedSpan;
    return topPad + normalizedY * usableHeight;
  }

  /**
   * Renders the glowing continuous spline track
   */
  public renderTrack(
    ctx: CanvasRenderingContext2D,
    points: { x: number; y: number }[],
    _width: number,
    height: number,
    colorScheme: { stroke: string; glow: string; fill: string }
  ) {
    if (points.length < 2) return;

    ctx.save();

    // 1. Fill gradient beneath track
    ctx.beginPath();
    ctx.moveTo(points[0].x, height);
    ctx.lineTo(points[0].x, points[0].y);

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;
      ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.lineTo(last.x, height);
    ctx.closePath();

    const fillGrad = ctx.createLinearGradient(0, 0, 0, height);
    fillGrad.addColorStop(0, colorScheme.fill);
    fillGrad.addColorStop(0.8, 'transparent');
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // 2. Glowing Neon Spline Stroke
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;
      ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
    }
    ctx.lineTo(last.x, last.y);

    // Outer neon glow
    ctx.strokeStyle = colorScheme.glow;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Crisp inner line
    ctx.strokeStyle = colorScheme.stroke;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Renders Pre-Trade / Live Trade markers:
   * Profit Zone, Loss Zone, Entry Radar Crosshair, Target Destination Planet, Stop Loss Singularity, and Live Delta
   */
  public renderMarkers(
    ctx: CanvasRenderingContext2D,
    width: number,
    entryY: number,
    targetY: number,
    stopLossY: number,
    entryPrice: number,
    targetPrice: number,
    stopLossPrice: number,
    targetProgressPct: number,
    rocketX: number,
    rocketY: number,
    direction: PositionDirection = 'LONG',
    currentPnl: number = 0
  ) {
    ctx.save();
    ctx.font = 'bold 10px "JetBrains Mono", monospace';

    // 1. Shaded PROFIT ZONE & LOSS ZONE
    const isLong = direction === 'LONG';
    const profitTop = Math.min(entryY, targetY);
    const profitBottom = Math.max(entryY, targetY);
    const profitHeight = Math.max(2, profitBottom - profitTop);

    const lossTop = Math.min(entryY, stopLossY);
    const lossBottom = Math.max(entryY, stopLossY);
    const lossHeight = Math.max(2, lossBottom - lossTop);

    // Render Profit Zone (Emerald Neon Glow)
    const profitGrad = ctx.createLinearGradient(
      0,
      isLong ? profitTop : profitBottom,
      0,
      isLong ? profitBottom : profitTop
    );
    profitGrad.addColorStop(0, 'rgba(0, 255, 163, 0.14)');
    profitGrad.addColorStop(1, 'rgba(0, 255, 163, 0.02)');
    ctx.fillStyle = profitGrad;
    ctx.fillRect(0, profitTop, width, profitHeight);

    ctx.fillStyle = 'rgba(0, 255, 163, 0.55)';
    ctx.fillText('▲ +PROFIT ZONE', width - 110, isLong ? profitTop + 14 : profitBottom - 6);

    // Render Loss Zone (Crimson Glow)
    const lossGrad = ctx.createLinearGradient(
      0,
      isLong ? lossBottom : lossTop,
      0,
      isLong ? lossTop : lossBottom
    );
    lossGrad.addColorStop(0, 'rgba(255, 0, 85, 0.14)');
    lossGrad.addColorStop(1, 'rgba(255, 0, 85, 0.02)');
    ctx.fillStyle = lossGrad;
    ctx.fillRect(0, lossTop, width, lossHeight);

    ctx.fillStyle = 'rgba(255, 0, 85, 0.55)';
    ctx.fillText('▼ -STOP LOSS', width - 96, isLong ? lossBottom - 6 : lossTop + 14);

    // 2. High-Contrast ENTRY Baseline & Radar Beacon
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.75)';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(10, entryY);
    ctx.lineTo(width - 10, entryY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Entry radar beacon crosshair
    ctx.fillStyle = '#FFD21E';
    ctx.beginPath();
    ctx.arc(22, entryY, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(22, entryY, 7, 0, Math.PI * 2);
    ctx.stroke();

    // Entry price tag
    ctx.fillStyle = '#070b19';
    ctx.strokeStyle = '#FFD21E';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(32, entryY - 9, 105, 18, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FFD21E';
    ctx.fillText(`ENTRY $${entryPrice.toFixed(2)}`, 38, entryY + 4);

    // 3. Dynamic Live Vertical Delta Measurement Bracket
    const deltaHeight = Math.abs(rocketY - entryY);
    if (deltaHeight > 4) {
      const isProfit = currentPnl >= 0;
      const deltaColor = isProfit ? '#00E89A' : '#FF3B6B';

      ctx.save();
      ctx.strokeStyle = deltaColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);

      ctx.beginPath();
      ctx.moveTo(rocketX, entryY);
      ctx.lineTo(rocketX, rocketY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(rocketX - 5, entryY);
      ctx.lineTo(rocketX + 5, entryY);
      ctx.moveTo(rocketX - 5, rocketY);
      ctx.lineTo(rocketX + 5, rocketY);
      ctx.stroke();

      const badgeY = (entryY + rocketY) / 2;
      const badgeX = Math.min(width - 95, rocketX + 16);

      ctx.fillStyle = '#070b19';
      ctx.strokeStyle = deltaColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(badgeX - 4, badgeY - 11, 88, 20, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = deltaColor;
      ctx.fillText(
        `${isProfit ? '+' : ''}$${currentPnl.toFixed(2)} ${isProfit ? '▲' : '▼'}`,
        badgeX,
        badgeY + 3
      );
      ctx.restore();
    }

    // 4. Target Level Beacon
    const isClose = targetProgressPct >= 75;
    const isVeryClose = targetProgressPct >= 90;
    const isLock = targetProgressPct >= 98;

    const pulseScale = isVeryClose ? 1 + Math.sin(this.time * 18) * 0.35 : 1 + Math.sin(this.time * 6) * 0.15;
    const targetColor = isClose ? '#00E89A' : '#F0B90B';

    ctx.strokeStyle = `${targetColor}88`;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(10, targetY);
    ctx.lineTo(width - 10, targetY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Sleek Target Beacon Ring at right edge
    const beaconX = width - 40;
    ctx.save();
    ctx.strokeStyle = targetColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(beaconX, targetY, 8 * pulseScale, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = targetColor;
    ctx.beginPath();
    ctx.arc(beaconX, targetY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = targetColor;
    ctx.fillText(`TARGET WIN +$18.40 ($${targetPrice.toFixed(2)})`, 20, targetY - 6);

    // 98% Proximity Lock Beam
    if (isLock) {
      ctx.strokeStyle = '#00E89A';
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(rocketX, rocketY);
      ctx.lineTo(beaconX, targetY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 5. Stop Loss Line & Clean Dot Marker
    ctx.strokeStyle = 'rgba(255, 0, 85, 0.7)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(10, stopLossY);
    ctx.lineTo(width - 10, stopLossY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#FF3B6B';
    ctx.beginPath();
    ctx.arc(beaconX, stopLossY, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FF3B6B';
    ctx.fillText(`STOP LOSS -$10.00 ($${stopLossPrice.toFixed(2)})`, 20, stopLossY + 12);

    ctx.restore();
  }

  /**
   * Renders projected path for selected direction (PRD §14)
   */
  public renderProjectedPath(
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    direction: PositionDirection
  ) {
    ctx.save();
    const isLong = direction === 'LONG';
    const color = isLong ? '#00E89A' : '#FF3B6B';
    const angle = isLong ? -0.28 : 0.28;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.globalAlpha = 0.65;

    const length = 55;
    const endX = startX + Math.cos(angle) * length;
    const endY = startY + Math.sin(angle) * length;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(endX, endY, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * Renders the Last Round summary marker on Home track (PRD §31)
   */
  public renderLastRoundMarker(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    summary: LastRoundSummary
  ) {
    const isWin = summary.outcome === 'win' || summary.pnl >= 0;
    const color = isWin ? '#00E89A' : '#FF3B6B';

    ctx.save();
    // Glowing pulse ring
    ctx.strokeStyle = `${color}66`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.stroke();

    // Solid core dot
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();

    // Vertical dashed connector line to tag
    ctx.strokeStyle = `${color}99`;
    ctx.setLineDash([2, 2]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 20);
    ctx.stroke();
    ctx.setLineDash([]);

    // Callout pill badge
    const badgeW = 104;
    const badgeH = 22;
    const badgeX = x - badgeW / 2;
    const badgeY = y - 20 - badgeH;

    ctx.fillStyle = 'rgba(7, 11, 25, 0.92)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(
      `YOUR PLAY: ${summary.pnl >= 0 ? '+' : ''}$${summary.pnl.toFixed(2)}`,
      x,
      badgeY + 14
    );

    ctx.restore();
  }
}
