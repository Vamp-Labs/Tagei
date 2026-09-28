# Tagei — UI/UX Screen Specification

## 1. Landing / Connect Wallet

### Purpose
Welcome new users and move them into the product without filling the screen with static artwork.

### Layout
```text
┌────────────────────────────┐
│ Tagei           Wallet  ☰  │
│                            │
│         live chart         │
│       ╱╲   ╱╲       🚀     │
│     ╱    ╲╱  ╲___╱         │
│                            │
│        PIX / subtle        │
│                            │
│      Welcome to            │
│       Tagei                │
│                            │
│ Connect your wallet to     │
│ start your first mission   │
│                            │
│ [ CONNECT WALLET ]         │
│       Explore first →      │
└────────────────────────────┘
```

### Background
The background is **not a full illustration**. Use:
- live animated chart
- small 3D rocket
- subtle parallax stars
- partial planet horizon
- low-opacity asteroids
- fade-to-black gradient behind CTA area

### Motion
- chart slowly updates
- rocket moves along latest chart segment
- particles appear briefly after rocket movement
- planet parallax is extremely subtle
- PIX may blink or look toward the chart

---

## 2. Home / Main Screen

### Purpose
Give the user a clean market view and one obvious action: begin a trade.

```text
Tagei                         ◉  ☰

                BNB ▾
              $605.60
               +0.92%

             PIX ✦

      live chart / rocket

ENTRY ●───────────────🚀 +$0.20

             ↑
       Swipe up to trade

┌────────────────────────────┐
│  1 ACTIVE POSITION +$1.24  │
└────────────────────────────┘
```

Show only:
- asset
- current price
- selected change
- chart
- rocket
- PIX access
- active position chip if applicable
- swipe-up trading affordance

Hide:
- leverage
- amount
- target
- stop
- settings/profile
- bottom nav

---

## 3. Trade Setup — Bottom Sheet

### Trigger
Swipe up from Home.

```text
────────────── drag handle ──────────────

[ ↗ LONG ]         [ ↘ SHORT ]

AMOUNT
[ − ]       $10       [ + ]    $5 $25 $50

LEVERAGE
[ 2x ] [ 5x ] [ 10x ] [ 20x ]

[        HOLD TO LAUNCH        ]
          LONG BNB · $10 · 10x
```

### Behavior
- sheet height around 45–55% viewport
- chart remains visible in background
- LONG = green active state
- SHORT = red/pink active state
- CTA remains BNB yellow
- drag down to dismiss

### Hold interaction
- hold duration: 600–900 ms
- fill left-to-right
- light haptic at ~50%
- launch only at 100%

---

## 4. Active Trade

### Purpose
Turn the trade into a mission.

```text
Tagei                         ◉  ☰

● LIVE    00:20

                     +$1.93
                        🚀
                     ╱
                  ╱
               ╱
───────●──────╯
      ENTRY

      🦊 Nice recovery!

        LONG · 10x

          +$1.93
[      HOLD TO CASH OUT      ]

        Position details
```

Show only:
- LIVE state
- countdown
- entry point
- rocket
- current P&L
- direction + leverage
- cash-out CTA
- contextual PIX message
- link to position details

Hide by default:
- full entry price
- target price
- stop loss
- liquidation
- stake
- raw multipliers

### Chart behavior
- pre-entry segment = gray/dim
- profitable segment = green
- losing segment = red
- rocket follows active segment

### PIX behavior
Event-driven only. Examples:
- `Nice recovery!`
- `Back in profit.`
- `5 seconds left.`
- `Approaching stop loss.`

Bubble disappears after 2–4 seconds.

---

## 5. Cash-Out Hold State

```text
[██████████████░░░░]
      CASHING OUT…
          68%
```

Rules:
- freeze visible P&L snapshot while confirming
- progress follows hold duration
- subtle vignette
- haptic at confirmation
- release early = cancel

---

## 6. Trade Result — Win

```text
           🚀
      TRADE CLOSED

         +$12.48

      🦊 Nice landing!

LONG · 10x
Duration        00:20
Entry           $555.96
Exit            $568.44
P&L             +$12.48

[       TRADE AGAIN        ]
        View details
```

Motion:
- short glow burst
- rocket exits upward
- PIX celebrates
- small sparkle burst
- no endless confetti

---

## 7. Trade Result — Loss
Same structure as win.

Use:
- red/pink accent
- calm message
- no shame language
- no aggressive retry pressure

CTA: `Trade Again`
Secondary: `View Details`

---

## 8. Position Details

```text
Position Details                    ×

LONG · 10x
+$1.93  (+1.9%)

Entry Price                    $555.96
Current Price                  $557.89
Target Price                   $562.63
Stop Loss                      $550.90
Stake                           $10.00
Leverage                           10x
Est. Liquidation               $500.12

[       VIEW ON CHART       ]
[        CLOSE POSITION      ]
```

No mascot required here.

---

## 9. Asset Selector

```text
Select Asset                        ×
[ Search asset… ]

[All] [Crypto] [FX] [Commodities]

BNB         $605.60        +0.92%   ✓
Bitcoin     $102,430       +1.12%
Ethereum    $3,420         +0.56%
Solana      $232.45        +2.14%
DOGE        $0.1623        +3.02%
ADA         $0.45          +1.06%
```

Token icons should be flat SVG for clarity.

---

## 10. PIX AI Chat

```text
PIX AI ✦                           ×
[PIX avatar]

Hey, I’m PIX 👋
Your AI co-pilot for smarter trades.

[ What’s the trend for BNB? ]
[ Is it a good time to go long? ]
[ Explain this chart ]
[ Show key support levels ]

[ Ask me anything…              ➤ ]
```

Use full mascot only in header/hero. Messages use avatar crop.

---

## 11. Menu

```text
[ PIX avatar ]  TraderFox
                Level 7 · 2,450 XP

Positions                       1
History
Profile
Settings
Help & Support

Daily Streak
+50 XP

[ Disconnect Wallet ]
```

No persistent bottom navigation.

---

## 12. Active Position Banner

```text
┌────────────────────────────┐
│ 🚀  1 ACTIVE POSITION   >  │
│     +$1.24                 │
└────────────────────────────┘
```

Tap → Position Details.

---

## 13. Notifications / PIX Events
Examples:
- Position opened
- Back in profit
- 5 seconds left
- Approaching stop loss
- Cash out successful
- Wallet connected

Rules:
- max one toast at a time
- 2–4 sec duration
- never cover CTA

---

## 14. Loading / Connection

```text
             🦊
       Connecting to BNB…

      ✓ Wallet connected
      ✓ Permissions checked
      ◌ Loading market…
```

Avoid indefinite spinner-only loading.

---

## 15. Empty State

```text
              🦊

      No active position

Launch your first trade
and start your journey.

[       LAUNCH TRADE       ]
```

---

## 16. Numeric Input

```text
Enter Amount

      [ − ] $10 [ + ]

[$5] [$10] [$25] [$50]

1  2  3
4  5  6
7  8  9
.  0  ⌫

[ Done ]
```

# Interaction rules
- Swipe up → trade setup
- Swipe down → close trade setup
- Hold → launch / cash out
- Tap asset → switch asset
- Tap PIX → AI
- Tap active position → details

Avoid hidden gestures for essential navigation.

# UX copy style
Tone: short, confident, playful, non-technical by default.

Good:
- `Ready to launch?`
- `Nice recovery!`
- `Back in profit.`
- `5 seconds left.`
