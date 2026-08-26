#!/usr/bin/env python3
"""
watchutube analysis engine.

Runs a battery of ffmpeg/ffprobe passes over a video (local file or URL) and
writes structured JSON + sample frames to an output directory. It does NOT
write the analysis report itself -- that's the job of whatever is driving
this script (Claude), which reads the JSON + looks at the extracted frames
+ reads the transcript and synthesizes the actual write-up. This script only
produces evidence.

Usage:
    python3 analyze_video.py <path-or-url> [--outdir DIR] [--skip-transcription]
                              [--whisper-model base] [--max-frames 36]
                              [--cut-threshold 0.28]

Prints a single line of JSON to stdout on completion:
    {"ok": true, "outdir": "...", "manifest": ".../manifest.json", "warnings": [...]}
"""

import argparse
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import time
import urllib.parse

WARNINGS = []


def warn(msg):
    WARNINGS.append(msg)
    print(f"[watchutube] WARNING: {msg}", file=sys.stderr)


def info(msg):
    print(f"[watchutube] {msg}", file=sys.stderr)


def run(cmd, timeout=None, check=False):
    """Run a command, return CompletedProcess with text stdout/stderr."""
    return subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        timeout=timeout, check=check,
    )


def which(name):
    return shutil.which(name) is not None


def ensure_pip_package(pip_name, import_name=None, timeout=180):
    """Best-effort lazy install. Returns True if the module is importable afterwards."""
    import importlib
    import_name = import_name or pip_name
    try:
        importlib.import_module(import_name)
        return True
    except ImportError:
        pass
    info(f"'{import_name}' not found, attempting `pip install {pip_name}`...")
    try:
        run([sys.executable, "-m", "pip", "install", "--quiet", pip_name], timeout=timeout, check=True)
    except Exception as e:
        warn(f"pip install {pip_name} failed: {e}")
        return False
    try:
        importlib.import_module(import_name)
        return True
    except ImportError:
        warn(f"{pip_name} installed but still not importable")
        return False


def ensure_yt_dlp(timeout=180):
    if which("yt-dlp"):
        return True
    info("yt-dlp not found, attempting `pip install yt-dlp`...")
    try:
        run([sys.executable, "-m", "pip", "install", "--quiet", "yt-dlp"], timeout=timeout, check=True)
    except Exception as e:
        warn(f"pip install yt-dlp failed: {e}")
        return False
    return which("yt-dlp")


def is_url(s):
    try:
        p = urllib.parse.urlparse(s)
        return p.scheme in ("http", "https")
    except Exception:
        return False


def resolve_input(source, workdir, max_height=1080, download_timeout=900):
    """Return a local filesystem path for `source`, downloading it if it's a URL."""
    if not is_url(source):
        path = os.path.abspath(os.path.expanduser(source))
        if not os.path.isfile(path):
            raise FileNotFoundError(f"No such file: {path}")
        return path

    if not ensure_yt_dlp():
        raise RuntimeError(
            "Input is a URL but yt-dlp is unavailable (not installed and pip install failed). "
            "Provide a local file instead, or install yt-dlp manually."
        )
    out_tmpl = os.path.join(workdir, "source.%(ext)s")
    fmt = f"bv*[height<={max_height}]+ba/b[height<={max_height}]/best"
    info(f"Downloading {source} via yt-dlp (<= {max_height}p)...")
    try:
        run(
            ["yt-dlp", "-f", fmt, "--merge-output-format", "mp4", "--no-playlist",
             "-o", out_tmpl, source],
            timeout=download_timeout, check=True,
        )
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"yt-dlp failed to download {source}: {e.stderr[-2000:] if e.stderr else e}")
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"yt-dlp download timed out after {download_timeout}s")

    candidates = [f for f in os.listdir(workdir) if f.startswith("source.")]
    if not candidates:
        raise RuntimeError("yt-dlp reported success but no output file was found")
    return os.path.join(workdir, sorted(candidates)[0])


