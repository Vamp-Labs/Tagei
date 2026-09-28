# Tagei — Copywriting Reference

This is a reference brief, not finished copy. It collects every genuine, fact-backed unique
selling point in the product so that whoever writes the actual marketing material — landing
page, pitch deck, social posts, a pitch — can pull from real mechanisms instead of generic
crypto-app language. Every claim below cites the file it comes from, so it can be fact-checked
against the current spec rather than memory.

Use **Tagei** as the product name everywhere. (The PRD file is still named
`bnb_play_prd_v0_2_ui_motion.md` — that's a pre-rebrand filename, its content already says
"Tagei"; safe to ignore.)

---

## 1. The one-line positioning

Tagei turns a live crypto price into something a first-time player reads instantly: pick a
direction, watch a rocket ride the real market for 30 seconds, and see the outcome — while
every number involved is backed by a real, verifiable blockchain transaction, not a simulated
random-number generator.

**Elevator pitch (2–3 sentences):**

> Trading UIs assume you already understand candles, order books, and leverage. Tagei turns
> the same underlying market data into something anyone reads instantly — a rocket going up or
> down — while keeping every outcome provably tied to a real price feed and a real settlement
> transaction on BNB Smart Chain. It's not a simulated game bolted onto crypto; the market
> itself *is* the interface.
>
> *(Source: `bnb_play_prd_v0_2_ui_motion.md`, Product Vision; `README.md`, "Why this exists")*

---

## 2. Unique selling points

### A. Real, provable, on-chain — not gambling RNG

- **"You bet before anyone — including us — knows what the price will do."**
  A round's entry price is set 3 seconds in the future (`entrySec = block.timestamp + 3`) at
  the moment you commit — the price literally doesn't exist yet when you place the bet.
  Settlement later replays the real recorded path second-by-second, and the first barrier
  (target or stop) it touches decides the round.
  *(`docs/spec/F1a-contracts.md` §1, "Why this design")*

- **The "flight recorder" architecture — the strongest, most ownable differentiator.**
  Supra's standard on-chain oracle verifier only accepts the *latest* round for a price pair —
  older proofs get silently overwritten, so nothing about a past second can ever be proven
  again. Tagei bypasses this: its `StatelessSupraVerifier` calls Supra's committee signature
  verifier directly and checks a Merkle proof against the leaf data itself, so *any* historical
  second can be independently verified, not just the newest one. This is what actually makes
  "commit blind, settle honest" auditable rather than a slogan — worth leading with in any
  technical trust section, whitepaper, or judge-facing pitch.
  *(`docs/spec/F1a-contracts.md` §1; `contracts/README.md`, trust-model points 1–2)*

- **"Every round is independently checkable by anyone, forever."**
  The on-chain checkpoint ledger (`CheckpointOracle`) is permissionless and append-only: one
  immutable price per (pair, second), and recording isn't gated to Tagei's own operator, so no
  single party can censor or backdate a second. The API also exposes a proof endpoint so anyone
  can verify a round independently.
  *(`contracts/README.md`, trust-model point 2; `docs/spec/F1b-api-sse.md`, endpoint table)*

- **"If the data ever goes missing, you get your stake back — never a manufactured loss."**
  If price data stalls past a fixed timeout, the round voids and refunds the exact stake. A
  conflicting price flags a dispute and voids the round rather than silently picking a side.
  *(`contracts/README.md`, trust-model points 2 & 5; `docs/spec/F1a-contracts.md` §7)*

- **"Every result comes with a receipt."**
  Every round settles as a real, confirmed BSC Testnet transaction you can click and verify —
  not a database row.
  *(`README.md`, "What's real here" table)*

- **"Fixed multiplier if you're right, your stake if you're wrong, a fair proportional payout
  if the round ends in between."**
  Three-outcome payout model, enforced identically in the Solidity contract and the TypeScript
  client via shared golden-vector tests: target hit pays a fixed multiplier, stop hit pays
  zero, and anything in between pays proportionally to how far price moved. The house can't
  change a round's terms once it's open — every round snapshots its own lane, multiplier, and
  barriers at the moment it starts.
  *(`docs/spec/F1a-contracts.md` §6, §9; `contracts/README.md`, trust-model point 3 & 7)*

- **"Every dollar in the game is backed 1:1, verifiably, on-chain."**
  A ledger-conservation invariant (token balance = players + house + locked stakes + surplus)
  is enforced and tested, not just claimed.
  *(`contracts/README.md`, point 10; `docs/spec/F1a-contracts.md` §9)*

- **"Independently security-reviewed before anyone could play — and we say so honestly."**
  A formal contracts review returned a "PASS with fixes" verdict (98/98 tests, 7 proof-of-concept
  exploits run and resolved or tracked) — a disclosed, honest audit result is a stronger trust
  signal than a vague "fully audited, zero issues" claim, and should be framed that way rather
  than oversold.
  *(`docs/security/G1-contracts-review.md`; `README.md` status line)*

