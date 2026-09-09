# Voice-over — generating the narration spine (AI84.pro TTS)

The VO is the spine the whole edit syncs to (see `audio.md` R0 — the voice
always wins). Usually it is **provided**. When it is not, generate it here with
`scripts/generate_voiceover.py`, which drives the **AI84.pro** async
text-to-speech API (ElevenLabs voices) and drops a narration file into
`<project>/vo/`. From there the pipeline is unchanged: `build_timeline.py`
auto-detects the first audio file in `vo/`, and `assemble.py` mixes everything
under it.

This script does NOT write narration copy — that is the M-HYBRID master
prompt's job. Feed it the finished VO script; it turns text into audio.

## Confirm before you spend
Generation **spends credits** (same principle as the repo's cloud-render rule:
confirm before spending). Always:
1. Preview the cost first with `--estimate` (no credits spent, no job enqueued).
2. Get the user's explicit go-ahead before the real run.
Check remaining balance any time with `GET /v1/credits`.

## Auth (never hard-code the key)
Set the key in the environment; it is sent as the `xi-api-key` header:
```bash
export AI84_API_KEY=sk-...     # XI_API_KEY / ELEVENLABS_API_KEY also accepted
```
A paid account is required for generation (otherwise 403). `--estimate` and
`--list-voices` browsing need no paid plan.

## Pick a narrator voice
Money-doc narration reads best in a **deep, authoritative, measured** voice
(the M-HYBRID default). Browse candidates:
```bash
python3 .claude/skills/magnate-cut/scripts/generate_voiceover.py \
    --list-voices --gender male --search narrator
```
Copy a `voice_id` from the list. Keep the SAME voice across the whole video
(one narrator = continuity, the audit's guiding principle).

## Generate
```bash
# 1) preview cost (spend nothing)
python3 .claude/skills/magnate-cut/scripts/generate_voiceover.py <project> \
    --text-file script.txt --model eleven_multilingual_v2 --estimate

# 2) after go-ahead, generate into <project>/vo/narration.mp3
python3 .claude/skills/magnate-cut/scripts/generate_voiceover.py <project> \
    --text-file script.txt --voice-id <VOICE_ID> \
    --model eleven_multilingual_v2 [--language en] [--transcript]
```
- `--model` — default `eleven_multilingual_v2`. Others: `eleven_v3` (best, needs
  a paid plan), `eleven_turbo_v2_5`, `eleven_flash_v2_5`, `eleven_turbo_v2`,
  `eleven_flash_v2`. Omitting a model server-side falls back to multilingual v2.
- `--transcript` — also downloads the SRT next to the audio; handy for lining
  narration timing up with segment durations in the timeline.
- `--out` — output filename inside `vo/` (default `narration.mp3`).

## How the async flow works (the script handles it; know it for debugging)
1. `POST /v2/text-to-speech/async` returns a `job_id` immediately — no audio yet.
   Credit-consuming, rate-limited to 60/min per IP; a 429 carries `Retry-After`.
2. `GET /v2/text-to-speech/async/:job_id` is polled every ~3s. Status is a
   CLOSED set — `queued` / `processing` / `done` / `failed`. There is no
   `completed`. `done` = success; `failed` = failure; anything else is treated
   as non-terminal and polled again. Polling is NOT rate-limited.
3. A **5xx during polling is not a failure** — the job is still running; keep
   polling. An HTTP 200 does not mean success either — always check
   `job.status`.
4. On `done`, download the signed `audioUrl` promptly (it expires). The CDN host
   may differ from the API base — the script follows the URL as given; treat the
   `?token=` as opaque (never parse or rebuild it).

## When a job fails
The job object carries a structured envelope — branch on the stable
`errorMessageKey`, never on message text:
- `errorMessage` — safe to show the user as-is.
- `errorCategory` — `1` = your input caused it (fix it; retrying unchanged fails
  again, e.g. a bad `voice_id` → `internal.VOICE_NOT_FOUND_LOCAL`); `2` = their
  side / transient (safe to retry later).
- `errorMessageKey` / `errorCode` / `errorContext` — machine-readable detail.
Failed jobs are **not billed** (`credit_cost` drops to 0). The script surfaces
all of these in its JSON on failure.

## After generation
The narration is in `vo/`. Run `build_timeline.py <project>` — it picks up the
VO automatically (no timeline edit needed) — then design audio and assemble as
usual. Everything downstream still obeys `audio.md`: the bed ducks under this
VO, SFX sit in its gaps, and the reveal gets its scored silence.