def ffprobe_json(path):
    r = run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path],
        timeout=60, check=True,
    )
    return json.loads(r.stdout)


def get_metadata(path):
    data = ffprobe_json(path)
    fmt = data.get("format", {})
    vstream = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    astream = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)

    def parse_rate(r):
        if not r or "/" not in r:
            return None
        n, d = r.split("/")
        d = float(d)
        return round(float(n) / d, 3) if d else None

    duration = float(fmt.get("duration", vstream.get("duration", 0) if vstream else 0) or 0)
    return {
        "filename": os.path.basename(path),
        "duration_sec": round(duration, 3),
        "size_bytes": int(fmt.get("size", 0) or 0),
        "bit_rate": int(fmt.get("bit_rate", 0) or 0),
        "video": {
            "codec": vstream.get("codec_name") if vstream else None,
            "width": vstream.get("width") if vstream else None,
            "height": vstream.get("height") if vstream else None,
            "fps": parse_rate(vstream.get("avg_frame_rate")) if vstream else None,
            "nb_frames": int(vstream["nb_frames"]) if vstream and vstream.get("nb_frames", "").isdigit() else None,
            "pix_fmt": vstream.get("pix_fmt") if vstream else None,
        } if vstream else None,
        "audio": {
            "codec": astream.get("codec_name") if astream else None,
            "sample_rate": int(astream.get("sample_rate")) if astream and astream.get("sample_rate") else None,
            "channels": astream.get("channels") if astream else None,
        } if astream else None,
        "has_audio": astream is not None,
    }


SHOWINFO_RE = re.compile(r"pts_time:(?P<t>[\d.]+).*?mean:\[(?P<mean>[^\]]+)\]")


def detect_cuts(path, duration, threshold=0.28, timeout=600):
    """Hard/soft scene-change candidate timestamps via ffmpeg's `scene` select expression."""
    if duration > 0 and duration > 1800:
        warn("video is > 30min; scene-cut detection may take a while")
    r = run(
        ["ffmpeg", "-i", path, "-vf", f"select='gt(scene,{threshold})',showinfo",
         "-an", "-f", "null", "-"],
        timeout=timeout,
    )
    cuts = []
    for line in r.stderr.splitlines():
        if "pts_time:" not in line or "showinfo" not in line:
            continue
        m = SHOWINFO_RE.search(line)
        if m:
            t = float(m.group("t"))
            mean = [float(x) for x in m.group("mean").split()]
            cuts.append({"time": round(t, 3), "luma_mean": round(mean[0], 1) if mean else None})
    return cuts


def detect_silence(path, noise_db=-30, min_dur=0.3, timeout=600):
    if not path:
        return []
    r = run(
        ["ffmpeg", "-i", path, "-af", f"silencedetect=noise={noise_db}dB:d={min_dur}", "-f", "null", "-"],
        timeout=timeout,
    )
    segs = []
    start = None
    for line in r.stderr.splitlines():
        if "silence_start:" in line:
            start = float(line.split("silence_start:")[1].strip())
        elif "silence_end:" in line and start is not None:
            rest = line.split("silence_end:")[1].strip()
            end = float(rest.split("|")[0].strip())
            segs.append({"start": round(start, 3), "end": round(end, 3), "duration": round(end - start, 3)})
            start = None
    return segs


def detect_black(path, min_dur=0.15, timeout=600):
    r = run(
        ["ffmpeg", "-i", path, "-vf", f"blackdetect=d={min_dur}:pic_th=0.98", "-an", "-f", "null", "-"],
        timeout=timeout,
    )
    segs = []
    for line in r.stderr.splitlines():
        if "black_start:" in line:
            m = re.search(r"black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)", line)
            if m:
                segs.append({
                    "start": round(float(m.group(1)), 3),
                    "end": round(float(m.group(2)), 3),
                    "duration": round(float(m.group(3)), 3),
                })
    return segs


