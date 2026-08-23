# Repository guidance for Claude

## Video rendering — ALWAYS use cloud rendering

**Any request to make, produce, or render a video in this repo MUST be rendered
with HyperFrames cloud rendering (HeyGen), never a local render** — unless the
user explicitly asks for a local render in that same request.

- Render with `npm run cloud` (fire-and-forget, returns a `render_id`) or
  `npm run cloud:wait` (blocks and downloads the MP4 to `renders/`), run from
  the video project directory (e.g. `videos/<name>/`).
  Equivalent: `hyperframes cloud render …`.
- Do **not** use local rendering for the deliverable — not `hyperframes render`
  and not `npx remotion render`. Local `check` / `snapshot` for verification is
  still fine (they run locally, cost nothing, and catch layout bugs before a
  paid render), but the final video always comes from the cloud.
- Cloud rendering is wallet-billed via `HEYGEN_API_KEY` (`hyperframes auth
  status` to confirm). If auth or wallet is unavailable, say so and stop —
  do not silently fall back to a local render.
- New video projects should be scaffolded like `videos/oxblood-countdown/`:
  `hyperframes` pinned as a local devDependency and `npm run cloud*` scripts
  wired, so rendering stays fast (no `npx --yes` cold-start).

This rule is about the rendering step only. A prompt that does not ask for a
video has nothing to render, and normal judgment applies to everything else.
