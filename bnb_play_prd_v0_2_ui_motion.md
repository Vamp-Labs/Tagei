# PRD — BNB PLAY

**Version:** 0.2  
**Status:** Product / UI / Motion Specification  
**Platform:** Mobile-first Web App / PWA  
**Core stack:** BNB Chain + real market data + AI companion  
**Product thesis:** *Markets should feel playable before they feel complicated.*

---

# 1. Product Vision

BNB Play is an **AI-native, game-native interface for real markets**.

The product does not try to make a traditional trading terminal prettier. It replaces the traditional trading interaction model with a new one:

```text
LIVE MARKET
    ↓
ANIMATED MARKET TRACK
    ↓
ROCKET / PLAYER MOTION
    ↓
LONG / SHORT DECISION
    ↓
REAL-TIME OUTCOME
    ↓
WIN / LOSS FEEDBACK
    ↓
AI EXPLANATION
    ↓
XP / PROGRESSION
```

Users should not need to understand candlesticks, order books, technical indicators, gas, routing, or smart-contract calls before they can interact with a market.

The experience should feel closer to a **live game arena** than a trading terminal.

> **We are not shrinking a trading terminal. We are turning the market itself into the interface.**

---

# 2. Core UX Principle

There is one visual system across the entire product:

## The Market Track

The glowing animated line visible on Home, Pre-Trade, and Live Trade is the same conceptual object.

It represents real market movement, but is rendered as a smooth, game-native trajectory.

The user does not move from:

`homepage → form → chart → trade terminal`

Instead, the user remains inside the same market world.

```text
HOME
Market Track is alive
Rocket is already moving
        ↓
CONNECT WALLET
        ↓
Same Market Track
Trade controls appear
        ↓
LONG / SHORT
        ↓
Same Market Track
Round becomes LIVE
        ↓
Rocket follows market
        ↓
Result resolves
```

The screen should feel like one continuous animated experience.

---

# 3. Visual Language

## 3.1 World

Visual identity:

- Deep navy / space environment
- BNB yellow as primary brand accent
- Neon green for positive live movement
- Neon magenta/red for negative or short-state interaction
- Cyan for entry markers and informational HUD
- Glowing planet / moon background
- Particle field and subtle atmospheric movement
- PIX mascot and rocket as character layer

The app should feel:

- playful
- premium
- futuristic
- alive
- approachable

It should **not** feel:

- like Binance Advanced
- like TradingView
- like a spreadsheet
- like an order-book terminal

---

# 4. Home / Lobby — Detailed UI Specification

## Goal

The Home screen must immediately demonstrate the product before the user connects a wallet.

A user should understand within a few seconds:

> “This is a live market that behaves like a game.”

The Home UI should visually resemble the Live Trade screen.

The major difference is:

> **Live Trade has trading controls. Home has Connect Wallet.**

---

## 4.1 Home Layout

### Header

```text
[menu]   BNB PLAY                [notifications] [profile]
```

Below or integrated into the live HUD:

```text
BNB
$612.34
+2.14%
```

The displayed asset may default to BNB.

---

## 4.2 Home Hero / Live Market Stage

Approximately **55–65% of the upper screen** is the animated Market Track.

Elements:

```text
                         TARGET / LIVE PRICE
                                ●
                              ╱
                       🚀   ╱
                         ╱╯
            ╱╲         ╱
ENTRY  ●───╯  ╲───────╯
```

Background:

- moving stars
- slow planet parallax
- glowing terrain / horizon
- subtle particle trails
- optional PIX character floating near the track

The chart/track is **fully animated even before wallet connection**.

The user should never see a static hero illustration pretending to be a chart.

---

# 5. Home Market Track Animation

## 5.1 Idle / Unconnected State

Before wallet connection:

- real market data continues streaming
- Market Track continuously moves from right to left or redraws toward the right edge
- rocket follows the newest price point
- rocket has a subtle engine pulse
- trail length changes with speed / market momentum
- live price label updates smoothly
- stars move slowly in parallax
- background planet drifts subtly

