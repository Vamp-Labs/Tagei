# BNB PLAY — 3D Asset & Motion Specification

## Art direction
All hero assets use one consistent style:

> Stylized premium 3D, toy-like but not childish, glossy materials, soft rounded forms, cinematic lighting, BNB yellow + black + white, clean silhouettes.

The UI itself remains mostly flat and crisp.

# 1. Rocket asset set
The rocket is the user's visual trade avatar.

## Required exports
- `rocket_idle.webp` — home / pre-launch, engine dim
- `rocket_flying.webp` — normal active trade, medium flame
- `rocket_boost.webp` — launch / strong move, longer flame
- `rocket_down.webp` — downward orientation, neutral condition
- `rocket_success.webp` — result / win, bright booster
- `rocket_small.webp` — chart marker, readable at 32–64 px

## Rocket technical guidance
Preferred:
- source model: GLB/GLTF
- runtime export: WebP/AVIF or texture atlas
- animate flame/trail separately from rocket body

If sprite-based:
- 8–16 flame frames max
- keep body static where possible

# 2. PIX fox asset set
Required states:
- `pix_idle.webp`
- `pix_ready.webp`
- `pix_pointing.webp`
- `pix_wave.webp`
- `pix_thinking.webp`
- `pix_happy.webp`
- `pix_alert.webp`
- `pix_celebrate.webp`
- `pix_loading.webp`
- `pix_sitting.webp`
- `pix_avatar.webp`

Character consistency:
- same head proportions
- same fur colors
- same goggles
- same pilot suit
- same BNB badge placement
- same lighting direction
- same eye style

# 3. Environment assets
- `space_background_base.webp`
- `planet_horizon_gold.webp`
- `planet_blue.webp`
- `asteroid_01.webp`
- `asteroid_02.webp`
- `asteroid_03.webp`

Reuse asteroids with scale, rotation, blur, and opacity.

# 4. FX assets
Launch:
- `launch_glow.webp`
- `rocket_flare.webp`
- `boost_particles.webp`

Success:
- `success_burst.webp`
- `success_ring.webp`
- `sparkle_gold.webp`

Warning:
- `danger_glow.webp`

Prefer CSS/WebGL for simple effects instead of large alpha-video files.

# 5. Live animated chart
Render in code. Do not export chart/candlestick images.

Recommended:
- Canvas
- WebGL
- SVG for simpler line charts

# 6. Rocket movement model
The rocket follows the chart path.

```text
rocket.x = latestPoint.x
rocket.y = latestPoint.y
rotation = atan2(
  latestPoint.y - previousPoint.y,
  latestPoint.x - previousPoint.x
)
```

Add:
- 100–250 ms smoothing
- rotation clamp
- subtle idle bob
- particle emission based on speed

# 7. Landing animation composition
```text
space background
    ↓
subtle stars
    ↓
planet horizon
    ↓
live chart
    ↓
rocket following chart
    ↓
PIX foreground
    ↓
dark fade gradient
    ↓
welcome copy + connect wallet
```

# 8. Motion timing
Micro: 120–220 ms
- chip selection
- menu open
- asset selected

Standard: 240–400 ms
- bottom sheet
- PIX bubble
- position banner

Gameplay: 600–1200 ms
- launch
- success
- cash-out

# 9. Hold-to-launch animation
1. user presses
2. CTA glow increases
3. progress fills
4. rocket engine flickers
5. haptic at ~50%
6. launch at 100%
7. trade sheet collapses
8. rocket enters active-trade state

# 10. Hold-to-cash-out animation
1. hold begins
2. visible P&L snapshot freezes
3. progress grows
4. subtle vignette
5. haptic on confirmation
6. rocket exits/slows
7. result transition

# 11. Performance budget
Aim for:
- WebP/AVIF
- max 2–3 large 3D assets visible at once
- lazy-load result assets
- preload rocket + PIX states
- code-based particles where possible
- smooth 60 FPS chart + rocket

# 12. Asset folder
```text
assets/
├── pix/
│   ├── pix_idle.webp
│   ├── pix_ready.webp
│   ├── pix_pointing.webp
│   ├── pix_wave.webp
│   ├── pix_thinking.webp
│   ├── pix_happy.webp
│   ├── pix_alert.webp
│   ├── pix_celebrate.webp
│   ├── pix_loading.webp
│   ├── pix_sitting.webp
│   └── pix_avatar.webp
├── rocket/
│   ├── rocket_idle.webp
│   ├── rocket_flying.webp
│   ├── rocket_boost.webp
│   ├── rocket_down.webp
│   ├── rocket_success.webp
│   └── rocket_small.webp
├── environment/
│   ├── space_background_base.webp
│   ├── planet_horizon_gold.webp
│   ├── planet_blue.webp
│   ├── asteroid_01.webp
│   ├── asteroid_02.webp
│   └── asteroid_03.webp
└── effects/
    ├── launch_glow.webp
    ├── rocket_flare.webp
    ├── boost_particles.webp
    ├── success_burst.webp
    ├── success_ring.webp
    ├── sparkle_gold.webp
    └── danger_glow.webp
```
