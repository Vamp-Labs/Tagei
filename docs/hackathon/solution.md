**Tagei turns a live crypto price into a game you can read in one glance, play with one thumb, and verify on-chain.**

*Live markets, played like a game, settled on BNB Chain.*

You pick a side, **hold**, and a rocket rides the real market for 30 seconds. The round ends when it touches the target, touches the stop, you cash out, or time runs out. Then it settles on BNB Smart Chain from recorded oracle prices, and you get a receipt.

**Pick a side. Hold. Ride.**

### How Tagei solves each problem

**The market is the interface.**
There are no candlesticks and no order book. The *Market Track* is a glowing line, and the rocket is the price. A beginner sees up, down, target and stop, and understands the game without being taught.

**One gesture.**
The whole trade is *Play, pick LONG or SHORT, hold.* Asset, stake and tier are preselected, so direction is the only real decision. Money actions are protected by a press-and-hold (700 ms on touch, with haptic ticks) so a thumb stretching for the screen cannot fire one by accident. On desktop it is instant.

**No wallet wall.**
*Play as Guest* is instant and gasless. A key is created in the browser, signing happens locally, and a relayer pays the gas. People with a browser wallet can use that instead.

**Every result has a receipt.**
Supra DORA-2 prices are recorded on-chain once per second into an append-only checkpoint oracle. Settlement replays those exact checkpoints (never the smoothed price you see on screen), and the same evaluator runs in TypeScript and in Solidity, checked against shared golden test vectors. If oracle data goes missing, the round is voided and the stake is returned.

**AI that explains, never predicts.**
*PIX*, the fox co-pilot, explains what the track is doing and debriefs each round. It is built and filtered so it never says which way the price will go.

**Progress by playing, not by betting more.**
XP never scales with stake. Daily goals and streaks drive return visits, and the leaderboard ranks XP, not profit. There is no auto-raised stake, no loss-streak bonus and no "win it back" copy.

### Why BNB Chain
A fresh on-chain round every 30 seconds, paid for by a relayer so the player never touches gas, only works on a fast, low-fee chain. BNB Smart Chain gives Tagei that, plus an audience that already trades these assets.

**The result:** a first trade that takes seconds to understand, thirty seconds to play, and one tap to verify. Right now Tagei runs on BNB Smart Chain Testnet with valueless test tokens.
