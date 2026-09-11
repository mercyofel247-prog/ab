# Repository guidance for Claude

## Video rendering — ALWAYS use cloud rendering

**Any request to make, produce, or render a video in this repo defaults to
HyperFrames cloud rendering (HeyGen).** Cloud is the default path — but the
user is always asked to confirm first, and **if they decline the cloud render,
render it locally instead** (never do nothing). The user may also ask for a
local render outright in the request.

- Render with `npm run cloud` (fire-and-forget, returns a `render_id`) or
  `npm run cloud:wait` (blocks and downloads the MP4 to `renders/`), run from
  the video project directory (e.g. `videos/<name>/`).
  Equivalent: `hyperframes cloud render …`.
- **Confirm before every cloud render.** A cloud render spends the wallet, so
  always ask the user for explicit go-ahead immediately before submitting one,
  every time — never batch-approve or assume standing consent. A PreToolUse
  hook (`.claude/hooks/confirm-cloud-render.sh`) also forces a confirmation
  prompt on any `cloud render` / `npm run cloud[:wait]` command as a backstop;
  `--dry-run` and the read-only `cloud list` / `cloud get` are exempt.
- **On decline → local render.** If the user says no to the cloud render (or the
  hook denies it), render the deliverable locally instead with `npm run render`
  (`hyperframes render`) and hand over that MP4 — do not stop with nothing.
- **On missing auth/wallet → local render.** If `HEYGEN_API_KEY` auth or the
  wallet is unavailable (`hyperframes auth status` to check), say so, then fall
  back to a local render rather than failing.
- Local `check` / `snapshot` for verification always runs locally, costs
  nothing, and catches layout bugs before any render — do it regardless of
  render path.
- New video projects should be scaffolded like `videos/oxblood-countdown/`:
  `hyperframes` pinned as a local devDependency and the full script set wired
  (see "Render performance defaults" below), so rendering stays fast (no
  `npx --yes` cold-start).

This rule is about the rendering step only. A prompt that does not ask for a
video has nothing to render, and normal judgment applies to everything else.

## Render performance defaults

Full runbook: `videos/RENDERING.md`. These defaults are already wired into every
video project's `package.json` and persist automatically — the committed scripts
plus `.claude/hooks/session-start.sh` (which `npm install`s each
`videos/*/` that ships a `package-lock.json`) mean there is nothing to redo each
session. Apply the same wiring to any NEW video project.

- **Local renders use 4 workers by default** (`npm run render` → `hyperframes render -w 4`).
  On this repo's typical box that is ~1.7× over the auto default; `-w <cores>` is
  the local ceiling. There is **no GPU in this container** (SwiftShader software
  render), so `render:gpu` (`--browser-gpu --gpu`) is staged for a GPU machine and
  is a no-op here.
- **Iterate with `npm run render:draft`** (draft quality, 1080p) and, better,
  don't render to check at all — use `hyperframes preview --background` +
  `hyperframes snapshot` + `npm run check`.
- **Keep 1080p / 24–30fps while iterating**; 4k is ~4× the pixels and 60fps ~1.7×
  the frames. Reserve `-q high` for the master.
- **Fan-out for the real 10×+**: `npm run lambda:render` (AWS) or
  `npm run cloudrun:render` (GCP) after a one-time `*:deploy` — the only way past
  the local worker ceiling. Both need cloud credentials; see the runbook.
- Standard script set per project: `render`, `render:draft`, `render:gpu`,
  `cloud`/`cloud:wait`/`cloud:list`/`cloud:get`,
  `lambda:deploy`/`lambda:render`/`lambda:destroy`,
  `cloudrun:deploy`/`cloudrun:render`/`cloudrun:destroy`.
