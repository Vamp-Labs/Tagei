# RewardTile

A square in the Rewards grid. States: `claimed` (green check, name, countdown), `selected` (lucky border glow), `locked` (silver art with a progress stripe), `pro` (silver art with a gold "pro" label).

- Provide: `state`, `art`, and for `claimed` a `name` and `timer` (HH:MM:SS). For `locked`, `progress` (0–100) and `progressTone` (`amber` default, `lucky` when nearly there). Glyph-only tiles need a `label`.
- Laid out three across with `space-2` gaps inside a Panel.
- Colored art = available; silver art = not yet yours.