The animation should make the Home page feel like a **live playable world**.

### Idle rocket behavior

When movement is small:

- rocket floats smoothly
- engine glow is soft
- small hover animation

When price accelerates upward:

- rocket rotates slightly upward
- engine trail becomes longer
- subtle screen particles move faster

When price drops:

- rocket pitches downward
- engine intensity drops slightly
- track movement visually follows price

No large celebration or failure effects occur before a trade is active.

---

# 6. Connect Wallet CTA

The CTA sits **directly underneath the animated Market Track**.

```text
┌────────────────────────────┐
│  👛  CONNECT WALLET   →    │
└────────────────────────────┘
```

The button should:

- use BNB yellow
- be full width
- have strong contrast
- pulse very subtly every few seconds
- not compete visually with the live market animation

After successful connection:

```text
CONNECT WALLET
      ↓
WALLET READY ✓
      ↓
PLAY NOW
```

The Market Track never disappears during this process.

---

# 7. Wallet Connection Animation

When the user taps **Connect Wallet**:

### Phase 1 — CTA press

Duration: approximately 120–180 ms

- button depresses slightly
- wallet icon emits a quick glow

### Phase 2 — Wallet confirmation

The external wallet flow appears.

### Phase 3 — Connected

When connection succeeds:

- small BNB particle burst around the CTA
- text changes to `Wallet Ready ✓`
- wallet state appears in header
- after a short beat, CTA morphs into:

```text
PLAY NOW →
```

### Important

Do not reload the entire screen.

The transition should feel like the existing game world has simply become interactive.

---

# 8. Transition: Home → Pre-Trade

This should be a **morph transition**, not a page cut.

Home already contains:

- BNB price
- Market Track
- rocket
- environment

When user presses **Play Now**:

1. headline / marketing copy fades away
2. asset chips slide into the top section
3. PIX insight card slides in
4. Play Amount panel rises from bottom
5. LONG / SHORT controls appear
6. Market Track remains in exactly the same world

Target transition duration:

**350–500 ms**

The user should feel:

> “I entered the game.”

Not:

> “I navigated to another website page.”

---

# 9. Pre-Trade UI

## 9.1 Asset Selector

At the top:

```text
[ BNB ] [ BTC ] [ ETH ]
[ SOL ] [ DOGE ] [ ... ]
```

No separate Select Market screen.

Changing assets should update the same Market Track.

---

# 10. Asset Switch Animation

When switching from BNB → BTC:

1. existing track slightly fades
2. track redraws with BTC market data
3. rocket performs a quick warp / streak transition
4. asset icon and live price crossfade
5. PIX recalculates the summary

Duration:

**250–400 ms**

Do not use a full-screen loading spinner unless data is unavailable.

---

# 11. PIX AI — Pre-Trade

PIX appears above the trading controls.

Example:

```text
PIX AI

Momentum is building.
Buying pressure has increased,
but volatility is elevated.
```

PIX should translate market complexity.

It should not say:

- guaranteed win
- guaranteed profit
- definitely buy
- definitely short

PIX is an interpreter and learning companion, not an oracle.

---

# 12. Market Track in Pre-Trade

The Market Track remains active.

Add:

### Entry marker

```text
ENTRY
$612.34
   ●
```

### Reference / target marker

```text
TARGET
$620.10
                   ●
```

### Support / downside reference

Optional:

```text
SUPPORT
$604.50
                   ●
```

The result should resemble a playable lane rather than a technical chart.

---

# 13. Play Amount

Example:

```text
PLAY AMOUNT

[$5] [$10] [$25] [$50]

      -   $10   +
```

Amount changes animate numerically.

Example:

```text
$10
↓
$25
```

The number quickly counts upward rather than instantly replacing the previous value.

Duration:

**150–250 ms**

---

# 14. LONG / SHORT Selection

Two large interactive game controls.