- **"One codebase, two languages, one truth."**
  The core settlement math lives in one shared TypeScript package and is mirrored bit-for-bit
  into Solidity, checked by differential tests against the same golden vectors — what the app
  shows you and what the contract pays out can never quietly drift apart.
  *(`README.md`, repo-layout table; `docs/spec/F1a-contracts.md`, differential-test rows)*

> **Note on numbers:** the lane math has real, published win-probability and house-edge figures
> per asset/tier, generated from real historical price data. Do **not** quote these as marketing
> "win odds" — the spec explicitly restricts oracle calibration data from ever being shown to
> players as win odds, and that restriction should extend to public copy too. Frame it instead
> as "we publish our math" or "every lane's edge is capped by an on-chain guard," without citing
> the percentages themselves.
> *(`docs/spec/F1b-api-sse.md`, restriction note; `docs/spec/F1e-lanes.md`, lane table)*

### B. Skill, not luck

- **"Ranked by how you play, never by how much you bet."**
  The leaderboard (weekly, resetting Monday 00:00 UTC, and all-time) ranks players by XP —
  explicitly never by P&L or win rate. Most crypto prediction apps rank by profit, which is
  functionally a gambling leaderboard; ranking by XP instead makes the entire competitive layer
  about engagement and skill, not variance. This is one of the most ownable positioning angles
  in the whole product.
  *(`docs/spec/F1d-progression.md`, "Leaderboard")*

- **"You can't buy your way to the top."**
  XP is awarded flatly per action and never scales with stake size: a fixed amount for
  completing any round at all, more for hitting a target, more for a disciplined early exit,
  a small bonus for reviewing your PIX debrief, and a streak bonus for playing daily. Betting
  bigger literally earns you nothing extra.
  *(`docs/spec/F1d-progression.md`)*

- **"Built to not manipulate you into chasing a loss."**
  These aren't just copy guidelines — they're enforced product rules: no loss-streak
  "comeback" bonuses, your stake is never auto-raised between rounds, and the faucet top-up is
  never offered on a loss screen (only from your profile, and only when your balance is
  genuinely low). A daily soft cap also halves and then zeroes XP after ~30–60 rounds a day, so
  the design actively discourages compulsive repeat play instead of rewarding it.
  *(`docs/spec/F1d-progression.md`, "Guardrails" / "Diminishing returns"; `CLAUDE.md`,
  "Responsible play")*

- **"A flight-academy career, not a VIP tier list."**
  Levels use flavor titles like CADET, NAVIGATOR, TRAILBLAZER, up through ORBIT LEGEND, rather
  than Bronze/Silver/Gold/Whale tiers. Badges are similarly skill-framed (first round played,
  a big multiplier hit, a run of disciplined exits) — the language of achievement, not the
  language of spend tiers.
  *(`docs/spec/F1d-progression.md`, "Levels & titles" / "Badges")*

### C. PIX — the AI co-pilot that explains, never predicts

- **"An AI that reads the market with you, but never tells you which way it'll go."**
  PIX has one hard-coded rule shared across every context it appears in: it can never say or
  imply that a price will move a certain direction, that a result is certain, or that a side is
  "the right pick." If a player asks directly which way to go, it says plainly that nobody can
  call it, and describes the current read instead.
  *(`server/src/pix/prompts.ts`, shared rules + `CHAT_SYSTEM`)*

- **"It coaches, it never nudges you to bet bigger."**
  PIX is explicitly barred from ever suggesting a stake size, suggesting a stake increase, or
  saying anything like "win it back" — and it never blames the player for a loss, framing it
  instead as a market outcome and a learning moment.
  *(`server/src/pix/prompts.ts`, shared rules)*

- **"Three roles, one consistent voice."**
  PIX shows up as a market interpreter before your round (a short, cited read of current
  conditions), a coach after it (a debrief that always labels the outcome precisely — it can
  never call a timeout or a cash-out a "win," or a loss anything but a loss), and a chat
  co-pilot for open questions. Every mode shares the same rule set, so the personality never
  drifts.
  *(`server/src/pix/prompts.ts`, `INSIGHT_SYSTEM` / `DEBRIEF_SYSTEM` / `CHAT_SYSTEM`)*

- **"It can't make numbers up."**
  PIX is fact-locked: it's instructed to use only the facts it's given and never write a number
  that isn't in them.
  *(`server/src/pix/prompts.ts`, shared rules)*

- **"A mood that mirrors your actual position, not manufactured hype."**
  PIX has a small, code-drawn expression with a mood ring that shifts with your real P&L —
  calm green when you're up, a muted amber when you're down, neutral otherwise — with natural
  blinking, no stock mascot art, no forced excitement.
  *(`docs/reskin/E5-pix.md`)*

> **Note:** keep PIX copy to "explains what happened," never "predicts." It also has a daily
> chat rate limit and a template fallback if no AI provider is configured — avoid "always-on,
> unlimited AI" framing.

### D. Zero-friction onboarding

- **"No wallet. No faucet hunting. No gas. Tap Play as Guest and you're trading in seconds."**
  Guest mode generates a burner wallet locally in the browser and signs everything silently —
  no wallet popup, no manual faucet claim — because the server relayer pays every transaction's
  gas on the player's behalf.
  *(`README.md`, "No wallet, no faucet, no gas needed to play"; `docs/spec/F1b-api-sse.md`,
  Auth section)*

