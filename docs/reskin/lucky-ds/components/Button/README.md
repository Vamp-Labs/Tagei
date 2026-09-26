# Button

Three shapes: `hot` for the one play/claim action on a screen, `secondary` for quiet actions at the end of a list (Add new), `icon` / `arrow` for glyph-only navigation.

- Provide: `variant` (`hot` | `secondary` | `icon` | `arrow`), `children` for text variants, `icon` (`back`, `grid`, `plus`, `chevron-left`, `chevron-right`) and an `aria-label` for glyph-only variants, plus any native button props.
- `hot` is uppercase, weight 800, ending in "!" (FREE PLAY!). One per screen — it is the only red on the page besides count badges.
- `arrow` is the white disc used over the hero carousel on `lobby`; `icon` is the navy disc (`bg-control-hover`) used in headers.
- Don't put `hot` labels under 19px bold: white on `hot` is 4.1:1.