```text
┌──────────────┐  ┌──────────────┐
│ 🚀 LONG      │  │ ↘ SHORT      │
│ Ride Up      │  │ Ride Down    │
└──────────────┘  └──────────────┘
```

---

## 14.1 LONG Selected Animation

When LONG is selected:

- LONG panel expands slightly
- neon green border intensifies
- rocket engine becomes green/cyan
- a short projected path appears upward from current market position
- track emits a subtle upward pulse
- SHORT button dims

Optional microcopy:

> Ride the move upward.

---

## 14.2 SHORT Selected Animation

When SHORT is selected:

- SHORT panel expands slightly
- magenta/red glow intensifies
- rocket trail changes to magenta
- projected path points downward
- LONG button dims

Important:

The real market track itself must **not be inverted**.

The visual must still represent the real price direction truthfully.

The user's success state is simply calculated inversely for SHORT.

---

# 15. Start Trade Transition

When user taps:

```text
START TRADE →
```

Run a short launch sequence.

### T - 0.6 sec

Controls fade down.

### T - 0.4 sec

Entry point locks.

```text
ENTRY LOCKED
$612.34
```

### T - 0.2 sec

Rocket engine charges.

### T = 0

Rocket launches.

A ring wave expands from the Entry point.

LIVE indicator appears:

```text
● LIVE
```

Timer begins.

The screen morphs into Live Trade without changing worlds.

---

# 16. Live Trade — Core UI

The Live Trade screen should be extremely simple.

Visible elements:

```text
BNB • LIVE
$612.34 +2.14%

                     TARGET
                     $620.10
                        ●

                  🚀
                ╱
             ╱
ENTRY ●─────╯
$612.34


TIME LEFT
00:12

CURRENT P&L
+$18.40

[CASH OUT +$18.40]
```

No candlestick chart.

No indicator panels.

No traditional order book.

The Market Track is the hero.

---

# 17. Fully Animated Market Track

This is the highest-priority motion system in the product.

## 17.1 Real-time drawing

As new price data arrives:

- newest segment grows from the current endpoint
- previous points shift naturally
- line does not teleport
- rocket interpolates between old and new positions
- displayed price counts smoothly toward the new value

The visual line can be smoothed for readability.

However:

> **Settlement and P&L must always use real underlying market prices, not the smoothed visual value.**

---

## 17.2 Rocket follows the market

The rocket should feel physically attached to market movement.

### Price moving upward

- rocket tilts upward
- engine trail extends
- particles move faster
- subtle glow around rocket increases

### Price moving sideways

- rocket floats
- minimal trail
- gentle engine pulse

### Price moving downward

- rocket pitches downward
- trail becomes shorter or changes state
- light camera drift follows the movement

Do not exaggerate movement so much that the visualization becomes deceptive.

---

# 18. Player State Overlay

The Market Track should communicate both:

1. actual price movement
2. whether that movement is good or bad for the player's selected direction

Examples:

### LONG + market up

- green positive pulse
- rocket boost
- P&L ticks upward

### LONG + market down

- warning pulse
- rocket engine sputter
- P&L ticks downward

### SHORT + market down

- magenta/green success effect
- rocket enters a controlled dive / acceleration
- P&L ticks upward

### SHORT + market up

- warning pulse
- rocket loses boost
- P&L ticks downward

---

# 19. Target Approaching Animation

When the price gets close to the target:

### At 75% progress

- target ring begins to pulse
- rocket engine becomes slightly brighter

### At 90%

- target marker emits a larger halo
- subtle audio cue
- optional haptic pulse

### At 98%

- thin trajectory lock line appears
- rocket becomes visually focused on target

Do not show a win until the real target condition has been reached.

---

# 20. TARGET HIT — Win Animation

When the real market condition reaches the win threshold:

## Frame 1 — Impact

Duration: 80–120 ms

- rocket touches the target ring
- target ring compresses
- tiny haptic tap

## Frame 2 — Energy Burst

Duration: 150–250 ms

- ring expands outward
- BNB particles / stars burst
- rocket trail becomes bright
- line endpoint flashes

