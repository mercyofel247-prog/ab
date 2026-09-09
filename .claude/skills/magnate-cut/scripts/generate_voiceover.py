#!/usr/bin/env python3
"""
magnate-cut voice-over generator (AI84.pro text-to-speech).

Generates the narration spine when it is NOT already provided. The rest of the
pipeline (build_timeline.py -> assemble.py) treats the VO as given; this script
is the optional upstream step that MAKES it, dropping a narration audio file
into <project>/vo/ so build_timeline.py picks it up automatically.

It talks to the AI84.pro async TTS API (ElevenLabs voices):
  1. POST  /v2/text-to-speech/async        -> job_id (no audio yet)
  2. GET   /v2/text-to-speech/async/:id     -> poll until status is terminal
  3. download the signed audioUrl to <project>/vo/<name>

Generation SPENDS CREDITS. Confirm with the user before running for real
(the same "confirm before you spend" rule the repo applies to cloud renders).
Use --estimate first to preview the credit cost without enqueuing a job or
spending anything.

AUTH: set the API key in the environment (never hard-code it):
    export AI84_API_KEY=sk-...        # preferred
    # XI_API_KEY and ELEVENLABS_API_KEY are also accepted as fallbacks
It is sent as the `xi-api-key` header.

Usage:
    # preview cost only (no credits spent, no key strictly required):
    python3 generate_voiceover.py <project> --text-file script.txt --estimate

    # list candidate narrator voices (deep, authoritative male reads well here):
    python3 generate_voiceover.py --list-voices --gender male --search narrator

    # generate the narration into <project>/vo/narration.mp3:
    python3 generate_voiceover.py <project> \
        --text-file script.txt --voice-id JBFqnCBsd6RMkjVDRZzb \
        --model eleven_multilingual_v2

Notes:
  - --text-file (or --text) is the narration script. Keep it the finished VO
    copy from the M-HYBRID master prompt; this script does not write narration.
  - Output defaults to vo/narration.mp3. build_timeline.py auto-detects the
    first audio file in vo/, so no timeline edit is needed.
  - Status set is closed: queued/processing/done/failed. `done` = success,
    `failed` = failure (read errorMessageKey to branch); any other value is
    treated as non-terminal and polled again. A 5xx poll is NOT a failure -
    the job is still running; keep polling.
"""

import argparse
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_BASE = "https://api.ai84.pro"
DEFAULT_MODEL = "eleven_multilingual_v2"
# api.ai84.pro sits behind Cloudflare, which bans the default Python-urllib
# user-agent (Error 1010). Present an ordinary UA so requests are not blocked.
USER_AGENT = "magnate-cut/1.0 (+https://claude.ai/code)"
TERMINAL_OK = {"done"}
TERMINAL_FAIL = {"failed", "error"}


def _ssl_context(ca_bundle=None):
    """Honor an explicit CA bundle, else the env's (SSL_CERT_FILE /
    REQUESTS_CA_BUNDLE are picked up by create_default_context automatically),
    else the proxy CA if present, else system defaults. Never disables verify."""
    path = ca_bundle or os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE")
    if not path and os.path.isfile("/root/.ccr/ca-bundle.crt"):
        path = "/root/.ccr/ca-bundle.crt"
    if path and os.path.isfile(path):
        return ssl.create_default_context(cafile=path)
    return ssl.create_default_context()


def _api_key():
    for var in ("AI84_API_KEY", "XI_API_KEY", "ELEVENLABS_API_KEY"):
        v = os.environ.get(var)
        if v:
            return v.strip()
    return None


def _request(method, url, ctx, key=None, body=None, timeout=60):
    """Return (status_code, parsed_json_or_None, raw_bytes)."""
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    if key:
        headers["xi-api-key"] = key
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as r:
            raw = r.read()
            status = r.status
    except urllib.error.HTTPError as e:
        raw = e.read()
        status = e.code
    parsed = None
    if raw:
        try:
            parsed = json.loads(raw.decode())
        except (ValueError, UnicodeDecodeError):
            parsed = None
    return status, parsed, raw


def _die(msg, **extra):
    print(json.dumps({"ok": False, "error": msg, **extra}))
    sys.exit(1)