def detect_freeze(path, noise_db=-30, min_dur=0.5, timeout=600):
    r = run(
        ["ffmpeg", "-i", path, "-vf", f"freezedetect=n={noise_db}dB:d={min_dur}", "-an", "-f", "null", "-"],
        timeout=timeout,
    )
    segs = []
    start = None
    for line in r.stderr.splitlines():
        if "freeze_start:" in line:
            start = float(line.split("freeze_start:")[1].strip())
        elif "freeze_end:" in line and start is not None:
            end = float(line.split("freeze_end:")[1].strip())
            segs.append({"start": round(start, 3), "end": round(end, 3), "duration": round(end - start, 3)})
            start = None
    return segs


def loudness_curve(path, has_audio, window_sec=1.0, timeout=600):
    if not has_audio:
        return []
    n_samples = 44100  # ~1s windows assuming 44.1kHz; ffmpeg resamples internally as needed
    n = int(n_samples * window_sec)
    r = run(
        ["ffmpeg", "-i", path, "-af",
         f"asetnsamples=n={n}:p=0,astats=metadata=1:reset=1,"
         "ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
         "-f", "null", "-"],
        timeout=timeout,
    )
    points = []
    pending_t = None
    for line in r.stdout.splitlines():
        if line.startswith("frame:"):
            m = re.search(r"pts_time:([\d.]+)", line)
            if m:
                pending_t = float(m.group(1))
        elif "RMS_level=" in line and pending_t is not None:
            val = line.split("RMS_level=")[1].strip()
            db = None if val == "-inf" else float(val)
            points.append({"time": round(pending_t, 3), "rms_db": db})
            pending_t = None
    return points


def find_loudness_spikes(curve, jump_db=10.0, window=5):
    """Flag windows where RMS jumps sharply above the local rolling median -- candidate SFX/hits/stingers."""
    spikes = []
    vals = [(p["time"], p["rms_db"]) for p in curve if p["rms_db"] is not None]
    for i, (t, db) in enumerate(vals):
        lo = max(0, i - window)
        neighborhood = [v for _, v in vals[lo:i]] if i > 0 else []
        if len(neighborhood) < 2:
            continue
        local_med = statistics.median(neighborhood)
        if db - local_med >= jump_db:
            spikes.append({"time": round(t, 3), "rms_db": db, "jump_from_local_median_db": round(db - local_med, 1)})
    return spikes


