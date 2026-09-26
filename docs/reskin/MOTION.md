## Motion spec: BNB PLAY on Lucky Games

**Personality:** glossy game show, run with a calm fintech hand (80/20).
The sheets glide and the numbers stay steady. Only the hot CTA and the few real payoff moments get any bounce.
Motion always points at the market, never at the chrome. After a loss, nothing performs.

**Library:** Motion (`motion/react`) runs all DOM choreography. CSS keyframes in `src/index.css` run `pulseGlow`, `ringExpand`, `slideDown` and `slideLeft`. The canvas rAF loop (`src/canvas/**`) runs the world FX.

**Locked:** every duration, spring, stagger, drag threshold and hold time stays as it is:
- Springs: MICRO {700/30/0.5}, STANDARD {420/38/0.9}, HERO {180/22/1.1}.
- Eases: `EASE_OUT` [0.16,1,0.3,1]; `POP_EASE` [0.34,1.56,0.64,1] at 320 ms.
- Staggers: 0.06/0.04 on the result and 0.07/0.05 on the win banner.
- Hold: `holdMs` 400, slip 24 px, cancel 150 ms, burst 320 ms.
- Swipe dismiss: `DISMISS_OFFSET` 120 and `DISMISS_VELOCITY` 500.
- Keyframes: `pulseGlow` 1.1 s ×1, `ringExpand` 0.6 s, `slideDown` 0.35 s, `slideLeft` 0.3 s.
- Numbers: XP count 800 ms, price bump 280 ms, chevron bob 1.6 s, PIX line 2000 ms, mission toast about 2 s.

Only colour, glow token and ease choice change, plus the few overshoot and loop removals listed below. No timing value changes.

### Easing palette (existing values, no new curves)
| Token | Use | Motion |
|---|---|---|
| out | entrances, loss-side number changes | `EASE_OUT` [0.16,1,0.3,1] |
| pop | gains only: win badge children, P&L gain juice, XP pill | `POP_EASE` [0.34,1.56,0.64,1] |
| snap / panel / hero | feedback / sheets / payoff | MICRO / STANDARD / HERO springs |
| scrub | hold progress, canvas interpolation | `linear` (the existing hold `animate`) |

### 1. Tier mapping
| Tier | Lucky usage |
|---|---|
| **MICRO** | Presses on Button, RewardTile, SegmentedTabs and chips. Amount count-up (§13). Asset or leverage chip selection. PIX bubble in and out. Every sheet, scrim and banner exit. Hold-cancel snap-back. Live-dot state change. Selected-row check fill. |
| **STANDARD** | Sheet rise (`Sheet.tsx`), scrims, ActivePositionBanner, MissionToast, SettingsModal (`cardVariants`), profile drawer, LaunchCountdown container, settlement step swaps, Home→Pre-Trade morph (§8), LONG/SHORT selection wash. |
| **HERO** | Launch (§15), TARGET_HIT banner, LOSS_HIT card, ResultPanel card rise, level-up reveal. |

### 2. Choreography
Every row reuses the timing already in the code; only colour, glow and property changes are new. Reduced motion means `useReducedMotion()` plus the global CSS kill. What remains must be the finished final state or an opacity-only fade of 200 ms or less.

