# Handoff to the integration lead (A0) / A6

`feat/lucky-reskin` is **ready to merge into `integration`**.

- `git merge-tree --write-tree integration feat/lucky-reskin` → **no conflicts** (checked against `integration` @ `cd07916`).
- typecheck, 27 tests and build green; all 29 dev scenes shot; QA two rounds (see `QA.md`).
- Scope: look only. No changes to services, types, `main.tsx`, `test/**` or any root config. App.tsx changes are the shell styling and the dev-only `useDevScene` hook.
- Visual baseline for A6's motion-parity check: `screenshots/lucky/` (not the v0.2 `screenshots/mobile/`).
- New UI must use `src/ui/lucky` + `docs/reskin/lucky-ds`; contracts in `docs/reskin/CONTRACTS.md`, tokens in `docs/DESIGN_TOKENS.md`.
- Deferred to A6 (App logic): see "Deferred to A6" in `INTEGRATION_LOG.md` — tick-loop re-subscribe ("Maximum update depth"), hardcoded fallbacks, $-scale FX/PIX thresholds, focus trap for drawer/modal.
- Dev tooling: `?scene=<name>&freeze=1` deep links and `bash scripts/shots.sh --port N --out DIR --all` (uses `/tmp/bnbplay-heavy.lock`).
