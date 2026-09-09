#!/usr/bin/env python3
"""Text-to-speech CLI for the magnate-cut pipeline — create a voiceover file.

Providers are pluggable. AI84.pro is fully wired; AI33.pro is stubbed until its
API doc is supplied (add its PROVIDERS entry then).

The API key is ALWAYS read from the environment, never hard-coded or committed:
  --provider ai84  ->  AI84_API_KEY
  --provider ai33  ->  AI33_API_KEY

Generation is asynchronous on these services: this tool POSTs the job, polls the
matching GET endpoint until the status is terminal, then downloads the signed
audio URL to --out. Outbound HTTPS goes through the session's agent proxy
automatically (requests honours HTTPS_PROXY + REQUESTS_CA_BUNDLE from the env).

Typical use (feeds magnate-cut's vo/ spine):
  python3 tts.py --text "In 2015, one company promised the future."      \
      --project videos/neom --out vo/narration.mp3 --voice JBFqnCBsd6RMkjVDRZzb
  python3 tts.py --text-file script.txt --project videos/neom
  python3 tts.py --list-voices --search narrator      # browse voices, then pick
  python3 tts.py --list-models
  python3 tts.py --credits
  python3 tts.py --text "hi" --estimate               # cost only, no generation
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
# Provider registry. Each provider is an ElevenLabs-style async TTS service:
# POST a job -> poll a job endpoint -> download a signed audio URL.
# ai33 is intentionally left unconfigured until its API doc is supplied; adding
# it is a matter of filling the same fields (base, header, paths, response keys).
# ---------------------------------------------------------------------------
PROVIDERS = {
    "ai84": {
        "base": "https://api.ai84.pro",
        "key_env": "AI84_API_KEY",
        "auth_header": "xi-api-key",
        "create_path": "/v2/text-to-speech/async",
        "poll_path": "/v2/text-to-speech/async/{job_id}",
        "voices_path": "/v1/shared-voices",
        "models_path": "/v1/models",
        "credits_path": "/v1/credits",
        "estimate_path": "/v1/estimate-credit-cost",
        "default_model": "eleven_multilingual_v2",
        "default_output_format": "mp3_44100_128",
    },
    # "ai33": { ... }  # TODO: fill from the ai33.pro API doc, then it just works.
}

# job endpoints: done=success, failed=failure; anything else = keep polling.
TERMINAL_OK = {"done"}
TERMINAL_FAIL = {"failed", "error"}


def die(msg, code=1):
    sys.stderr.write(f"[tts] {msg}\n")
    sys.exit(code)


def provider_cfg(name):
    cfg = PROVIDERS.get(name)
    if not cfg:
        die(f"provider '{name}' is not configured yet. Supply its API doc and add "
            f"it to PROVIDERS. Configured: {', '.join(PROVIDERS)}.")
    if cfg.get("base") is None:
        die(f"provider '{name}' has no base URL configured yet.")
    return cfg


def api_key(cfg, required=True):
    key = os.environ.get(cfg["key_env"], "").strip()
    if not key and required:
        die(f"missing API key: set the {cfg['key_env']} environment variable "
            f"(export {cfg['key_env']}=...). It is read from the env and never "
            f"stored in the repo.")
    return key


def headers(cfg, key, json_body=False):
    h = {cfg["auth_header"]: key, "Accept": "application/json"}
    if json_body:
        h["Content-Type"] = "application/json"
    return h


def request(method, url, key_header, key, json_body=None, timeout=60):
    """One HTTP call. Returns (status_code, parsed_json_or_None, raw_text).
    Never raises on HTTP status; the caller branches on status_code."""
    hdrs = {key_header: key, "Accept": "application/json"}
    if json_body is not None:
        hdrs["Content-Type"] = "application/json"
    try:
        r = requests.request(method, url, headers=hdrs, json=json_body, timeout=timeout)
    except requests.RequestException as e:
        return None, None, f"network error: {e}"
    body = None
    try:
        body = r.json()
    except ValueError:
        pass
    return r.status_code, body, r.text


def create_job(cfg, key, args):
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

    url = cfg["base"] + cfg["create_path"]
    if args.dry_run:
        print(json.dumps({"would_POST": url, "headers": {cfg["auth_header"]: "<" + cfg["key_env"] + ">"},
                          "body": body}, indent=2))
        sys.exit(0)

    # create is credit-consuming: retry a couple times on 5xx / 429 with backoff.
    for attempt in range(4):
        code, data, raw = request("POST", url, cfg["auth_header"], key, json_body=body, timeout=60)
        if code == 429:
            wait = 2 ** attempt
            sys.stderr.write(f"[tts] rate-limited (429); backing off {wait}s\n")
            time.sleep(wait)
            continue
        if code is not None and 500 <= code < 600:
            wait = 2 ** attempt
            sys.stderr.write(f"[tts] server {code} on create; retrying in {wait}s\n")
            time.sleep(wait)
            continue
        break
    if code is None:
        die(f"create failed: {raw}")
    if code not in (200, 201):
        msg = (data or {}).get("message") or raw
        die(f"create failed (HTTP {code}): {msg}")
    job_id = (data or {}).get("job_id") or (data or {}).get("task_id")
    if not job_id:
        die(f"create returned no job_id: {raw}")
    cost = (data or {}).get("credit_cost")
    sys.stderr.write(f"[tts] job {job_id} queued"
                     + (f" (est. {cost} credits)" if cost is not None else "") + "\n")
    return job_id


def poll_job(cfg, key, job_id, deadline_s):
    url = cfg["base"] + cfg["poll_path"].format(job_id=job_id)
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
            die(f"job {job_id} not found (or not yours): {raw}")
        if code != 200 or not data:
            time.sleep(interval); continue
        job = data.get("job") or data.get("data") or data
        status = (job.get("status") or "").lower()
        if status in TERMINAL_OK:
            audio = job.get("audioUrl") or job.get("audio_url") or \
                    (job.get("metadata") or {}).get("audio_url")
            if not audio:
                die(f"job {job_id} done but no audio URL in response: {raw}")
            return audio, job
        if status in TERMINAL_FAIL:
            # structured failure envelope — branch on the stable key, show the message.
            emsg = job.get("errorMessage") or job.get("error_message") or "generation failed"
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
    url = cfg["base"] + cfg["voices_path"]
    params = []
    if args.search:
        params.append(("search", args.search))
    params += [("page_size", "30"), ("page", "0")]
    q = "&".join(f"{k}={requests.utils.quote(str(v))}" for k, v in params)
    code, data, raw = request("GET", url + "?" + q, cfg["auth_header"], key, timeout=30)
    if code != 200 or not data:
        die(f"list voices failed (HTTP {code}): {raw}")
    for v in data.get("voices", []):
        print(f"{v.get('voice_id'):32}  {v.get('name','?'):24}  "
              f"{v.get('gender','?'):8} {v.get('language','?'):5} {v.get('category','')}")


def do_list_models(cfg, key):
    code, data, raw = request("GET", cfg["base"] + cfg["models_path"] + "?tts_only=true",
                              cfg["auth_header"], key, timeout=30)
    if code != 200 or not data:
        die(f"list models failed (HTTP {code}): {raw}")
    for m in data.get("data", []):
        print(f"{m.get('model_id'):28}  {m.get('name','')}")


def do_credits(cfg, key):
    code, data, raw = request("GET", cfg["base"] + cfg["credits_path"],
                              cfg["auth_header"], key, timeout=30)
    if code != 200 or not data:
        die(f"credits failed (HTTP {code}): {raw}")
    print(json.dumps({"credits": data.get("credits")}, indent=2))


def do_estimate(cfg, key, args):
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
    ap.add_argument("--provider", default="ai84", choices=list(PROVIDERS) or ["ai84"],
                    help="TTS provider (key read from its *_API_KEY env var). Default ai84.")
    ap.add_argument("--text", help="Text to synthesize.")
    ap.add_argument("--text-file", help="Read the text to synthesize from this file (UTF-8).")
    ap.add_argument("--project", default=".", help="Project dir; --out is resolved under it.")
    ap.add_argument("--out", default="vo/narration.mp3",
                    help="Output audio path (relative to --project unless absolute).")
    ap.add_argument("--voice", help="voice_id (see --list-voices). If omitted, the provider default is used.")
    ap.add_argument("--model", help="model_id (see --list-models). Default: provider's default.")
    ap.add_argument("--output-format", dest="output_format", help="e.g. mp3_44100_128 (default).")
    ap.add_argument("--language", help="language_code, e.g. en.")
    ap.add_argument("--stability", type=float)
    ap.add_argument("--similarity", type=float)
    ap.add_argument("--style", type=float)
    ap.add_argument("--speed", type=float)
    ap.add_argument("--speaker-boost", dest="speaker_boost", type=lambda s: s.lower() == "true",
                    help="true/false")
    ap.add_argument("--timeout", type=float, default=600, help="Poll deadline in seconds (default 600).")
    ap.add_argument("--list-voices", action="store_true")
    ap.add_argument("--list-models", action="store_true")
    ap.add_argument("--credits", action="store_true")
    ap.add_argument("--estimate", action="store_true", help="Print credit estimate only; do not generate.")
    ap.add_argument("--dry-run", action="store_true", help="Print the request that would be sent; do not call.")
    args = ap.parse_args()

    cfg = provider_cfg(args.provider)

    # read-only browsing / metadata calls
    if args.list_voices:
        do_list_voices(cfg, api_key(cfg), args); return
    if args.list_models:
        do_list_models(cfg, api_key(cfg)); return
    if args.credits:
        do_credits(cfg, api_key(cfg)); return

    # resolve text
    if args.text_file:
        with open(args.text_file, encoding="utf-8") as f:
            args.text = f.read().strip()
    if not args.text:
        die("provide --text or --text-file (or use --list-voices / --list-models / --credits).")

    if args.estimate:
        do_estimate(cfg, api_key(cfg, required=not args.dry_run), args); return

    key = "" if args.dry_run else api_key(cfg)
    job_id = create_job(cfg, key, args)          # exits early on --dry-run
    audio_url, job = poll_job(cfg, key, job_id, args.timeout)

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
