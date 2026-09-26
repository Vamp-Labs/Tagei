# BNB PLAY — Design Tokens & Component Rules

## Color system

```css
--bnb-yellow: #F0B90B;
--bnb-yellow-bright: #FFD21E;
--long: #00E89A;
--short: #FF3B6B;
--profit: #00E89A;
--loss: #FF3B6B;
--bg-0: #050914;
--bg-1: #09111F;
--panel: rgba(13, 24, 41, 0.88);
--panel-soft: rgba(16, 30, 50, 0.72);
--line: rgba(130, 160, 200, 0.18);
--text-1: #F5F7FB;
--text-2: #9AA8BD;
--text-3: #65758C;
```

## Color grammar
- Yellow = brand + primary action
- Green = LONG + profit
- Red/pink = SHORT + loss
- White/gray = neutral
- Cyan should not become a fifth primary semantic color

## Typography
Use a modern grotesk/sans for UI, tabular numerals for prices.

```text
Hero price        32–40
Screen title      20–24
Primary CTA       16–18
Body              14–16
Metadata          12–13
Micro label       10–12
```

## Radius
```css
--radius-sm: 10px;
--radius-md: 16px;
--radius-lg: 22px;
--radius-xl: 28px;
```
Avoid making every object a pill.

## Spacing
Use an 8-point system.

```text
4   micro
8   tight
12  compact
16  standard
24  section
32  major
40+ hero
```

# Component rules

## Primary CTA
Examples:
- Connect Wallet
- Hold to Launch
- Trade Again

Rules:
- BNB yellow
- full width
- minimum 52px height
- high contrast black text
- glow only when actionable

## LONG / SHORT control
Neutral: dark, subtle border.

Selected LONG: green border/glow.

Selected SHORT: red/pink border/glow.

Do not color both simultaneously.

## Bottom sheet
Use for trade setup, asset selector, and detail views.

Rules:
- rounded top corners
- visible drag handle
- background blur
- clear hierarchy
- max 85% screen height

## PIX bubble
- max 1–2 lines
- disappears automatically
- use only for meaningful events
- avoid constant chatter

## Accessibility
- minimum body text 14 px
- touch targets at least 44×44
- do not use color alone for LONG/SHORT
- support reduced motion
- maintain chart-label contrast
- avoid rapid flashing
- haptics complement, never replace, visual feedback
