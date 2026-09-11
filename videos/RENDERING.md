# Render performance runbook

Fast, repeatable rendering for the HyperFrames video projects in this repo
(`hyperframes-promo`, `oxblood-countdown`, `data-beat-8-8t`). Every project wires
the same `npm run` scripts, so the commands below work from any
`videos/<project>/` directory.

## This box has NO GPU

Checked: no `nvidia-smi`, no `/dev/dri`, no VGA device. HyperFrames renders here
on Chrome's **SwiftShader** software path (`browserGpuMode → software`). That
caps local render speed — the GPU-only levers below are staged for a GPU
machine and will not accelerate anything in this container.

Measured on this 4-core box (8s @ 1080p promo): **1 worker 32.4s → 4 workers 18.9s (~1.7×)**.
Benchmark winner: `30fps · standard · 4w`.

## The fast loop (creation) — do this instead of rendering to check

Rendering to preview a change is the slow habit. Use the live preview + cheap
verification instead:

```bash
npx hyperframes preview --background     # persistent hot-reload Studio (agent-safe)
npx hyperframes preview --status         # confirm it's listening
npx hyperframes snapshot --at 2.5,4.3,7.4  # a few PNGs at chosen beats — seconds, not a full render
npm run check                            # lint + runtime + layout + contrast, pre-render
npx hyperframes preview --stop           # when done
```

## Rendering — pick by where you are

| Command | Use when | Notes |
|--|--|--|
| `npm run render:draft` | iterating, need a quick video | draft quality, 1080p, 4 workers |
| `npm run render` | final local master | 4 workers (the local ceiling on 4 cores) |
| `npm run render:gpu` | **on a GPU machine only** | `-w 8 --browser-gpu --gpu`; no-op/fallback here |
| `npm run cloud:wait` | offload one render to HeyGen | spends the HeyGen wallet — confirm first |
| `npm run lambda:render` | fan-out heavy/4k/batch on AWS | needs one-time `lambda:deploy` |
| `npm run cloudrun:render` | fan-out heavy/4k/batch on GCP | needs one-time `cloudrun:deploy` |

Discipline that matters: stay at **1080p / 24–30fps** while iterating (4k is ~4×
the pixels; 60fps ~1.7× the frames), and reserve `-q high` for the master.
`npx hyperframes benchmark --runs 1` prints the fastest config for the current host.

## One-time setup for the fan-out paths (the real 10×+)

These distribute frames across many cloud workers — the only way past the local
4-worker ceiling. Each needs credentials this container does not have, so run
them from a machine that does; the deploy is one-time and cached.

### AWS Lambda
```bash
# prerequisites: AWS credentials in env (AWS_PROFILE / AWS_REGION or aws configure)
npm run lambda:deploy       # creates the CloudFormation stack + render site (one-time)
npm run lambda:render        # fans out ~16 parallel chunks (default), downloads the MP4
npm run lambda:destroy      # tear down when finished
```
Tuning lives on the `render` script: `--max-parallel-chunks`, `--chunk-size`,
`--memory` (default 10240 MB), `--concurrency`.

### Google Cloud Run
```bash
# prerequisites: gcloud auth + a GCP project id
npm run cloudrun:deploy -- --project YOUR_GCP_PROJECT_ID   # one-time (builds image via Cloud Build)
npm run cloudrun:render                                    # fan-out render
npm run cloudrun:destroy -- --project YOUR_GCP_PROJECT_ID
```
`npm run <script> -- <extra flags>` forwards flags to the underlying
`hyperframes` command (e.g. `--region`, `--cpu`, `--memory`).

## Why this persists session-to-session

Nothing here needs redoing each session:

- **All `npm run` scripts** live in each project's committed `package.json`.
- **Pinned local CLIs** — each project commits a `package-lock.json`, and
  `.claude/hooks/session-start.sh` runs `npm install` for every
  `videos/*/` that has one, on every session start. That restores the fast
  local `hyperframes` binary (no `npx --yes` cold-start) automatically.
- **New projects**: scaffold them with a pinned local `hyperframes` devDependency
  and copy these scripts (see the repo-root `CLAUDE.md`), so they inherit the
  same defaults.
