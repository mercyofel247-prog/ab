#!/usr/bin/env python3
"""Text-to-speech CLI for the magnate-cut pipeline — create a voiceover file.

Providers are pluggable. Two are wired:
  - ai84.pro  — ElevenLabs-style JSON async job (POST /v2 -> poll -> download).
  - ai33.pro  — v3 unified endpoint (multipart FormData -> task_id -> poll GET
                Task -> download). voice_id must carry a provider prefix
                (elevenlabs_/minimax_/clone_/edge_/kokoro_/vbee_/fishaudio_).

The API key is ALWAYS read from the environment, never hard-coded or committed:
  --provider ai84  ->  AI84_API_KEY
  --provider ai33  ->  AI33_API_KEY

Generation is asynchronous on both services: this tool submits the job, polls
the matching task endpoint until the status is terminal, then downloads the
signed audio URL to --out. Outbound HTTPS goes through the session's agent proxy
automatically (requests honours HTTPS_PROXY + REQUESTS_CA_BUNDLE from the env).

Typical use (feeds magnate-cut's vo/ spine):
  # ai84 (ElevenLabs voice)
  python3 tts.py --text "In 2015, one company promised the future."      \
      --project videos/neom --out vo/narration.mp3 --voice JBFqnCBsd6RMkjVDRZzb

  # ai33 (prefixed voice id — browse the library first with --list-voices)
  python3 tts.py --provider ai33 --project videos/neom --out vo/narration.mp3 \
      --voice minimax_male-qn-qingse --text-file script.txt

  python3 tts.py --provider ai33 --list-voices --voice-provider minimax
  python3 tts.py --list-voices --search narrator      # browse voices, then pick
  python3 tts.py --list-models                        # ai84 only
  python3 tts.py --credits                             # ai84 only
  python3 tts.py --text "hi" --estimate               # cost only (ai84)
  python3 tts.py --text "hi" --dry-run                # print the request, no call
"""
import argparse
import json
import os
import sys
import time

try:
    import requests
except ImportError:
    sys.exit("[tts] the 'requests' library is required: pip install requests")


# ---------------------------------------------------------------------------
# Provider registry. Both providers are async TTS services: submit a job ->
# poll a task endpoint -> download a signed audio URL. They differ in the
# request encoding (`body_format`) and in a few endpoint shapes, captured here
# so the code below stays provider-agnostic.
# ---------------------------------------------------------------------------
PROVIDERS = {
    "ai84": {
        "base": "https://api.ai84.pro",
        "key_env": "AI84_API_KEY",
        "auth_header": "xi-api-key",
        "body_format": "json",                          # JSON create body
        "create_path": "/v2/text-to-speech/async",
        "dialogue_path": None,
        "poll_path": "/v2/text-to-speech/async/{job_id}",
        "voices_path": "/v1/shared-voices",
        "voices_style": "v1",
        "models_path": "/v1/models",
        "credits_path": "/v1/credits",
        "estimate_path": "/v1/estimate-credit-cost",
        "default_model": "eleven_multilingual_v2",
        "default_output_format": "mp3_44100_128",
        "voice_prefix": False,
    },
    "ai33": {
        "base": "https://api.ai33.pro",
        "key_env": "AI33_API_KEY",
        "auth_header": "xi-api-key",
        "body_format": "form",                          # multipart FormData create body
        "create_path": "/v3/text-to-speech",
        "dialogue_path": "/v3/text-to-speech/dialogue",
        # "Common / GET Task" — the async task-status endpoint. Returns
        # {success, data:{status, credit_cost, metadata:{audio_url}, ...}}.
        # Overridable with --poll-path; or skip polling entirely by passing
        # --receive-url so ai33 webhooks the result to you instead.
        "poll_path": "/v3/task/{job_id}",
        "voices_path": "/v3/voices",
        "voices_style": "v3",
        "models_path": None,                            # v3 has no model list
        "credits_path": None,                           # (no model_id / credits
        "estimate_path": None,                          #  endpoints in v3)
        "default_model": None,
        "default_output_format": None,
        "voice_prefix": True,                           # voice_id needs a provider prefix
        "default_voice_provider": "minimax",
    },
}

