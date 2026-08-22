# HeyGen API setup

This repo uses HeyGen in two ways: the **HyperFrames CLI** (video-as-code, under
`videos/`) and the **HeyGen REST API** (via `scripts/heygen.mjs`). Both read the
same `HEYGEN_API_KEY`.

## 1. Get your API key

1. Log in at [app.heygen.com](https://app.heygen.com).
2. Go to **Settings → API** (<https://app.heygen.com/settings/api>).
3. Copy the **API Key**. Treat it like a password.

## 2. Add it locally

```bash
cp .env.example .env
# then edit .env and paste your key after HEYGEN_API_KEY=
```

`.env` is git-ignored, so your real key never gets committed. Confirm:

```bash
git check-ignore .env   # prints ".env"
```

## 3. Use it with the HyperFrames CLI

The CLI reads `HEYGEN_API_KEY` from the environment. Export it, then run the
publish script from a video folder:

```bash
export HEYGEN_API_KEY=your_key_here
cd videos/data-beat-8-8t
npm run publish
```

Or inline for a single command:

```bash
HEYGEN_API_KEY=your_key_here npm run publish
```

## 4. Use it with the REST API

`scripts/heygen.mjs` wraps the HeyGen v2 API. Node 20.6+ can load `.env`
directly with `--env-file`:

```bash
# Verify the key is accepted
node --env-file=.env scripts/heygen.mjs check

# Discover ids you can use
node --env-file=.env scripts/heygen.mjs avatars
node --env-file=.env scripts/heygen.mjs voices

# Generate a video (needs HEYGEN_AVATAR_ID and HEYGEN_VOICE_ID in .env)
node --env-file=.env scripts/heygen.mjs generate "Hello from HeyGen"

# Poll its status
node --env-file=.env scripts/heygen.mjs status <video_id>
```

You can also `import` the helpers from other Node code:

```js
import { generateVideo, getVideoStatus } from "./scripts/heygen.mjs";
```

## Troubleshooting

- **401 Unauthorized** — the key is wrong or not being read. Check `.env` and
  that you passed `--env-file=.env` (or exported the variable).
- **`HEYGEN_API_KEY is not set`** — you ran the script without loading `.env`.
- Never paste your key into source, commit messages, or issues. Rotate it in the
  HeyGen dashboard if it leaks.