- **"New players get real, spendable funds automatically."**
  A first guest session auto-funds a real testnet balance directly into the player's account —
  no begging a faucet contract, no separate step.
  *(`docs/spec/F1b-api-sse.md`, rate-limits table)*

- **"Graduate to a real wallet anytime, without losing anything."**
  Guest play coexists with real wallet connections (MetaMask, WalletConnect) on the same chain,
  so upgrading later doesn't reset progress.
  *(`README.md`, architecture diagram)*

### E. A disciplined, game-show visual identity

- **"One obvious next move, every screen."**
  Exactly one bright "hot" call-to-action is allowed per screen — enforced as a design rule
  across the whole app — stripping away the multi-panel clutter typical of trading terminals in
  favor of a single, obvious next action.
  *(`docs/reskin/README.md`, "Visual rubric")*

- **"Winning a SHORT always looks like winning."**
  Direction (LONG/SHORT) and outcome (profit/loss) are two completely separate color systems
  that never bleed into each other — a profitable SHORT position reads in the same win color as
  a profitable LONG, never a "down = red" trading-terminal convention.
  *(`docs/reskin/E6-canvas.md`)*

- **"There is no red in this app."**
  Losses render in a calm amber, not an alarming red — a deliberate, explicit design decision.
  Result copy reads like a flight debrief ("Stop honored. Good risk control.") rather than
  "YOU LOST," and there's never a "win it back" prompt.
  *(`docs/DESIGN_TOKENS.md`; `docs/reskin/README.md`, decisions table)*

- **"The rocket doesn't sit on top of the chart — it *is* the chart."**
  The rocket's position and rotation are computed directly from the live recorded price path,
  not a decorative animation layered over a separate data view.
  *(`docs/ASSET_MOTION_SPEC.md` §6)*

---

## 3. How it works (plain-language flow)

The simple version, for anyone who isn't a developer:

1. **Tap "Play as Guest."** No wallet install, no seed phrase, no gas to buy first — you're in
   and funded in seconds. (Or connect MetaMask/WalletConnect if you already have a wallet.)
2. **Pick an asset, pick a direction.** Choose BNB, BTC, ETH, SOL, or DOGE, go LONG or SHORT,
   set your stake.
3. **Watch your rocket fly the real market.** For about 30 seconds, a rocket rides the actual
   live price of that asset — not a simulation.
4. **The round settles on-chain.** Either your target is hit (fixed payout), your stop is hit
   (you lose only your stake), you cash out early, or time runs out — every outcome settles as
   a real blockchain transaction you can verify yourself.
5. **PIX debriefs what happened.** A short, honest explanation of the round — what the market
   did, what your result means — never a prediction, never a guilt trip.
6. **You level up for how you played, not how much you bet.** Earn XP for playing, for
   disciplined exits, for reviewing your debriefs; climb the weekly or all-time leaderboard;
   level up your pilot title.

---

## 4. Brand voice & tone rules

For whoever writes the actual copy from this brief:

- **Calm and specific, never hype.** No exclamation points anywhere in copy except the one hot
  call-to-action per screen (and even that should stay to a single "!").
- **Never frame a loss as failure.** No "YOU LOST," no "WIN IT BACK," no pressure to replay
  immediately. A loss is a market outcome, described plainly.
- **Never quote win-probability or house-edge numbers as a marketing claim.** These exist and
  are published internally, but showing them to players (or in public copy) as "win odds" is
  explicitly restricted in the spec. Talk about *fairness mechanisms* (on-chain proof, capped
  house edge, disclosed audit) instead of citing the numbers themselves.
- **Never overstate PIX.** It explains, it doesn't predict; it has rate limits and a fallback
  mode — avoid "always-on, all-knowing AI" language.
- **Lead with mechanism, not adjective.** Every claim in this doc has a real mechanism behind
  it — prefer "settlement replays the recorded price path" over "fully transparent," and let
  the mechanism do the persuading.

---

## 5. Source index

| Theme | Primary files |
|---|---|
| On-chain settlement / trust mechanics | `docs/spec/F1a-contracts.md`, `contracts/README.md` |
| Payout / lane economics | `docs/spec/F1e-lanes.md`, `docs/spec/F1a-contracts.md` §6, §9 |
| API / onboarding / rate limits | `docs/spec/F1b-api-sse.md` |
| Security review | `docs/security/G1-contracts-review.md` |
| Progression, XP, leaderboard | `docs/spec/F1d-progression.md` |
| PIX system prompts | `server/src/pix/prompts.ts` |
| Visual identity / design rules | `docs/reskin/README.md`, `docs/reskin/E1-home.md`–`E6-canvas.md`, `docs/DESIGN_TOKENS.md`, `docs/ASSET_MOTION_SPEC.md`, `docs/UI_UX_SPEC.md` |
| Product thesis | `bnb_play_prd_v0_2_ui_motion.md` |
| Non-negotiables / responsible play | `CLAUDE.md` |
| Live status / what's real | `README.md` |