# ai33 voice ids must carry one of these provider prefixes (v3 doc).
AI33_VOICE_PREFIXES = ("elevenlabs_", "minimax_", "clone_", "edge_",
                       "kokoro_", "vbee_", "fishaudio_")
AI33_VOICE_PROVIDERS = ("elevenlabs", "minimax", "clone", "edge",
                        "kokoro", "vbee", "fishaudio")

# task endpoints: success -> download; failure -> stop; anything else = keep polling.
TERMINAL_OK = {"done", "success", "succeeded", "completed", "complete", "finished"}
TERMINAL_FAIL = {"failed", "failure", "error", "canceled", "cancelled"}

# keys various task responses use for the finished audio URL.
AUDIO_KEYS = ("audioUrl", "audio_url", "url", "output_url", "outputUrl",
              "audio", "output", "result", "file_url", "fileUrl",
              "download_url", "downloadUrl")


def die(msg, code=1):
    sys.stderr.write(f"[tts] {msg}\n")
    sys.exit(code)


def provider_cfg(name):
    cfg = PROVIDERS.get(name)
    if not cfg:
        die(f"provider '{name}' is not configured. Configured: {', '.join(PROVIDERS)}.")
    if cfg.get("base") is None:
        die(f"provider '{name}' has no base URL configured.")
    return cfg


def api_key(cfg, required=True):
    key = os.environ.get(cfg["key_env"], "").strip()
    if not key and required:
        die(f"missing API key: set the {cfg['key_env']} environment variable "
            f"(export {cfg['key_env']}=...). It is read from the env and never "
            f"stored in the repo.")
    return key


def request(method, url, key_header, key, json_body=None, form_fields=None, timeout=60):
    """One HTTP call. Returns (status_code, parsed_json_or_None, raw_text).

    Pass json_body for a JSON body, or form_fields (a dict) for a multipart
    FormData body (matching curl -F). Never raises on HTTP status; the caller
    branches on status_code."""
    hdrs = {key_header: key, "Accept": "application/json"}
    kwargs = {"headers": hdrs, "timeout": timeout}
    if json_body is not None:
        kwargs["json"] = json_body
    elif form_fields is not None:
        # (None, value) tuples force multipart/form-data with no filename,
        # i.e. plain form fields — the shape ai33's -F examples send.
        kwargs["files"] = {k: (None, str(v)) for k, v in form_fields.items()}
    try:
        r = requests.request(method, url, **kwargs)
    except requests.RequestException as e:
        return None, None, f"network error: {e}"
    body = None
    try:
        body = r.json()
    except ValueError:
        pass
    return r.status_code, body, r.text


def _validate_ai33_voice(voice):
    if voice and not voice.startswith(AI33_VOICE_PREFIXES):
        die(f"ai33 voice_id '{voice}' is missing a provider prefix. Use one of: "
            f"{', '.join(AI33_VOICE_PREFIXES)} (e.g. minimax_male-qn-qingse). "
            f"Browse ids with: --provider ai33 --list-voices --voice-provider <p>.")


def _post_with_retry(url, cfg, key, json_body=None, form_fields=None, label="create"):
    """POST a credit-consuming job with back-off on 429 / 5xx. Returns parsed data."""
    code = data = raw = None
    for attempt in range(4):
        code, data, raw = request("POST", url, cfg["auth_header"], key,
                                   json_body=json_body, form_fields=form_fields, timeout=60)
        if code == 429:
            wait = 2 ** attempt
            sys.stderr.write(f"[tts] rate-limited (429); backing off {wait}s\n")
            time.sleep(wait); continue
        if code is not None and 500 <= code < 600:
            wait = 2 ** attempt
            sys.stderr.write(f"[tts] server {code} on {label}; retrying in {wait}s\n")
            time.sleep(wait); continue
        break
    if code is None:
        die(f"{label} failed: {raw}")
    if code not in (200, 201):
        msg = (data or {}).get("message") or (data or {}).get("error") or raw
        die(f"{label} failed (HTTP {code}): {msg}")
    if isinstance(data, dict) and data.get("success") is False:
        die(f"{label} failed: {data.get('message') or data.get('error') or raw}")
    return data or {}


