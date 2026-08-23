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
  `hyperframes` pinned as a local devDependency and `npm run cloud*` scripts
  wired, so rendering stays fast (no `npx --yes` cold-start).

This rule is about the rendering step only. A prompt that does not ask for a
video has nothing to render, and normal judgment applies to everything else.
