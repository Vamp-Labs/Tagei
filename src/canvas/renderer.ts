import { PriceTick, AssetSymbol } from '../types/market';
import { ActiveTradeRound, LastRoundSummary, PositionDirection } from '../types/game';
import { formatAmount, formatPrice } from '../ui/lucky/format';
import {
  CLEAR,
  LABEL_FONT,
  MARKER,
  STAGE,
  TEXT_HALO,
  TextMemo,
  boomStep,
  type TrackScheme,
} from './theme';

interface Star {
  x: number;
  y: number;
  size: number;
  alpha: number;
  speed: number;
  twinkleSpeed: number;
  tint: string;
}

export interface MarkerLabels {
  target: string;
  stop: string;
}

const TAG_HEIGHT = 22;
const TAG_PAD_X = 8;
const TAG_RADIUS = 6;
const ZONE_TRI = 5;
const ZONE_LABEL_X = 20;
export const PNL_TRACKER_LIFT = 34;
const TRACKER_CLEARANCE = 26;

export class MarketTrackRenderer {
  private stars: Star[] = [];
  private time: number = 0;
  private reduced: boolean = false;
  private readonly entryTag = new TextMemo((v) => `ENTRY ${formatPrice(v)}`);
  private readonly deltaTag = new TextMemo((v) => formatAmount(v));
  private readonly targetFallback = new TextMemo((v) => `TARGET ${formatPrice(v)}`);
  private readonly stopFallback = new TextMemo((v) => `STOP ${formatPrice(v)}`);
  private readonly lastPlayTag = new TextMemo((v) => `YOUR PLAY ${formatAmount(v)}`);

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
        tint: Math.random() < STAGE.starTintShare ? STAGE.starTint : STAGE.star,
      });
    }
  }

  /**
   * Renders the blue lobby stage:
   * lobby gradient, parallax twinkling stars, subtle horizon glow, and grid lines
   */
  public renderBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    reducedMotion: boolean = false,
    _asset: AssetSymbol = 'BNB',
    // 0..1, decaying — the win boom. Tints every layer below toward lucky
    // rather than drawing a shape on top, so the stage itself reads as
    // reacting instead of something being overlaid on an unchanged scene.
    boom: number = 0
  ) {
    this.time += 0.016;
    this.reduced = reducedMotion;
    const step = boomStep(boom);

    // 1. Lobby gradient — starts on the header's lobby blue so the frame has no seam
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, STAGE.top[step]);
    bgGrad.addColorStop(STAGE.midStop, STAGE.mid[step]);
    bgGrad.addColorStop(1, STAGE.bottom[step]);
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

      ctx.fillStyle = boom > 0.15 ? STAGE.star : star.tint;
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
    ambientGrad.addColorStop(0, STAGE.ambientCore[step]);
    ambientGrad.addColorStop(0.5, STAGE.ambientEdge[step]);
    ambientGrad.addColorStop(1, CLEAR);
    ctx.fillStyle = ambientGrad;
    ctx.beginPath();
    ctx.arc(glowX, glowY, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    // 4. Horizontal grid lines — a faint lucky wash on a win,
    //    so the boom reaches every layer of the background stack
    ctx.strokeStyle = boom > 0.05 ? STAGE.gridBoom.a(0.025 + boom * 0.05) : STAGE.grid;
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
   * Renders the continuous spline track
   */
  public renderTrack(
    ctx: CanvasRenderingContext2D,
    points: { x: number; y: number }[],
    _width: number,
    height: number,
    colorScheme: TrackScheme
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
    fillGrad.addColorStop(0.8, CLEAR);
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // 2. Spline stroke
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

    // Outer glow
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

  private zoneLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    color: string,
    x: number,
    baseline: number,
    pointsUp: boolean
  ) {
    this.haloText(ctx, text, x + ZONE_TRI * 2 + 6, baseline, color);

    const cx = x + ZONE_TRI;
    const cy = baseline - 5;
    ctx.beginPath();
    if (pointsUp) {
      ctx.moveTo(cx - ZONE_TRI, cy + ZONE_TRI * 0.8);
      ctx.lineTo(cx + ZONE_TRI, cy + ZONE_TRI * 0.8);
      ctx.lineTo(cx, cy - ZONE_TRI * 0.8);
    } else {
      ctx.moveTo(cx - ZONE_TRI, cy - ZONE_TRI * 0.8);
      ctx.lineTo(cx + ZONE_TRI, cy - ZONE_TRI * 0.8);
      ctx.lineTo(cx, cy + ZONE_TRI * 0.8);
    }
    ctx.closePath();
    ctx.fill();
  }

  private haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = TEXT_HALO;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /**
   * Renders Pre-Trade / Live Trade markers:
   * Profit Zone, Stop Zone, Entry line and tag, Target beacon, Stop marker, and Live Delta
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
    currentPnl: number = 0,
    labels?: MarkerLabels
  ) {
    ctx.save();
    ctx.font = LABEL_FONT;
    ctx.textBaseline = 'alphabetic';

    // 1. Shaded PROFIT ZONE & STOP ZONE
    const isLong = direction === 'LONG';
    const profitTop = Math.min(entryY, targetY);
    const profitBottom = Math.max(entryY, targetY);
    const profitHeight = Math.max(2, profitBottom - profitTop);

    const lossTop = Math.min(entryY, stopLossY);
    const lossBottom = Math.max(entryY, stopLossY);
    const lossHeight = Math.max(2, lossBottom - lossTop);

    const profitGrad = ctx.createLinearGradient(
      0,
      isLong ? profitTop : profitBottom,
      0,
      isLong ? profitBottom : profitTop
    );
    profitGrad.addColorStop(0, MARKER.profitZoneNear);
    profitGrad.addColorStop(1, MARKER.profitZoneFar);
    ctx.fillStyle = profitGrad;
    ctx.fillRect(0, profitTop, width, profitHeight);

    const lossGrad = ctx.createLinearGradient(
      0,
      isLong ? lossBottom : lossTop,
      0,
      isLong ? lossTop : lossBottom
    );
    lossGrad.addColorStop(0, MARKER.stopZoneNear);
    lossGrad.addColorStop(1, MARKER.stopZoneFar);
    ctx.fillStyle = lossGrad;
    ctx.fillRect(0, lossTop, width, lossHeight);

    this.zoneLabel(ctx, 'PROFIT ZONE', MARKER.profitLabel, ZONE_LABEL_X, (profitTop + profitBottom) / 2 + 5, isLong);
    this.zoneLabel(ctx, 'STOP ZONE', MARKER.stopLabel, ZONE_LABEL_X, (lossTop + lossBottom) / 2 + 5, !isLong);

    // 2. ENTRY baseline, ring and tag
    ctx.strokeStyle = MARKER.entryLine;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(10, entryY);
    ctx.lineTo(width - 10, entryY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = MARKER.entry;
    ctx.beginPath();
    ctx.arc(22, entryY, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = MARKER.entryRing;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(22, entryY, 7, 0, Math.PI * 2);
    ctx.stroke();

    const entry = this.entryTag.update(ctx, entryPrice, LABEL_FONT);
    ctx.fillStyle = MARKER.tagBg;
    ctx.strokeStyle = MARKER.entry;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(32, entryY - TAG_HEIGHT / 2, entry.width + TAG_PAD_X * 2, TAG_HEIGHT, TAG_RADIUS);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = MARKER.tagText;
    ctx.fillText(entry.text, 32 + TAG_PAD_X, entryY + 4.5);

    // 3. Live vertical delta bracket
    const deltaHeight = Math.abs(rocketY - entryY);
    if (deltaHeight > 4) {
      const isProfit = currentPnl >= 0;
      const deltaColor = isProfit ? MARKER.profit : MARKER.loss;

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
      if (Math.abs(badgeY - (rocketY - PNL_TRACKER_LIFT)) >= TRACKER_CLEARANCE) {
        const delta = this.deltaTag.update(ctx, currentPnl, LABEL_FONT);
        const badgeW = delta.width + TAG_PAD_X * 2;
        const badgeX = Math.min(width - badgeW - 8, rocketX + 12);

        ctx.fillStyle = MARKER.tagBg;
        ctx.strokeStyle = deltaColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(badgeX, badgeY - TAG_HEIGHT / 2, badgeW, TAG_HEIGHT, TAG_RADIUS);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = deltaColor;
        ctx.fillText(delta.text, badgeX + TAG_PAD_X, badgeY + 4.5);
      }
      ctx.restore();
    }

    // 4. Target beacon
    const isClose = targetProgressPct >= 75;
    const isVeryClose = targetProgressPct >= 90;
    const isLock = targetProgressPct >= 98;

    const pulseScale = this.reduced
      ? 1
      : isVeryClose
        ? 1 + Math.sin(this.time * 18) * 0.35
        : 1 + Math.sin(this.time * 6) * 0.15;

    ctx.strokeStyle = isClose ? MARKER.targetLineClose : MARKER.targetLine;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(10, targetY);
    ctx.lineTo(width - 10, targetY);
    ctx.stroke();
    ctx.setLineDash([]);

    const beaconX = width - 40;
    ctx.strokeStyle = MARKER.target;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(beaconX, targetY, 8 * pulseScale, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = MARKER.target;
    ctx.beginPath();
    ctx.arc(beaconX, targetY, 3, 0, Math.PI * 2);
    ctx.fill();

    const targetText = labels ? labels.target : this.targetFallback.update(ctx, targetPrice, LABEL_FONT).text;
    this.haloText(ctx, targetText, 20, targetY - 8, MARKER.target);

    // 98% Proximity Lock Beam
    if (isLock) {
      ctx.strokeStyle = MARKER.target;
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(rocketX, rocketY);
      ctx.lineTo(beaconX, targetY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 5. Stop line & dot marker
    ctx.strokeStyle = MARKER.stopLine;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(10, stopLossY);
    ctx.lineTo(width - 10, stopLossY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = MARKER.stop;
    ctx.beginPath();
    ctx.arc(beaconX, stopLossY, 4, 0, Math.PI * 2);
    ctx.fill();

    const stopText = labels ? labels.stop : this.stopFallback.update(ctx, stopLossPrice, LABEL_FONT).text;
    this.haloText(ctx, stopText, 20, stopLossY + 18, MARKER.stop);

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
    const color = isLong ? MARKER.pathLong : MARKER.pathShort;
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
    const color = isWin ? MARKER.profit : MARKER.loss;

    ctx.save();
    ctx.strokeStyle = isWin ? MARKER.lastWinRing : MARKER.lastLossRing;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = isWin ? MARKER.lastWinStem : MARKER.lastLossStem;
    ctx.setLineDash([2, 2]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 20);
    ctx.stroke();
    ctx.setLineDash([]);

    const tag = this.lastPlayTag.update(ctx, summary.pnl, LABEL_FONT);
    const badgeW = tag.width + TAG_PAD_X * 2;
    const badgeH = TAG_HEIGHT + 2;
    const badgeX = x - badgeW / 2;
    const badgeY = y - 20 - badgeH;

    ctx.fillStyle = MARKER.tagBgSoft;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, TAG_RADIUS);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(tag.text, badgeX + TAG_PAD_X, badgeY + badgeH / 2 + 4.5);

    ctx.restore();
  }
}