def _job_id_from(data):
    nested = data.get("data") if isinstance(data.get("data"), dict) else {}
    return (data.get("job_id") or data.get("task_id")
            or nested.get("task_id") or nested.get("job_id"))


def create_job(cfg, key, args):
    """Submit a single-voice TTS job. Returns the job/task id to poll."""
    url = cfg["base"] + cfg["create_path"]

    if cfg["body_format"] == "form":
        # ai33 v3 /v3/text-to-speech — multipart FormData.
        if args.voice:
            _validate_ai33_voice(args.voice)
        fields = {"text": args.text}
        if args.voice:
            fields["voice_id"] = args.voice
        if args.speed is not None:
            fields["speed"] = args.speed
        fields["with_transcript"] = "true" if args.transcript else "false"
        if args.file_name:
            fields["file_name"] = args.file_name
        if args.receive_url:
            fields["receive_url"] = args.receive_url
        if args.pron_dict is not None:
            fields["pronunciation_dictionary_id"] = args.pron_dict
        if not args.voice:
            die("ai33 needs a --voice (a prefixed voice_id). Browse with "
                "--list-voices --voice-provider <provider>.")
        if args.dry_run:
            print(json.dumps({"would_POST": url, "multipart_form": True,
                              "headers": {cfg["auth_header"]: "<" + cfg["key_env"] + ">"},
                              "fields": fields}, indent=2))
            sys.exit(0)
        data = _post_with_retry(url, cfg, key, form_fields=fields)
    else:
        # ai84 v2 — JSON body.
        body = {
            "text": args.text,
            "model_id": args.model or cfg["default_model"],
            "output_format": args.output_format or cfg["default_output_format"],
        }
        if args.voice:
            body["voice_id"] = args.voice
        if args.language:
            body["language_code"] = args.language
        vs = {}
        if args.stability is not None:      vs["stability"] = args.stability
        if args.similarity is not None:     vs["similarity_boost"] = args.similarity
        if args.style is not None:          vs["style"] = args.style
        if args.speed is not None:          vs["speed"] = args.speed
        if args.speaker_boost is not None:  vs["use_speaker_boost"] = args.speaker_boost
        if vs:
            body["voice_settings"] = vs
        if args.dry_run:
            print(json.dumps({"would_POST": url,
                              "headers": {cfg["auth_header"]: "<" + cfg["key_env"] + ">"},
                              "body": body}, indent=2))
            sys.exit(0)
        data = _post_with_retry(url, cfg, key, json_body=body)

    job_id = _job_id_from(data)
    if not job_id:
        die(f"create returned no job/task id: {json.dumps(data)[:400]}")
    cost = data.get("credit_cost")
    sys.stderr.write(f"[tts] job {job_id} queued"
                     + (f" (est. {cost} credits)" if cost is not None else "") + "\n")
    return job_id


def create_dialogue(cfg, key, args):
    """Submit a multi-speaker dialogue job (ai33 v3). Returns the task id."""
    if not cfg.get("dialogue_path"):
        die(f"provider '{args.provider}' has no dialogue endpoint.")
    try:
        speakers = json.loads(args.speakers)
    except (TypeError, ValueError) as e:
        die(f"--speakers must be a JSON array of {{voice_id, speed?}}: {e}")
    if not isinstance(speakers, list) or len(speakers) < 2:
        die("--speakers needs at least 2 speakers (JSON array, mapped to A>/B>/C> by index).")
    for sp in speakers:
        _validate_ai33_voice(sp.get("voice_id", "") if isinstance(sp, dict) else "")
    fields = {
        "text": args.text,
        "speakers": json.dumps(speakers),
        "delay": args.delay if args.delay is not None else 0,
        "with_transcript": "true" if args.transcript else "false",
    }
    if args.file_name:
        fields["file_name"] = args.file_name
    if args.receive_url:
        fields["receive_url"] = args.receive_url
    if args.pron_dict is not None:
        fields["pronunciation_dictionary_id"] = args.pron_dict
    url = cfg["base"] + cfg["dialogue_path"]
    if args.dry_run:
        print(json.dumps({"would_POST": url, "multipart_form": True,
                          "headers": {cfg["auth_header"]: "<" + cfg["key_env"] + ">"},
                          "fields": fields}, indent=2))
        sys.exit(0)
    data = _post_with_retry(url, cfg, key, form_fields=fields, label="dialogue")
    job_id = _job_id_from(data)
    if not job_id:
        die(f"dialogue create returned no task id: {json.dumps(data)[:400]}")
    sys.stderr.write(f"[tts] dialogue task {job_id} queued\n")
    return job_id


