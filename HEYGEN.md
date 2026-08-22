# HeyGen cloud rendering (HyperFrames)

HyperFrames can render compositions on **HeyGen's cloud** — no local Chrome or
FFmpeg needed. This doc covers how the API key is supplied and how to run a
cloud render.

## How authentication works

The HyperFrames CLI authenticates to HeyGen with an API key read from the
**`HEYGEN_API_KEY`** environment variable. Confirm what it sees with:

```bash
npx hyperframes auth status
# Source: env (HEYGEN_API_KEY)
# Type:   api_key
```

There are two ways to provide the key:

1. **Environment variable (used by this environment).**
   This Claude Code environment already injects a real `HEYGEN_API_KEY`, so the
   CLI is authenticated automatically — nothing to add. To set it yourself
   elsewhere:
   ```bash
   export HEYGEN_API_KEY=sk_...        # your key from app.heygen.com → Settings → API
   ```
   For local dev you can keep it in a git-ignored `.env` (see `.env.example`) and
   load it with `node --env-file=.env`, or `export` it in your shell.

2. **Stored credential via `auth login`** (persists to the CLI's config, no env
   var needed afterward):
   ```bash
   npx hyperframes auth login --api-key      # prompts for the key on stdin
   # or OAuth in a browser:
   npx hyperframes auth login
   ```

Get your key at **app.heygen.com → Settings → API**
(<https://app.heygen.com/settings/api>). Treat it like a password — it is
git-ignored via `.env`; never commit it or paste it into source/issues.

## Running a cloud render

From a video project directory (e.g. `videos/data-beat-8-8t`):

```bash
cd videos/data-beat-8-8t

npm run auth:status            # verify the key is picked up
npm run render:cloud           # cloud render index.html → renders/<id>.mp4
npm run cloud:list             # list recent cloud renders
```

`render:cloud` maps to `hyperframes cloud render`. Useful flags (pass after `--`,
e.g. `npm run render:cloud -- --quality high`):

- `--quality draft|standard|high` (default `standard`)
- `--resolution 1080p|4k` (4k billed at 1.5x)
- `--aspect-ratio 16:9|9:16|1:1`
- `--fps <1-240>` (default 30)
- `-c, --composition <file>` — entry HTML (default `index.html`)
- `--no-wait` — submit and exit with the render id (fire-and-forget)
- `-o, --output <path>` — where to save the downloaded video
- `--dry-run` — build/inspect the zip without authenticating or uploading

Manage renders with `hyperframes cloud list | get <id> | delete <id>`.

## Network requirement (Claude Code on web)

Cloud rendering calls `api.heygen.com`. This environment's **network egress
policy currently blocks that host** (`403 Host not in allowlist`), so a cloud
render started from a web session will fail until `api.heygen.com` is added to
the environment's allowed egress hosts. It works without any change from your
local machine. To allow it for web sessions, add `api.heygen.com` to the
environment's network settings — see
<https://code.claude.com/docs/en/claude-code-on-the-web>.

Quick check from inside a session:
```bash
npx hyperframes auth status
# "API check failed: ... Host not in allowlist: api.heygen.com" → egress blocked
# a clean status line                                            → reachable
```

## Raw REST API helper (optional)

`scripts/heygen.mjs` is a small wrapper over HeyGen's REST API (avatars, voices,
video generation) — separate from HyperFrames cloud rendering, handy for
scripting or verifying the key against the API directly. It also reads
`HEYGEN_API_KEY`:

```bash
node --env-file=.env scripts/heygen.mjs check
```

## Troubleshooting

- **`Host not in allowlist: api.heygen.com`** — egress policy blocking the host
  (see the network section above). Not a key problem.
- **401 Unauthorized** — the key is wrong or expired. Rotate it in the HeyGen
  dashboard and re-set `HEYGEN_API_KEY`.
- **`auth status` shows no credential** — export `HEYGEN_API_KEY` or run
  `hyperframes auth login`.
