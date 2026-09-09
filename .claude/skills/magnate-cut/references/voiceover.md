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
| `ai84` | `https://api.ai84.pro` | `AI84_API_KEY` | wired (ElevenLabs + MiniMax voices) |
| `ai33` | — | `AI33_API_KEY` | stubbed — add to `PROVIDERS` in `tts.py` once its API doc is supplied |

Both are ElevenLabs-style **async** services: the tool POSTs the job, polls the
job endpoint until the status is terminal (`done`/`failed`), then downloads the
signed audio URL. `tts.py` handles the polling, back-off (429 / 5xx), the
structured failure envelope, and the download.

## Credentials — never committed
The key is read from the environment, never hard-coded or written into the repo:
```bash
export AI84_API_KEY=sk-...      # ai84.pro
export AI33_API_KEY=...         # ai33.pro (once configured)
```
A gitignored `.env` you `source` is fine; the key must not land in `timeline.json`,
a script, or a commit.

## Usage
```bash
S=.claude/skills/magnate-cut/scripts/tts.py

# browse voices / models / balance first
python3 $S --list-voices --search narrator
python3 $S --list-models
python3 $S --credits

# synthesize the VO into a project's vo/ (the magnate-cut spine)
python3 $S --project videos/neom --out vo/narration.mp3 \
    --voice JBFqnCBsd6RMkjVDRZzb --model eleven_multilingual_v2 \
    --text "In 2015, one company promised to build the future."

# or from a script file
python3 $S --project videos/neom --text-file script.txt

# cost preview (no credits spent) / request preview (no call)
python3 $S --text "…" --estimate
python3 $S --text "…" --voice V --dry-run
```

Options: `--language en`, and voice settings `--stability --similarity --style
--speed --speaker-boost true`. `--timeout` (default 600s) bounds the poll.

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