def _find_audio(job):
    for k in AUDIO_KEYS:
        v = job.get(k)
        if isinstance(v, str) and v.startswith("http"):
            return v
    meta = job.get("metadata") or {}
    for k in AUDIO_KEYS:
        v = meta.get(k)
        if isinstance(v, str) and v.startswith("http"):
            return v
    return None


def poll_job(cfg, key, job_id, deadline_s, poll_path=None):
    path = poll_path or cfg["poll_path"]
    url = cfg["base"] + path.format(job_id=job_id)
    start = time.time()
    interval = 3.0
    while True:
        if time.time() - start > deadline_s:
            die(f"timed out after {deadline_s}s waiting for job {job_id}")
        code, data, raw = request("GET", url, cfg["auth_header"], key, timeout=30)
        # 5xx while polling does NOT mean failure — the job is still running.
        if code is not None and 500 <= code < 600:
            time.sleep(interval); continue
        if code == 429:
            time.sleep(5); continue
        if code == 404:
            die(f"job {job_id} not found (or not yours) at {path}. If ai33 uses a "
                f"different task endpoint, pass --poll-path '/its/path/{{job_id}}'.\n{raw}")
        if code != 200 or not data:
            time.sleep(interval); continue
        job = data.get("job") or data.get("data") or data
        if not isinstance(job, dict):
            job = data
        status = str(job.get("status") or job.get("state") or "").lower()
        if status in TERMINAL_OK or (not status and _find_audio(job)):
            audio = _find_audio(job)
            if not audio:
                die(f"job {job_id} done but no audio URL in response: {raw}")
            return audio, job
        if status in TERMINAL_FAIL or job.get("success") is False:
            # structured failure envelope — branch on the stable key, show the message.
            emsg = job.get("errorMessage") or job.get("error_message") or \
                job.get("message") or job.get("error") or "generation failed"
            ekey = job.get("errorMessageKey") or job.get("error_message_key") or "?"
            ecat = job.get("errorCategory") or job.get("error_category")
            hint = " (fix your input; retrying unchanged will fail again)" if ecat == 1 else \
                   " (transient — safe to retry later)" if ecat == 2 else ""
            die(f"job {job_id} failed [{ekey}]{hint}: {emsg}")
        # queued / processing / waiting_retry / unknown -> keep polling.
        sys.stderr.write(f"[tts]   status={status or '?'} …\n")
        time.sleep(interval)


def download(url, out_path):
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    try:
        with requests.get(url, stream=True, timeout=120) as r:
            if r.status_code != 200:
                die(f"download failed (HTTP {r.status_code}) from signed URL")
            with open(out_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=65536):
                    if chunk:
                        f.write(chunk)
    except requests.RequestException as e:
        die(f"download failed: {e}")
    size = os.path.getsize(out_path)
    if size == 0:
        die("download produced a 0-byte file")
    return size


