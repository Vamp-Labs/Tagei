# BNB PLAY — UI/UX Product Spec

## Product direction
BNB PLAY is a **gamified trading experience** built around a simple mission loop:

1. Connect wallet
2. Pick an asset
3. Choose LONG or SHORT
4. Set amount and leverage
5. Hold to launch
6. Watch the trade as a rocket mission
7. Cash out or let the round resolve
8. See the result and continue

The experience should feel like:

> **80% calm fintech + 20% premium game**

The interface must remain simple enough that the user always knows what to do next.

## Visual language
- Dark space environment
- Stylized 3D assets
- BNB yellow as brand/action color
- Green for LONG/profit
- Red/pink for SHORT/loss
- White/gray for neutral UI
- Very limited glow
- No heavy cyberpunk HUD clutter
- No persistent bottom navigation

### Visual hierarchy
1. Current asset + price
2. Current mission/trade state
3. Rocket/chart movement
4. Main action
5. PIX contextual assistance
6. Secondary detail

### Rule: one hero glow
Only one element should feel primary at a time:
- Before trade: `HOLD TO LAUNCH`
- During trade: rocket + live P&L
- During cash out: cash-out progress
- After success: reward/result

## Navigation model
There is no persistent bottom tab bar.

- Tap asset name → asset selector
- Tap PIX → AI assistant
- Swipe up → trade controls
- Tap active position chip → position details
- Tap top-right menu → Positions, History, Profile, Settings
- Wallet button → connect/account state

## Main product states
1. Landing / Connect Wallet
2. Home / Main Screen
3. Trade Setup Sheet
4. Active Trade
5. Cash-Out Hold State
6. Trade Result — Win
7. Trade Result — Loss
8. Position Details
9. Asset Selector
10. PIX AI Chat
11. Menu
12. Active Position Banner
13. Notifications / PIX Events
14. Loading / Wallet Connection
15. Empty State
16. Numeric Input

See `UI_UX_SPEC.md` for full screen behavior.

## Asset philosophy
Do not export the whole UI as images.

Use custom 3D assets only for:
- PIX fox mascot
- Rocket
- BNB coin
- Planets / horizon
- Asteroids
- Success / launch FX

Use code for:
- Chart and candlesticks
- Entry / target / stop markers
- P&L labels
- Buttons and cards
- Sheets and menus
- Inputs and progress bars
- Toasts and navigation

See `ASSET_MOTION_SPEC.md`.

## Design principles
- Gameplay first
- Progressive disclosure
- Contextual UI
- Motion explains state
- PIX is a co-pilot, not decoration
- Keep the center clean
- Use 3D selectively

## Success criteria
A first-time user should understand without tutorial text:
- what asset they are viewing
- where the price is
- how to start a trade
- which direction they selected
- how much they are risking
- how to cash out
- whether they are in profit or loss
- where advanced details live
