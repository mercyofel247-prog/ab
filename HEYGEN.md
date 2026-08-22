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

**Rendering defaults to the cloud.** `npm run render` runs `hyperframes cloud
render` — the local Puppeteer/FFmpeg path is kept as `npm run render:local` for
when you explicitly want an on-machine render.

From a video project directory (e.g. `videos/data-beat-8-8t`):

```bash
cd videos/data-beat-8-8t

npm run auth:status            # verify the key is picked up
npm run render                 # cloud render index.html → renders/<id>.mp4 (default)
npm run cloud:list             # list recent cloud renders
npm run render:local           # opt out to a local render instead
```

Every network-touching script (`render`, `render:cloud`, `cloud:list`,
`auth:status`, `publish`) sets `NODE_USE_ENV_PROXY=1` so the HyperFrames CLI's
`fetch` honors the session proxy in Claude Code web environments (see the network
section below). This is harmless on a local machine. On **Windows `cmd`** the
inline `VAR=1 ...` prefix isn't supported — run cloud renders from Git Bash/WSL,
or set `NODE_USE_ENV_PROXY=1` in your shell first; locally the proxy isn't
involved at all, so `render:local` needs nothing.

`render` / `render:cloud` map to `hyperframes cloud render`. Useful flags (pass
after `--`, e.g. `npm run render -- --quality high`):

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

Cloud rendering calls `api.heygen.com`, so two things must be true in a Claude
Code web session:

1. **`api.heygen.com` is on the environment's egress allowlist.** Set the
   environment's **Network access** to **Custom** and add `api.heygen.com` under
   **Allowed domains** (keep "Also include default list of common package
   managers" checked). See
   <https://code.claude.com/docs/en/cloud-environments#access-levels>.
2. **`NODE_USE_ENV_PROXY=1` is set** so the CLI's `fetch` routes through the
   session proxy. The npm scripts already set this; it's also worth adding to the
   environment's variables so ad-hoc `npx hyperframes …` commands work too.

Neither is needed on a local machine — there's no proxy, and `render:local`
avoids `api.heygen.com` entirely.

Quick check from inside a session (use the same proxy var):
```bash
NODE_USE_ENV_PROXY=1 npx hyperframes auth status
# Account / Wallet lines                            → reachable and authenticated
# "... Host not in allowlist: api.heygen.com"       → egress not allowlisted,
#                                                      OR NODE_USE_ENV_PROXY unset
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

- **`Host not in allowlist: api.heygen.com`** — either `api.heygen.com` isn't on
  the environment's egress allowlist, or `NODE_USE_ENV_PROXY=1` wasn't set so the
  CLI bypassed the proxy. See the network section above. Not a key problem.
- **401 Unauthorized** — the key is wrong or expired. Rotate it in the HeyGen
  dashboard and re-set `HEYGEN_API_KEY`.
- **`auth status` shows no credential** — export `HEYGEN_API_KEY` or run
  `hyperframes auth login`.