def do_list_voices(cfg, key, args):
    if cfg.get("voices_style") == "v3":
        provider = args.voice_provider or cfg.get("default_voice_provider")
        if provider not in AI33_VOICE_PROVIDERS:
            die(f"--voice-provider must be one of: {', '.join(AI33_VOICE_PROVIDERS)}.")
        params = [("provider", provider), ("page", "1"), ("page_size", "30")]
        if args.search:
            params.append(("search", args.search))
        q = "&".join(f"{k}={requests.utils.quote(str(v))}" for k, v in params)
        code, data, raw = request("GET", cfg["base"] + cfg["voices_path"] + "?" + q,
                                  cfg["auth_header"], key, timeout=30)
        if code != 200 or not data:
            die(f"list voices failed (HTTP {code}): {raw}")
        for v in data.get("data", []):
            print(f"{v.get('voice_id'):40}  {str(v.get('name','?')):24}  "
                  f"{str(v.get('gender','?')):8} {str(v.get('language','?')):8} "
                  f"{','.join(v.get('tags', []) or [])}")
        pg = data.get("pagination") or {}
        if pg.get("has_more"):
            sys.stderr.write(f"[tts] more voices available (total {pg.get('total','?')}); "
                             f"narrow with --search or page in the API.\n")
        return
    # v1 (ai84)
    params = []
    if args.search:
        params.append(("search", args.search))
    params += [("page_size", "30"), ("page", "0")]
    q = "&".join(f"{k}={requests.utils.quote(str(v))}" for k, v in params)
    code, data, raw = request("GET", cfg["base"] + cfg["voices_path"] + "?" + q,
                              cfg["auth_header"], key, timeout=30)
    if code != 200 or not data:
        die(f"list voices failed (HTTP {code}): {raw}")
    for v in data.get("voices", []):
        print(f"{v.get('voice_id'):32}  {v.get('name','?'):24}  "
              f"{v.get('gender','?'):8} {v.get('language','?'):5} {v.get('category','')}")


def do_list_models(cfg, key, provider):
    if not cfg.get("models_path"):
        die(f"provider '{provider}' has no model list (v3 has no model_id concept).")
    code, data, raw = request("GET", cfg["base"] + cfg["models_path"] + "?tts_only=true",
                              cfg["auth_header"], key, timeout=30)
    if code != 200 or not data:
        die(f"list models failed (HTTP {code}): {raw}")
    for m in data.get("data", []):
        print(f"{m.get('model_id'):28}  {m.get('name','')}")


def do_credits(cfg, key, provider):
    if not cfg.get("credits_path"):
        die(f"provider '{provider}' has no credits endpoint.")
    code, data, raw = request("GET", cfg["base"] + cfg["credits_path"],
                              cfg["auth_header"], key, timeout=30)
    if code != 200 or not data:
        die(f"credits failed (HTTP {code}): {raw}")
    print(json.dumps({"credits": data.get("credits")}, indent=2))


def do_estimate(cfg, key, args):
    if not cfg.get("estimate_path"):
        die(f"provider '{args.provider}' has no estimate endpoint.")
    body = {"serviceType": "tts", "provider": "elevenlabs",
            "baseAmount": len(args.text or ""),
            "options": {"model_id": args.model or cfg["default_model"]}}
    code, data, raw = request("POST", cfg["base"] + cfg["estimate_path"],
                              cfg["auth_header"], key, json_body=body, timeout=30)
    if code != 200 or not data:
        die(f"estimate failed (HTTP {code}): {raw}")
    print(json.dumps({"estimated_credits": data.get("cost"),
                      "chars": len(args.text or "")}, indent=2))