def list_voices(args, ctx, key):
    if not key:
        _die("no API key: set AI84_API_KEY (or XI_API_KEY)")
    q = {"page_size": str(args.page_size), "page": "0", "sort": "trending"}
    if args.gender:
        q["gender"] = args.gender
    if args.search:
        q["search"] = args.search
    if args.language:
        q["language"] = args.language
    url = f"{args.base_url}/v1/shared-voices?" + urllib.parse.urlencode(q)
    status, parsed, _ = _request("GET", url, ctx, key)
    if status != 200 or not isinstance(parsed, dict):
        _die("could not list voices", status=status, body=parsed)
    voices = [
        {
            "voice_id": v.get("voice_id"),
            "name": v.get("name"),
            "gender": v.get("gender"),
            "language": v.get("language"),
            "category": v.get("category"),
            "description": v.get("description"),
        }
        for v in parsed.get("voices", [])
    ]
    print(json.dumps({"ok": True, "count": len(voices), "voices": voices,
                      "has_more": parsed.get("has_more")}, indent=2))


def read_text(args):
    if args.text_file:
        with open(args.text_file, encoding="utf-8") as f:
            return f.read().strip()
    if args.text:
        return args.text.strip()
    _die("no narration: pass --text-file <script.txt> or --text \"...\"")


def estimate(args, ctx, key, text):
    """Preview credit cost without enqueuing (no credits spent)."""
    body = {
        "serviceType": "tts",
        "provider": "elevenlabs",
        "baseAmount": len(text),
        "options": {"model_id": args.model, "with_transcript": args.transcript},
    }
    url = f"{args.base_url}/v1/estimate-credit-cost"
    status, parsed, _ = _request("POST", url, ctx, key=None, body=body)
    if status != 200 or not isinstance(parsed, dict):
        _die("estimate failed", status=status, body=parsed)
    # cost is top-level on some deployments, nested under data on others.
    cost = parsed.get("cost")
    if cost is None and isinstance(parsed.get("data"), dict):
        cost = parsed["data"].get("cost")
    print(json.dumps({
        "ok": True, "mode": "estimate", "chars": len(text),
        "model": args.model, "estimated_credit_cost": cost,
        "note": "No credits spent. Drop --estimate to generate for real.",
    }, indent=2))