## Frame 3 — WIN State

Duration: 300–500 ms

Large text:

```text
HIT!

WIN
+$18.40
```

or:

```text
TARGET HIT
+3.2x
```

Rocket shoots slightly beyond the target.

PIX may briefly appear celebrating.

### Important

Avoid covering the entire UI instantly.

The user should clearly see **where the rocket hit the market target** before the Result screen appears.

This is critical because the hit itself is the emotional payoff.

---

# 21. Win Transition to Result

After approximately 700–1000 ms:

- camera zooms slightly toward rocket
- market environment blurs
- Result panel rises from the bottom
- confetti / BNB fragments continue briefly

Result:

```text
WIN!

+$18.40

ENTRY
$612.34

EXIT
$620.10

[ PLAY AGAIN ]

[ VIEW DETAILS ]
```

---

# 22. LOSS CONDITION — Core Principle

A loss should be clear, but **not humiliating or aggressively punitive**.

Do not use:

- violent explosion
- character death
- “YOU FAILED”
- “DOUBLE DOWN”
- “WIN IT BACK”
- automatic higher stake suggestion

Loss is presented as a market outcome and learning moment.

---

# 23. Loss Animation — Price Moves Against User

Example:

User selected LONG.

The price moves below the loss / round threshold.

### Stage 1 — Warning

As position becomes meaningfully negative:

- P&L changes state
- rocket engine begins to flicker
- slight red/magenta pulse around HUD
- PIX does not interrupt unless necessary

### Stage 2 — Near Loss

- rocket velocity appears reduced
- track environment becomes slightly dimmer
- a warning ring appears at the threshold

### Stage 3 — Threshold Hit

When the actual loss condition is reached:

- rocket passes through the loss marker
- engine briefly shuts down
- rocket drifts rather than explodes
- line endpoint emits a soft red pulse
- short haptic cue

Text:

```text
ROUND COMPLETE

-$4.20
```

Not:

```text
YOU LOST!!!
```

---

# 24. Loss Result Transition

After the threshold is reached:

- rocket slows and floats
- background remains visible
- result card slides upward

Example:

```text
ROUND COMPLETE

-$4.20

ENTRY
$612.34

EXIT
$608.14
```

PIX says:

> The market reversed shortly after your entry.  
> Buying pressure weakened during the round.

Actions:

```text
[ REVIEW ROUND ]

[ PLAY AGAIN ]
```

Never automatically increase the next play amount.

---

# 25. Timeout / Neutral Resolution

Not every round should need a dramatic win/loss hit.

If a timed round ends:

### Timer

```text
00:03
00:02
00:01
```

At zero:

- timer ring closes
- rocket freezes on final market point
- endpoint expands briefly
- P&L locks

Then:

```text
ROUND COMPLETE

+$2.10
```

or:

```text
ROUND COMPLETE

-$1.60
```

The result should reflect the actual product mechanic and settlement rule.

---

# 26. Cash Out Animation

When user presses:

```text
CASH OUT +$18.40
```

1. button flashes
2. current price point locks
3. rocket reaches a small exit gate
4. `EXIT` marker appears
5. P&L freezes
6. execution / settlement begins
7. Result panel appears

Example:

```text
EXIT LOCKED
$618.42
```

If onchain confirmation takes time:

```text
SETTLING...
```

The game world remains visible while settlement completes.

---

# 27. Network / Transaction Delay

Blockchain state should not destroy the game feel.

Avoid a blank spinner.

Instead:

```text
ROUND COMPLETE
SETTLING ON BNB CHAIN...
```

Animation:

- rocket docks at a glowing BNB checkpoint
- BNB logo rotates subtly
- progress status updates

Possible states:

```text
Preparing
Signing
Submitted
Confirmed ✓
```

If transaction fails:

```text
TRANSACTION NOT CONFIRMED
Your position was not settled.
```

The product must never display a confirmed result before settlement state is known when onchain confirmation is required.

---

# 28. PIX Post-Trade Animation

