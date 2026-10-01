# Tagei: hackathon submission pack

Copy each file into the matching form field.

| Form field | File | Format |
|---|---|---|
| **Problem Statement** * | [`problem-statement.md`](problem-statement.md) | Markdown |
| **Solution** * | [`solution.md`](solution.md) | Markdown |
| **Project Detail** * | [`project-detail.md`](project-detail.md) | Markdown with Mermaid diagrams (6 diagrams, all validated) |

Extras for the pitch, the demo and social:

- [`pitch-kit.md`](pitch-kit.md): catch lines, hooks, 30 s / 60 s / 3 min pitch, demo script, social copy, judge Q&A, say / don't say.
- [`assets/`](assets/): 10 current app screenshots plus `overview.png`.

## Before you submit

These are things only you can confirm. The pack avoids claiming them.

- [ ] **Backend is up.** When last probed (2026-10-01), `https://bnb-play-server-production.up.railway.app/healthz` returned HTTP 502. Redeploy, then run `node tools/demo-check.ts`. If it stays down, demo in **Settings, Mode, Practice**.
- [ ] **Contracts verified on BscScan?** Not confirmed here (BscScan blocks scripted requests). Open the Arena address and check for the green tick.
- [ ] **Re-capture screenshots in live mode** if the backend is up. The screenshots in `assets/` were taken in Practice mode, so they show "PRACTICE · NOT ON-CHAIN".
- [ ] **Upload the video** and paste the link into `project-detail.md` (section 13 currently names the file but has no URL).
- [ ] **Add a LICENSE** to the repo if the hackathon asks for one (there is none today).
- [ ] **Add a team section** to `project-detail.md` if the form expects one.
- [ ] **Re-run the tests** before quoting numbers: `pnpm test:all` and `cd contracts && forge test`. The pack says "100+ Foundry tests" and "250+ TypeScript tests" from a static count. Some server tests need Postgres or anvil.

## Facts the pack relies on

| Claim | Source in the repo |
|---|---|
| 30 s rounds, entry 3 s after commit, void after 60 s of missing data | `packages/shared/src/constants.ts` |
| Stake 5 to 50 tUSD, default 10 | `src/game/lanes.ts`, `src/App.tsx` |
| Hold to launch is 700 ms on touch, instant for mouse and keyboard | `src/ui/HoldButton.tsx` |
| CRUISE 1.5x and BOOST 2x live, HYPER 3x and WARP 5x disabled | `contracts/deployments/97.json`, `docs/spec/F1e-lanes.md` |
| 1% fee on cash-out and timeout, void refunds the stake | `docs/spec/F1a-contracts.md`, `contracts/config/97.json` |
| Deployed addresses on chainId 97 | `contracts/deployments/97.json` |
| PIX never predicts, output filter, 30 chats per day | `server/src/pix/prompts.ts`, `packages/shared/src/pix.ts` |
| XP never scales with stake, leaderboard ranks XP only | `docs/spec/F1d-progression.md` |
| Guest wallet is gasless, key stays in the browser | `src/web3/guest.ts` |