def download(url, dest, ctx, timeout=300):
    req = urllib.request.Request(url, headers={"Accept": "*/*", "User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, context=ctx, timeout=timeout) as r, open(dest, "wb") as out:
        while True:
            chunk = r.read(65536)
            if not chunk:
                break
            out.write(chunk)


def generate(args, ctx, key, text):
    if not key:
        _die("no API key: set AI84_API_KEY (or XI_API_KEY) before generating")

    body = {"text": text, "model_id": args.model}
    if args.voice_id:
        body["voice_id"] = args.voice_id
    if args.language:
        body["language_code"] = args.language
    if args.transcript:
        body["with_transcript"] = True

    create_url = f"{args.base_url}/v2/text-to-speech/async"
    if args.voice_id:
        create_url += "?" + urllib.parse.urlencode({"voice_id": args.voice_id})

    # POST the job. 60/min limit on this credit-consuming call: on 429 back off.
    status, parsed, raw = _request("POST", create_url, ctx, key, body=body)
    if status == 429:
        _die("rate limited creating job (429); wait and retry",
             status=status, body=parsed)
    if status not in (200, 201) or not isinstance(parsed, dict) or not parsed.get("job_id"):
        _die("job creation failed", status=status, body=parsed)
    job_id = parsed["job_id"]
    quoted_cost = parsed.get("credit_cost")
    sys.stderr.write(f"[magnate-cut] TTS job {job_id} queued "
                     f"(quoted {quoted_cost} credits); polling...\n")

    # Poll until terminal. Polling is not rate-limited; 5xx polls != failure.
    poll_url = f"{args.base_url}/v2/text-to-speech/async/{urllib.parse.quote(job_id)}"
    deadline = time.time() + args.timeout
    job = {}
    while time.time() < deadline:
        time.sleep(args.poll_interval)
        pstatus, pparsed, _ = _request("GET", poll_url, ctx, key)
        if pstatus >= 500 or not isinstance(pparsed, dict):
            continue  # transient; the job is still running
        job = pparsed.get("job") or {}
        st = job.get("status")
        if st in TERMINAL_OK:
            break
        if st in TERMINAL_FAIL:
            _die("generation failed",
                 status_field=st,
                 error_message=job.get("errorMessage"),
                 error_category=job.get("errorCategory"),
                 error_message_key=job.get("errorMessageKey"),
                 error_context=job.get("errorContext"),
                 credit_cost=job.get("credit_cost"))
        sys.stderr.write(f"[magnate-cut]   status={st}...\n")
    else:
        _die("timed out waiting for TTS job", job_id=job_id,
             last_status=job.get("status"), timeout_s=args.timeout)

    audio_url = job.get("audioUrl")
    if not audio_url:
        _die("job done but no audioUrl", job_id=job_id, body=job)

    vo_dir = os.path.join(args.project_abs, "vo")
    os.makedirs(vo_dir, exist_ok=True)
    dest = os.path.join(vo_dir, args.out)
    download(audio_url, dest, ctx)

    transcript_dest = None
    if args.transcript and job.get("transcriptUrl"):
        transcript_dest = os.path.join(vo_dir, os.path.splitext(args.out)[0] + ".srt")
        try:
            download(job["transcriptUrl"], transcript_dest, ctx)
        except (urllib.error.URLError, OSError):
            transcript_dest = None

    print(json.dumps({
        "ok": True, "mode": "generate", "job_id": job_id,
        "vo_file": os.path.relpath(dest, args.project_abs),
        "vo_path": dest,
        "transcript": (os.path.relpath(transcript_dest, args.project_abs)
                       if transcript_dest else None),
        "model": job.get("modelId") or args.model,
        "voice_id": job.get("voiceId") or args.voice_id,
        "credit_cost": job.get("credit_cost"),
        "note": "VO is in vo/. Run build_timeline.py next; it auto-detects it.",
    }, indent=2))


def main():
    ap = argparse.ArgumentParser(description="magnate-cut voice-over generator (AI84.pro TTS)")
    ap.add_argument("project", nargs="?", help="project dir; VO lands in <project>/vo/")
    ap.add_argument("--text", default=None, help="narration text inline")
    ap.add_argument("--text-file", default=None, help="path to narration script (UTF-8)")
    ap.add_argument("--voice-id", default=None, help="AI84/ElevenLabs voice_id (see --list-voices)")
    ap.add_argument("--model", default=DEFAULT_MODEL,
                    help=f"model_id (default {DEFAULT_MODEL}; eleven_v3 needs a paid plan)")
    ap.add_argument("--language", default=None, help="language_code, e.g. en / vi")
    ap.add_argument("--transcript", action="store_true", help="also fetch the SRT transcript")
    ap.add_argument("--out", default="narration.mp3", help="output filename inside vo/")
    ap.add_argument("--estimate", action="store_true",
                    help="preview credit cost only; spend nothing, enqueue nothing")
    ap.add_argument("--list-voices", action="store_true", help="list shared voices and exit")
    ap.add_argument("--gender", default=None, help="--list-voices filter: male/female/neutral")
    ap.add_argument("--search", default=None, help="--list-voices search term")
    ap.add_argument("--page-size", type=int, default=30, help="--list-voices page size (<=100)")
    ap.add_argument("--base-url", default=os.environ.get("AI84_BASE_URL", DEFAULT_BASE))
    ap.add_argument("--ca-bundle", default=None, help="explicit CA bundle path for TLS")
    ap.add_argument("--poll-interval", type=float, default=3.0, help="seconds between polls (2-5)")
    ap.add_argument("--timeout", type=float, default=1800.0, help="overall poll deadline (seconds)")
    args = ap.parse_args()

    ctx = _ssl_context(args.ca_bundle)
    key = _api_key()

    if args.list_voices:
        list_voices(args, ctx, key)
        return

    if not args.project:
        _die("missing project dir (needed to place vo/). "
             "Use --list-voices without a project to browse voices.")
    args.project_abs = os.path.abspath(args.project)

    text = read_text(args)
    if not text:
        _die("narration text is empty")

    if args.estimate:
        estimate(args, ctx, key, text)
        return

    generate(args, ctx, key, text)


if __name__ == "__main__":
    main()
