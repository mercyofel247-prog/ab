# Voiceover — generating the VO spine with a TTS provider

`magnate-cut` normally takes the voice-over as a **provided** input (real
narration is the MagnatesMedia doctrine — Part 26 / Part 18 assume ElevenLabs-
grade VO). When you don't have one, `scripts/tts.py` synthesizes a VO here and
writes it into a project's `vo/` folder so the pipeline has its spine.

> This is a convenience for drafts / when no human narration exists. For a final
> film, a real recorded/ElevenLabs narration still reads best; a synthesized VO
> steps into the same slot mechanically.

## Providers
| provider | base | key env | status |
|---|---|---|---|
| `ai84` | `https://api.ai84.pro` | `AI84_API_KEY` | wired — v2 JSON job (ElevenLabs + MiniMax voices) |
| `ai33` | `https://api.ai33.pro` | `AI33_API_KEY` | wired — v3 unified endpoint (ElevenLabs / MiniMax / Edge / Kokoro / vbee / FishAudio / cloned voices) |

Both are **async** services: the tool submits the job, polls the task endpoint
until the status is terminal (`done`/`failed`), then downloads the signed audio
URL. `tts.py` handles the polling, back-off (429 / 5xx), the structured failure
envelope, and the download. They differ in the request encoding, captured in the
`PROVIDERS` registry so the CLI stays the same across both:

- **ai84** — `POST /v2/text-to-speech/async` with a **JSON** body (`model_id`,
  `voice_settings`, `output_format`), polls `/v2/text-to-speech/async/{id}`.
- **ai33** — `POST /v3/text-to-speech` with **multipart FormData** (`text`,
  `voice_id`, `speed`, `with_transcript`, …), returns a `task_id`, polls
  `/v3/task/{id}` and pulls the audio from `data.metadata.audio_url`. There is
  **no** `model_id`/credits/estimate concept in v3, and every `voice_id` must
  carry a provider prefix (`elevenlabs_`, `minimax_`, `clone_`, `edge_`,
  `kokoro_`, `vbee_`, `fishaudio_`). Browse ids with
  `--list-voices --voice-provider <p>`.

## Credentials — never committed
The key is read from the environment, never hard-coded or written into the repo:
```bash
export AI84_API_KEY=sk-...      # ai84.pro
export AI33_API_KEY=...         # ai33.pro
```
A gitignored `.env` you `source` is fine; the key must not land in `timeline.json`,
a script, or a commit.

## Usage
```bash
S=.claude/skills/magnate-cut/scripts/tts.py

# --- ai84 (default) ---------------------------------------------------------
# browse voices / models / balance first
python3 $S --list-voices --search narrator
python3 $S --list-models
python3 $S --credits

# synthesize the VO into a project's vo/ (the magnate-cut spine)
python3 $S --project videos/neom --out vo/narration.mp3 \
    --voice JBFqnCBsd6RMkjVDRZzb --model eleven_multilingual_v2 \
    --text "In 2015, one company promised to build the future."

# cost preview (no credits spent) / request preview (no call)
python3 $S --text "…" --estimate
python3 $S --text "…" --voice V --dry-run

# --- ai33 (v3 unified endpoint) ---------------------------------------------
# browse a provider's voice library (provider is required); pick a prefixed id
python3 $S --provider ai33 --list-voices --voice-provider minimax --search narrator
python3 $S --provider ai33 --list-voices --voice-provider elevenlabs

# synthesize the VO into vo/ (voice_id MUST carry a provider prefix)
python3 $S --provider ai33 --project videos/neom --out vo/narration.mp3 \
    --voice minimax_209533299589198 --speed 1 --text-file script.txt

# multi-speaker narration (dialogue): label lines A>/B>/C>, one speaker per index
python3 $S --provider ai33 --dialogue --project videos/neom --out vo/narration.mp3 \
    --speakers '[{"voice_id":"minimax_209533299589198","speed":1},
                 {"voice_id":"elevenlabs_hpp4J3VqNfWAUOO0d1Us"}]' --delay 0.4 \
    --text $'A> In 2015, one company promised the future.\nB> They delivered a debt.'

# request preview (no call) works for ai33 too
python3 $S --provider ai33 --voice minimax_209533299589198 --text "…" --dry-run
```

Common options: `--project --out --text/--text-file --voice --speed --timeout`
(default 600s bounds the poll). ai84-only: `--model --output-format --language
--stability --similarity --style --speaker-boost true --estimate --credits
--list-models`. ai33-only: `--voice-provider` (browse), `--transcript`,
`--file-name`, `--receive-url` (webhook the result instead of polling),
`--pron-dict <id>` (pronunciation dictionary), `--dialogue --speakers --delay`,
and `--poll-path` (override the task-status path if ai33 ever moves it).

## Then feed it to the pipeline
The written file IS the VO spine — point the timeline at it:
```bash
python3 $S --project videos/neom --out vo/narration.mp3 --text-file script.txt
python3 .claude/skills/magnate-cut/scripts/build_timeline.py videos/neom
# build_timeline.py finds vo/narration.mp3 and hangs the edit off it
```

## Notes
- The audio the picture engines render stays **picture-only** (Part 26,
  `audio.md`) — this VO, the music beds and the SFX are all laid in the
  `assemble.py` mix, never baked into a clip.
- MiniMax voice-clone + cloned-voice TTS and dubbing exist on ai84 too
  (`/v1/minimax/*`, `/v2/dubbing`); `tts.py` covers the ElevenLabs-voice TTS
  path — extend it if you need the clone/dub flows.