| Screen | Elements → motion | Token | Reduced motion |
|---|---|---|---|
| Landing (01) | Hero stage settles, then HeroCard gets `lift`, then the hot "CONNECT WALLET!" pulses once | STANDARD, `pulseGlow` ×1 | Static; no pulse |
| Home (02) | Price bump 1→1.04→1 in 280 ms. "PLAY NOW!" pulses once. The chevron bob loops (1.6 s). The active-position banner uses `slideDown`. | MICRO, STANDARD | No bump, no bob, banner fades |
| Asset selector (03) | The sheet rises. The selected tile gets `glow-lucky` and a check (MICRO). The price re-counts. | STANDARD / MICRO | Instant select; the sheet fades |
| Trade setup (08) | Copy fades, asset chips slide down, and the panel rises (§8, 350–500 ms). The LONG (lucky) or SHORT (info) wash uses MICRO. The amount counts. "HOLD TO LAUNCH!" pulses once, only when a direction is set. | STANDARD, MICRO | Crossfade; amounts snap |
| Hold (any hot CTA) | Ring stroke draws over 400 ms linear. The glow `drop-shadow` grows as the hold fills. Scale creeps to 1.015. A white release burst plays for 320 ms. | linear, `POP_EASE` | Already gated: no ring, no scale, no burst; commit is instant |
| Launch (§15) | Controls fade down, the entry locks (info), and `ringExpand` goes out from the entry in `info`. The existing `animate-ping` ring and the `animate-bounce` rocket icon are removed. | HERO, `ringExpand` | One static "ENTRY LOCKED" frame, then Live |
| Live (09) | The live dot pulses (lucky). P&L gains use the `pop` 320 ms juice; losses use the same 320 ms on `out` with no overshoot. HUD pills stay static. "HOLD TO CASH OUT!" pulses once. | MICRO | Numbers snap; the dot is solid |
| Outcome win (11) | The badge appears, then the number, then the payout line (stagger 0.07/0.05). A lucky bloom plays behind them (0.55 s). The `text-glow-green` class is removed from the number. | HERO + `pop` | Card fades in at 200 ms; no bloom |
| Outcome loss (11b) | "ROUND COMPLETE" card: opacity plus y 16→0 only (drop the 0.88 scale). The number is amber. | HERO | Fade at 200 ms or less |
| Settlement (12) | Step icon swap (STANDARD in, MICRO out). Step label rises 8 px. | STANDARD / MICRO | Crossfade |
| Result win / cash-out (13, 13c) | Card rises, then the children stagger 0.06/0.04, then XP counts (800 ms), then the XP pill pops (0.15 s delay). The hot "TRADE AGAIN!" pulses once. | HERO, `pop` | Final values only; no pulse |
| Result loss (13b) | Same rise and stagger. Amber numbers settle on `out`. Secondary "Trade again" plus a "Review round" link. No pulse and no confetti. | HERO | Final values |
| Result level-up (13e) | Bar fills, then a `glow-gold` flash on the BNB badge, then the level emblem pops. | HERO, `pop` | Emblem shown, bar full |
| Mission toast (14) | `slideDown` 0.35 s, check pop on MICRO, auto-collapse at about 2 s. The Sparkles `animate-pulse` loop is removed. | STANDARD | Fade in, fade out |
| Menu / profile / settings (04–06) | Sheet rise; the drawer slides from the right; the modal uses `cardVariants`; toggles use MICRO. Swipe dismiss: 120 px / 500 px/s. | STANDARD / MICRO | Fades; drag still works |
| PIX bubble / chat (07, 08) | Bubble y 8→0 at scale 0.96→1 (MICRO), shown for 2000 ms. The face blink is the one loop. Chat messages arrive with MICRO. | MICRO | Bubble fades; no blink |

### 3. Glow and pulse budget
| Token | Allowed on | Never on |
|---|---|---|
| `glow-hot` | The single hot CTA and count badges, including the `pulseGlow` keyframe, whose yellow rgba becomes the hot tone | Anything else |
| `glow-lucky` | Selected tile or row, win badge (was `glow-green`), win bloom | Loss states, text |
| `glow-gold` | BNB disc, level-up badge flash, Pro, coins | Anything else |
| `lift` | Sheets, HeroCard, result card | Tiles, pills |

**The hot pulse rule:**
- `pulseGlow` runs exactly once, when a CTA becomes actionable (on mount or on its enable edge).
- It never re-triggers on re-render or when the P&L sign flips.
- It never runs after a loss. `ResultPanel.tsx:362` must be gated on `pnl > 0`.
- A live cash-out CTA does not pulse if P&L is below 0 at that moment.
- It is suppressed under reduced motion.

**No text glows.** Drop `text-glow-*` and any `drop-shadow` on type. The hold-ring glow applies only to the SVG stroke.

### 4. Celebration ladder
| Rank | Moment | Effects allowed |
|---|---|---|
| 1 | Level-up | Everything from rank 3, plus a gold badge flash, the emblem pop, the success haptic, and confetti in lucky, gold and ink |
| 2 | Target hit | The canvas lucky bloom, a gold coin burst, the DOM bloom (0.55 s), the staggered `pop` banner, and confetti in lucky, gold and ink |
| 3 | Profitable cash-out or timeout | The result rise plus a `pop` on the XP pill and the hot TRADE AGAIN pulse. No confetti, no bloom. |
| 4 | Mission | The toast slides in and the check pops. Nothing else. |
| — | Loss | Calm. No shake, no red, no pulse, no overshoot, no confetti. Amber numbers settle on `out`. The rocket drifts (§23). The warning haptic is the only accent. |

### 5. Canvas FX tone
- **Win:** the boom tints toward `lucky`. The ring expand, the trail brightening and the endpoint flash all use lucky. Coins are `gold`, `gold-deep` and `gold-bright`.
- **Loss:**
  - Mist, sparks, embers, lamps and scorch use `amber`, `gold-deep` and `ink-muted`.
  - The engine goes quiet, then drifts.
  - Per-frame random colours become a stable amber.
- **Info:** the entry line, the entry ring, `ringExpand` and the projected SHORT path.
- **Banned:** hot, red, magenta and cyan.
- **Strobe:** the hazard lamp is capped at 2.5 Hz or less. Today it reaches 3.5 Hz; clamp its frequency ceiling and keep its envelope.
- **Reduced motion:**
  - Kill airframe jitter (`rocket.ts:553-558`, `:350`), flame flicker and sputter, and electrical arcs.
  - The lamp holds steady at 0.55.
  - Particles land in their final burst state or are skipped.

