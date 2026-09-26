// Motion memoises an SVG element's static style at mount, so HoldButton's `opacity: isHolding ? 1 : 0` on its ring rect never updates; at rest the ring is fully dash-offset and invisible anyway.
export const HOLD_RING_VISIBLE = '[&>svg>rect]:!opacity-100';
