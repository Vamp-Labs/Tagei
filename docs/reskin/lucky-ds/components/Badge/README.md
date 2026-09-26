# Badge

Small status marks: the gold `pro` pill, the hot `count` disc (the bonus level "36" that sits on a panel edge) and the green `check` on claimed rewards.

- Provide: `tone` (`pro` | `count` | `check`) and `children` for `pro` / `count`. `check` takes an optional `label` (defaults to "Claimed").
- `count` carries a 4px `bg-sheet` ring so it can straddle the top edge of a panel.
- `pro` means a paid tier, nothing else; don't reuse gold for generic highlights.