### 6. Performance budget
**What animates:**
- Only `transform` and `opacity` animate per frame.
- The existing exceptions stay and are not extended: the hold-ring `strokeDashoffset` and `filter`, and the one-shot `pulseGlow` box-shadow.
- Blur values stay static. Never animate a blur.
- No layout properties animate. The XP bar keeps its existing width fill; it is not converted and no new instances are added.

**Loops:**
- Only three infinite loops are allowed: the live dot, the Home chevron bob and the PIX blink. All three stop under reduced motion.
- Remove these:
  - `LaunchCountdown` `animate-ping` and `animate-bounce`;
  - `MissionToast` Sparkles `animate-pulse`;
  - `App.tsx:524` `animate-ping`, unless it is the live dot.
- `SimulationBar` is dev-only and exempt.

**Load:**
- At most three DOM animations run at once. The canvas counts as one.
- Keep `will-change` only on the canvas and actively animating sheets.
- The canvas keeps its 2x DPR cap, precomputed colour strings and no per-frame allocations.
- Lazy-load result art. Never use `hero-bomb` on a loss.

### 7. Options
- **A: Calm-plus (recommended).** Everything above. The game show lives in one hot pulse and the rank 1–2 payoffs, which keeps the 80/20 fintech trust and the PRD §22 loss rules.
- **B: Quieter.** Drop confetti from target hit and keep it for level-up only. Use this if QA finds the result screen noisy on 3x phones.
- **C: Louder.** Add a `glow-lucky` flash to the progress fill when the XP count lands. No new timing, but it spends one more glow; only if the product owner wants more reward feel.

Files read: `src/ui/motion.ts`, `src/ui/HoldButton.tsx`, `src/index.css`, `src/components/{OutcomeBannerOverlay,ResultPanel,LaunchCountdown,MissionToast,LiveTradeOverlay,HomeHeroOverlay}.tsx`, `src/canvas/rocket.ts`, `docs/reskin/README.md`, `docs/reskin/E6-canvas.md`, `docs/reskin/lucky-ds/README.md`. I looked at only two before-shots (11 and 13), not 01, 08 or 09.

## How to apply

Option A (calm-plus) is the build target. The product owner has not confirmed it yet, because this run was unattended.

- **Reduced motion.**
  - In components, read it with `useMotionPref()` from `src/ui/motion.ts`, never `useReducedMotion()` directly.
  - App.tsx resolves the setting (in-app toggle OR OS preference) once. It drives `<MotionConfig reducedMotion="always|never">`, the canvas `reducedMotion` prop, and `<html data-motion="reduce|full">`.
  - Both the `prefers-reduced-motion` media query and `data-motion="reduce"` apply the global CSS kill in `src/index.css`.
- **Springs and eases.** Import `MICRO`, `STANDARD`, `HERO` and `EASE_OUT` from `src/ui/motion.ts`. `POP_EASE` is the literal `[0.34, 1.56, 0.64, 1]` already used in `HoldButton.tsx`; hoist it into `motion.ts` only through an E0a integration request.
- **The hot pulse.** Add the `lg-pulse-hot` class once (the legacy `pulse-glow-cta` is a bridge alias that the grep gate flags), on the enable edge, and only when the screen is not reduced and not after a loss. The keyframe animates `box-shadow` in the hot tone only, never `transform`, so it no longer fights Motion's inline transforms.
- **The live dot.** Use `<Pill dot="pulse">`. Its `::after` ripple is `transform` + `opacity` only. Under the CSS kill it ends in its final keyframe, so the dot reads solid.
- **Confetti.** Call `useConfetti().burst('win' | 'levelUp' | 'connect' | 'mission')` and never import `canvas-confetti` directly.
  - The call is a no-op under reduced motion, in frozen scenes (`data-scene-freeze="1"`) and with `data-scene-fx="0"`.
  - Per §4, E3 fires `win` only on a target hit, `levelUp` on a level-up, and nothing on a cash-out, a timeout, a mission or a loss.
- **Keyframes.** `ringExpand` keeps `.animate-ring-expand`. `slideDown` and `slideLeft` remain as keyframes only, because their `.animate-slide-*` classes were unused and are deleted. Use them through an arbitrary utility, for example `animate-[slideDown_0.35s_cubic-bezier(0.16,1,0.3,1)_forwards]`.
- **Glows.** Use the `shadow-glow-lucky`, `shadow-glow-hot`, `shadow-glow-gold` and `shadow-lift` utilities, within the §3 budget. The legacy `.glow-magenta*` and `.text-glow-*` classes now resolve to `none`; delete them from your files as you go.