After Result, PIX appears through a small character entrance.

Example:

```text
PIX AI

Nice read.

Volume increased before your entry
and remained strong through most
of the round.
```

Then show:

```text
KEY FACTORS

Volume spike        +42%
Buy pressure        Strong
Volatility          High
```

Learning tip:

> Strong momentum can help, but high volatility also increases risk.

AI feedback should feel like a coach after a game round.

---

# 29. Progression Animation

After the AI feedback:

XP counts upward.

Example:

```text
+50 XP

720 → 770 XP
```

Progress bar animates.

If level up:

1. bar fills
2. BNB badge flashes
3. new level emblem appears

Example:

```text
LEVEL UP!

LEVEL 8
MOMENTUM HUNTER
```

Level-up effects should be more celebratory than ordinary financial wins.

This reinforces progression beyond profit/loss.

---

# 30. Daily Mission Feedback

After a completed round:

```text
MISSION UPDATED

Play 3 rounds
2/3 → 3/3 ✓

+50 XP
```

Animation:

- mission card slides briefly from edge
- checkmark animates
- card collapses automatically after approximately 2 seconds

Do not interrupt the main result interaction.

---

# 31. Home After Returning From a Round

When the user returns Home:

The same live Market Track is visible.

But now it can include the user's last round marker.

Example:

```text
                current market
                      🚀
                    ╱
         YOUR PLAY ●
                  ╱
```

Optional:

```text
Last round
+$18.40
```

This makes the Home world feel persistent.

---

# 32. Motion System

Use motion intentionally.

## Micro

**100–200 ms**

For:

- button presses
- number changes
- small hover states
- chip selections

## Standard

**250–450 ms**

For:

- panel transitions
- asset change
- AI card entrance
- Long / Short selection

## Hero

**600–1200 ms**

For:

- rocket launch
- target hit
- result reveal
- level up

Avoid unnecessarily slow transitions during repeated play.

---

# 33. Haptics

On supported mobile devices:

### Light haptic

- selecting asset
- changing amount
- selecting Long / Short

### Medium haptic

- Start Trade
- Cash Out
- target near hit

### Success pattern

- Target Hit
- Level Up

### Warning pattern

- loss threshold reached
- transaction error

Haptics should always be optional.

---

# 34. Sound Design

Sound should be lightweight and optional.

Suggested sound events:

- subtle rocket engine
- market pulse
- start-round ignition
- near-target tone
- target-hit chime
- result success
- loss resolution
- level-up
- mission complete

Sound should never resemble a slot machine jackpot loop.

Default may be muted until user enables audio.

---

# 35. Reduced Motion / Accessibility

Users must be able to reduce motion.

When `Reduce Motion` is enabled:

- rocket no longer makes large pitch movements
- parallax is disabled
- camera shake is removed
- particles are reduced
- Market Track still updates accurately
- target hit uses glow + text rather than large movement

Never rely on color alone.

LONG / SHORT must use:

- icons
- text
- directional symbols

Win/loss states also require explicit text.

---

# 36. Performance Requirements

The Market Track is the product's signature interaction and must feel smooth.

Targets:

- 60 FPS on modern devices when possible
- graceful 30 FPS fallback
- no full-screen rerender for each tick
- interpolate market points between data updates
- pause expensive background effects when app is inactive
- reduce particles on low-power devices

Market-data latency and transaction state should be separately measurable.

---

# 37. Data Integrity

The app may make price movement more visually fluid.

It must never manipulate the actual outcome.

Separate:

### Display animation value

Used only for interpolation and visual motion.

### Settlement value

Used for:

- P&L
- entry
- exit
- target conditions
- actual execution
- final result

Example:

```text
Market price feed
      │
      ├── Settlement Engine → exact price
      │
      └── Motion Renderer → interpolated visual track
```

This separation is mandatory.

---

# 38. Screen Flow — Revised