def main():
    ap = argparse.ArgumentParser(description="Create a voiceover file via a TTS provider (ai84/ai33).")
    ap.add_argument("--provider", default="ai84", choices=list(PROVIDERS),
                    help="TTS provider (key read from its *_API_KEY env var). Default ai84.")
    ap.add_argument("--text", help="Text to synthesize (for --dialogue, use A>/B>/C> labels).")
    ap.add_argument("--text-file", help="Read the text to synthesize from this file (UTF-8).")
    ap.add_argument("--project", default=".", help="Project dir; --out is resolved under it.")
    ap.add_argument("--out", default="vo/narration.mp3",
                    help="Output audio path (relative to --project unless absolute).")
    ap.add_argument("--voice", help="voice_id (see --list-voices). ai33 ids need a provider "
                    "prefix, e.g. minimax_male-qn-qingse.")
    ap.add_argument("--model", help="model_id (ai84 only; see --list-models).")
    ap.add_argument("--output-format", dest="output_format", help="ai84: e.g. mp3_44100_128.")
    ap.add_argument("--language", help="ai84: language_code, e.g. en.")
    ap.add_argument("--stability", type=float, help="ai84 voice setting.")
    ap.add_argument("--similarity", type=float, help="ai84 voice setting.")
    ap.add_argument("--style", type=float, help="ai84 voice setting.")
    ap.add_argument("--speed", type=float, help="Playback speed. ai33 range 0.5–1.5 (default 1).")
    ap.add_argument("--speaker-boost", dest="speaker_boost", type=lambda s: s.lower() == "true",
                    help="ai84: true/false")
    # ai33-specific
    ap.add_argument("--voice-provider", dest="voice_provider", choices=AI33_VOICE_PROVIDERS,
                    help="ai33 --list-voices: which voice library to browse (required for ai33).")
    ap.add_argument("--transcript", action="store_true",
                    help="ai33: request a word transcript alongside the audio.")
    ap.add_argument("--file-name", dest="file_name", help="ai33: output file name hint.")
    ap.add_argument("--receive-url", dest="receive_url",
                    help="ai33: webhook URL to POST the result to (skip polling).")
    ap.add_argument("--pron-dict", dest="pron_dict", type=int,
                    help="ai33: pronunciation_dictionary_id to apply (audio only).")
    ap.add_argument("--dialogue", action="store_true",
                    help="ai33: multi-speaker dialogue mode (needs --speakers + A>/B> labels).")
    ap.add_argument("--speakers", help="ai33 dialogue: JSON array of {voice_id, speed?} (min 2).")
    ap.add_argument("--delay", type=float, help="ai33 dialogue: gap between speakers, 0–5s.")
    ap.add_argument("--search", help="Filter --list-voices by name/id/language/tag.")
    ap.add_argument("--poll-path", dest="poll_path",
                    help="Override the task-status path (must contain {job_id}).")
    ap.add_argument("--timeout", type=float, default=600, help="Poll deadline in seconds (default 600).")
    ap.add_argument("--list-voices", action="store_true")
    ap.add_argument("--list-models", action="store_true")
    ap.add_argument("--credits", action="store_true")
    ap.add_argument("--estimate", action="store_true", help="Print credit estimate only (ai84).")
    ap.add_argument("--dry-run", action="store_true", help="Print the request that would be sent; do not call.")
    args = ap.parse_args()

    cfg = provider_cfg(args.provider)

    # read-only browsing / metadata calls
    if args.list_voices:
        do_list_voices(cfg, api_key(cfg), args); return
    if args.list_models:
        do_list_models(cfg, api_key(cfg), args.provider); return
    if args.credits:
        do_credits(cfg, api_key(cfg), args.provider); return

    # resolve text
    if args.text_file:
        with open(args.text_file, encoding="utf-8") as f:
            args.text = f.read().strip()
    if not args.text:
        die("provide --text or --text-file (or use --list-voices / --list-models / --credits).")

    if args.estimate:
        do_estimate(cfg, api_key(cfg, required=not args.dry_run), args); return

    key = "" if args.dry_run else api_key(cfg)
    if args.dialogue:
        job_id = create_dialogue(cfg, key, args)     # exits early on --dry-run
    else:
        job_id = create_job(cfg, key, args)          # exits early on --dry-run

    # If ai33 was told to webhook the result, there is nothing to poll for here.
    if args.receive_url:
        print(json.dumps({
            "ok": True, "provider": args.provider, "job_id": job_id,
            "delivery": "webhook", "receive_url": args.receive_url,
            "note": "Job queued; ai33 will POST the audio to your receive_url. No file written.",
        }))
        return

    audio_url, job = poll_job(cfg, key, job_id, args.timeout, poll_path=args.poll_path)

    out = args.out if os.path.isabs(args.out) else os.path.join(args.project, args.out)
    size = download(audio_url, out)
    print(json.dumps({
        "ok": True,
        "provider": args.provider,
        "job_id": job_id,
        "out": out,
        "bytes": size,
        "voice_id": job.get("voiceId") or job.get("voice_id") or args.voice,
        "model_id": job.get("modelId") or job.get("model_id") or (args.model or cfg["default_model"]),
        "credit_cost": job.get("credit_cost") or job.get("creditCost"),
        "note": "Voiceover written. Drop it in the project's vo/ as the magnate-cut spine.",
    }))


if __name__ == "__main__":
    main()