def compute_pacing(cuts, duration):
    times = [0.0] + [c["time"] for c in cuts] + ([duration] if duration else [])
    times = sorted(set(round(t, 3) for t in times))
    shot_lengths = [round(b - a, 3) for a, b in zip(times, times[1:]) if b > a]
    result = {
        "num_shots": len(shot_lengths),
        "num_cuts": len(cuts),
        "cuts_per_minute": round(len(cuts) / (duration / 60), 2) if duration else None,
        "shot_length_stats": None,
        "pacing_curve_per_minute": [],
    }
    if shot_lengths:
        result["shot_length_stats"] = {
            "min": round(min(shot_lengths), 2),
            "max": round(max(shot_lengths), 2),
            "mean": round(statistics.mean(shot_lengths), 2),
            "median": round(statistics.median(shot_lengths), 2),
            "stdev": round(statistics.pstdev(shot_lengths), 2) if len(shot_lengths) > 1 else 0.0,
        }
    if duration and duration > 0:
        n_buckets = max(1, int(duration // 60) + 1)
        buckets = [0] * n_buckets
        for c in cuts:
            idx = min(int(c["time"] // 60), n_buckets - 1)
            buckets[idx] += 1
        result["pacing_curve_per_minute"] = buckets
    return result


def brightness_curve(path, timeout=600, fps_sample=1):
    r = run(
        ["ffmpeg", "-i", path, "-vf", f"fps={fps_sample},showinfo", "-an", "-f", "null", "-"],
        timeout=timeout,
    )
    points = []
    for line in r.stderr.splitlines():
        if "pts_time:" not in line or "mean:" not in line:
            continue
        m = SHOWINFO_RE.search(line)
        if m:
            mean = [float(x) for x in m.group("mean").split()]
            points.append({"time": round(float(m.group("t")), 2), "luma_mean": round(mean[0], 1) if mean else None})
    return points


def extract_frame(path, t, out_path, timeout=30):
    run(["ffmpeg", "-y", "-ss", f"{max(t, 0):.3f}", "-i", path, "-frames:v", "1", "-q:v", "3", out_path],
        timeout=timeout, check=True)


def extract_frames(path, cuts, duration, frames_dir, max_frames=36):
    os.makedirs(frames_dir, exist_ok=True)
    targets = []  # (time, tag)

    if cuts:
        max_cut_events = max(4, max_frames // 3)
        chosen_cuts = cuts
        if len(cuts) > max_cut_events:
            step = len(cuts) / max_cut_events
            chosen_cuts = [cuts[int(i * step)] for i in range(max_cut_events)]
        for c in chosen_cuts:
            t = c["time"]
            targets.append((max(t - 0.12, 0.0), f"cut_{t:.2f}s_before"))
            targets.append((t + 0.12, f"cut_{t:.2f}s_after"))

    remaining = max(4, max_frames - len(targets))
    if duration and duration > 0:
        for i in range(remaining):
            frac = (i + 0.5) / remaining
            targets.append((frac * duration, f"interval_{frac:.2f}"))
    else:
        targets.append((0.0, "start"))

    # de-dupe near-identical timestamps (within 0.15s), cap total count
    targets.sort(key=lambda x: x[0])
    deduped = []
    for t, tag in targets:
        if deduped and abs(t - deduped[-1][0]) < 0.15:
            continue
        deduped.append((t, tag))
    deduped = deduped[:max_frames]

    manifest = []
    for t, tag in deduped:
        fname = f"frame_{t:07.2f}_{tag}.jpg".replace("/", "_")
        fpath = os.path.join(frames_dir, fname)
        try:
            extract_frame(path, t, fpath)
            if os.path.isfile(fpath) and os.path.getsize(fpath) > 0:
                manifest.append({"time": round(t, 2), "tag": tag, "file": os.path.relpath(fpath, os.path.dirname(frames_dir))})
        except Exception as e:
            warn(f"frame extraction failed at t={t:.2f}s ({tag}): {e}")
    return manifest


def transcribe(path, has_audio, workdir, model_size="base", skip=False, max_duration_for_auto=3600):
    if skip:
        return {"available": False, "reason": "skipped by user"}
    if not has_audio:
        return {"available": False, "reason": "no audio track"}
    if not ensure_pip_package("faster-whisper", "faster_whisper", timeout=240):
        return {"available": False, "reason": "faster-whisper unavailable (install failed or offline)"}

    wav_path = os.path.join(workdir, "audio.wav")
    try:
        run(["ffmpeg", "-y", "-i", path, "-vn", "-ac", "1", "-ar", "16000", wav_path], timeout=300, check=True)
    except Exception as e:
        return {"available": False, "reason": f"audio extraction failed: {e}"}

    try:
        from faster_whisper import WhisperModel
        info(f"Transcribing with faster-whisper ({model_size}, int8, CPU)... this can take a while.")
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
        segments_iter, info_obj = model.transcribe(wav_path, beam_size=1, vad_filter=True)
        segments = []
        for seg in segments_iter:
            segments.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text.strip()})
    except Exception as e:
        msg = str(e)
        if "403" in msg or "Forbidden" in msg:
            msg += " (model weights download from huggingface.co was blocked -- likely a network/egress " \
                   "restriction in this environment, not a code problem; transcription needs that host reachable)"
        return {"available": False, "reason": f"transcription failed: {msg}"}

    total_words = sum(len(s["text"].split()) for s in segments)
    speech_duration = sum(s["end"] - s["start"] for s in segments)
    wpm = round(total_words / (speech_duration / 60), 1) if speech_duration > 0 else None

    pauses = []
    for a, b in zip(segments, segments[1:]):
        gap = b["start"] - a["end"]
        if gap >= 0.5:
            pauses.append({"after_time": round(a["end"], 2), "duration": round(gap, 2)})

    return {
        "available": True,
        "model": model_size,
        "language": getattr(info_obj, "language", None),
        "segments": segments,
        "full_text": " ".join(s["text"] for s in segments).strip(),
        "total_words": total_words,
        "speech_duration_sec": round(speech_duration, 2),
        "words_per_minute": wpm,
        "num_pauses_over_0.5s": len(pauses),
        "pauses": pauses[:50],
    }


def main():
    ap = argparse.ArgumentParser(description="Deep video analysis engine for the watchutube skill")
    ap.add_argument("source", help="Local video file path or a video URL")
    ap.add_argument("--outdir", default=None, help="Output directory (default: ./watchutube_analysis_<name>)")
    ap.add_argument("--skip-transcription", action="store_true")
    ap.add_argument("--whisper-model", default="base", choices=["tiny", "base", "small", "medium"])
    ap.add_argument("--max-frames", type=int, default=36)
    ap.add_argument("--cut-threshold", type=float, default=0.28)
    ap.add_argument("--max-download-height", type=int, default=1080)
    args = ap.parse_args()

    if not which("ffmpeg") or not which("ffprobe"):
        print(json.dumps({"ok": False, "error": "ffmpeg/ffprobe not found on PATH"}))
        sys.exit(1)

    slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", os.path.splitext(os.path.basename(args.source))[0])[:60] or "video"
    outdir = args.outdir or f"./watchutube_analysis_{slug}"
    outdir = os.path.abspath(outdir)
    os.makedirs(outdir, exist_ok=True)
    frames_dir = os.path.join(outdir, "frames")

    t0 = time.time()
    try:
        local_path = resolve_input(args.source, outdir, max_height=args.max_download_height)
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)

    info(f"Analyzing {local_path}")
    metadata = get_metadata(local_path)
    duration = metadata["duration_sec"]
    has_audio = metadata["has_audio"]

    info("Detecting cuts/scene changes...")
    cuts = detect_cuts(local_path, duration, threshold=args.cut_threshold)

    info("Detecting silence...")
    silence = detect_silence(local_path) if has_audio else []

    info("Detecting black frames...")
    black = detect_black(local_path)

    info("Detecting freeze frames...")
    freeze = detect_freeze(local_path)

    info("Building loudness curve...")
    loudness = loudness_curve(local_path, has_audio)
    spikes = find_loudness_spikes(loudness) if loudness else []

    info("Building brightness curve...")
    brightness = brightness_curve(local_path)

    pacing = compute_pacing(cuts, duration)

    info("Extracting representative frames for visual inspection...")
    frame_manifest = extract_frames(local_path, cuts, duration, frames_dir, max_frames=args.max_frames)

    transcript = transcribe(
        local_path, has_audio, outdir,
        model_size=args.whisper_model, skip=args.skip_transcription,
    )

    elapsed = round(time.time() - t0, 1)

    report_data = {
        "source": args.source,
        "local_path": local_path,
        "metadata": metadata,
        "cuts": cuts,
        "pacing": pacing,
        "silence": silence,
        "black_frames": black,
        "freeze_frames": freeze,
        "loudness_curve": loudness,
        "loudness_spikes_candidate_sfx": spikes,
        "brightness_curve": brightness,
        "transcript": transcript,
        "frames": frame_manifest,
        "analysis_time_sec": elapsed,
        "warnings": WARNINGS,
    }

    manifest_path = os.path.join(outdir, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(report_data, f, indent=2)

    print(json.dumps({
        "ok": True,
        "outdir": outdir,
        "manifest": manifest_path,
        "frames_dir": frames_dir,
        "num_frames": len(frame_manifest),
        "num_cuts": len(cuts),
        "duration_sec": duration,
        "transcript_available": transcript.get("available", False),
        "warnings": WARNINGS,
        "elapsed_sec": elapsed,
    }))


if __name__ == "__main__":
    main()