```text
1. HOME / LIVE LOBBY
       │
       │ Connect Wallet
       ↓
2. PRE-TRADE
   asset + AI + Market Track
       │
       │ LONG / SHORT
       ↓
3. LIVE TRADE
   rocket follows real market
       │
       ├── target hit → WIN
       │
       ├── loss threshold → ROUND COMPLETE
       │
       ├── timer → RESULT
       │
       └── cash out → RESULT
       ↓
4. RESULT
       ↓
5. AI FEEDBACK
       ↓
6. XP / PROGRESSION
       ↓
7. PLAY AGAIN / HOME
```

No separate market-selection page.

No separate game-mode page is required for MVP.

---

# 39. MVP — Motion Priority

For hackathon MVP, prioritize these animations.

## P0 — Must ship

1. Home Market Track continuously animates
2. Rocket follows live market movement
3. Home → Pre-Trade morph
4. Long / Short selection effects
5. Start Trade launch
6. Live P&L animation
7. Target Hit animation
8. Loss threshold animation
9. Cash Out animation
10. Result reveal
11. PIX post-round explanation

## P1

- Asset warp transition
- mission completion animation
- XP count-up
- Level Up
- BNB settlement checkpoint

## P2

- cosmetics
- advanced particles
- seasonal backgrounds
- rocket skins
- multiplayer spectators
- elaborate social effects

---

# 40. Acceptance Criteria — Home

Home is complete when:

- live market line animates before wallet connection
- rocket visibly follows the market line
- price updates continuously
- Connect Wallet sits below the hero market scene
- Home visually resembles Live Trade
- wallet connection does not reload the world
- successful connection converts CTA into Play Now

---

# 41. Acceptance Criteria — Live Trade

Live Trade is complete when:

- real market price updates
- Market Track animates smoothly
- rocket movement responds to price
- entry is visibly locked
- selected Long / Short state is obvious
- P&L changes in real time
- timer is clear
- Cash Out works
- target hit creates a visible collision moment
- loss state is visually understandable
- actual outcome is based on settlement data, not visual interpolation

---

# 42. Acceptance Criteria — Win

A win experience must:

- visibly show the rocket reaching the target / winning condition
- create a short energy burst
- show exact financial result
- preserve entry and exit values
- transition smoothly into Result
- not make misleading guaranteed-return claims

---

# 43. Acceptance Criteria — Loss

A loss experience must:

- visibly show the threshold / unfavorable market outcome
- avoid explosive or humiliating failure visuals
- clearly display the actual negative result
- provide entry and exit values
- provide optional AI explanation
- never promote loss chasing
- never automatically raise the next stake

---

# 44. Core Product Narrative

Traditional products ask:

> “Can we make trading charts easier?”

BNB Play asks:

> **“Why should new users need a trading chart at all?”**

The Market Track transforms financial data into movement.

The rocket transforms movement into an intuitive character.

AI transforms market complexity into understandable context.

BNB Chain transforms the interaction into verifiable execution and settlement.

```text
BLOCKCHAIN
Trust + settlement

        +

AI
Understanding + context

        +

GAME DESIGN
Interaction + progression

        =

BNB PLAY
```

---

# 45. One-Line Pitch

> **BNB Play turns live markets into an animated game world, where users ride real price movement with a rocket, learn through AI, and settle actions on BNB Chain.**

---

# 46. Demo Moment

The strongest hackathon demo should not be the wallet connection.

It should be this sequence:

```text
User chooses LONG
        ↓
Rocket launches
        ↓
Real market line moves
        ↓
P&L updates
        ↓
Rocket approaches target
        ↓
TARGET HIT
        ↓
Energy burst
        ↓
+$18.40
        ↓
PIX explains WHY the trade worked
        ↓
BNB Chain confirmation shown
```

That single sequence communicates:

- trading
- gaming
- animation
- AI
- Web3
- onchain execution

without needing a long explanation.

---

# 47. Final Product Principle

The signature experience is not:

**press button → wait → result**

It is:

> **watch the market become a world, enter that world, ride the movement, experience the result, and understand why it happened.**

That is the experience BNB Play should own.
