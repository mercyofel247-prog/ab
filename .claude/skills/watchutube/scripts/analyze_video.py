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
import math
import os
import re
import shutil
import statistics
import subprocess
import sys
import time
import urllib.parse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FACE_CASCADE_PATH = os.path.join(SCRIPT_DIR, "..", "assets", "haarcascade_frontalface_default.xml")

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


def ensure_opencv(timeout=180):
    """opencv-python's 5.x line dropped the classic CascadeClassifier (Haar
    cascade) API in favor of DNN-based detectors, which breaks the bundled
    face-detection cascade. Pin a 4.x build, which still has it -- reinstall
    if whatever is already present lacks it."""
    try:
        import cv2
        if hasattr(cv2, "CascadeClassifier"):
            return True
    except ImportError:
        pass
    pin = "opencv-python-headless==4.14.0.94"
    info(f"opencv with the classic CascadeClassifier API not found, installing {pin}...")
    try:
        run([sys.executable, "-m", "pip", "install", "--quiet", pin], timeout=timeout, check=True)
    except Exception as e:
        warn(f"pip install {pin} failed: {e}")
        return False
    try:
        import cv2
        return hasattr(cv2, "CascadeClassifier")
    except ImportError:
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


def get_source_platform_metadata(source, timeout=60):
    """Public platform metadata for a URL source (views/likes/comments/upload
    date/channel/etc.) via yt-dlp's own extractor -- no OAuth, no private
    analytics, just whatever the platform's public page exposes at fetch
    time. NOT available for a local file (there's no platform to query), and
    NOT the same thing as creator-only YouTube Analytics data: this has no
    path to CTR, retention graph, watch time, traffic-source breakdown,
    subscribers-gained, or session data, all of which require the video
    owner's OAuth-authenticated Analytics API access."""
    if not is_url(source):
        return {"available": False, "reason": "local file input has no associated platform metadata"}
    if not ensure_yt_dlp():
        return {"available": False, "reason": "yt-dlp unavailable"}
    r = run(["yt-dlp", "--dump-json", "--no-playlist", "--skip-download", source], timeout=timeout)
    if r.returncode != 0 or not r.stdout.strip():
        reason = (r.stderr or "no output").strip()[-500:]
        return {"available": False, "reason": f"yt-dlp metadata fetch failed: {reason}"}
    try:
        data = json.loads(r.stdout.splitlines()[0])
    except Exception as e:
        return {"available": False, "reason": f"failed to parse yt-dlp metadata: {e}"}
    return {
        "available": True,
        "platform": data.get("extractor_key"),
        "title": data.get("title"),
        "uploader": data.get("uploader") or data.get("channel"),
        "channel_follower_count": data.get("channel_follower_count"),
        "upload_date": data.get("upload_date"),
        "view_count": data.get("view_count"),
        "like_count": data.get("like_count"),
        "comment_count": data.get("comment_count"),
        "average_rating": data.get("average_rating"),
        "categories": data.get("categories"),
        "tags": (data.get("tags") or [])[:25],
        "description_excerpt": ((data.get("description") or "")[:500] or None),
        "note": "public metadata only, as exposed by the platform's page at fetch time -- not the same as "
                "creator-only Analytics data (no CTR, retention, watch time, traffic sources, subscribers "
                "gained, or session data; those require the owner's OAuth-authenticated Analytics API "
                "access, which this tool cannot obtain).",
    }


def check_frame_rate_consistency(path, timeout=180):
    """Detect variable frame rate / dropped-frame irregularities from actual
    per-frame presentation timestamps (not just the single averaged fps
    ffprobe reports in the stream header)."""
    r = run(
        ["ffprobe", "-v", "quiet", "-select_streams", "v:0", "-show_entries",
         "frame=pts_time", "-of", "csv=p=0", path],
        timeout=timeout,
    )
    if r.returncode != 0 or not r.stdout.strip():
        return {"available": False, "reason": "ffprobe could not read per-frame timestamps"}
    times = []
    for line in r.stdout.splitlines():
        line = line.strip()
        if not line or line == "N/A":
            continue
        try:
            times.append(float(line))
        except ValueError:
            continue
    if len(times) < 10:
        return {"available": False, "reason": "too few frame timestamps read"}

    times.sort()
    deltas = [round(b - a, 4) for a, b in zip(times, times[1:]) if b > a]
    if not deltas:
        return {"available": False, "reason": "no valid inter-frame deltas"}

    mean_delta = statistics.mean(deltas)
    stdev_delta = statistics.pstdev(deltas) if len(deltas) > 1 else 0.0
    implied_fps = round(1 / mean_delta, 2) if mean_delta else None
    cv = (stdev_delta / mean_delta) if mean_delta else 0.0
    long_gaps = [round(d, 3) for d in deltas if d > mean_delta * 2.5]

    return {
        "available": True,
        "implied_avg_fps": implied_fps,
        "mean_frame_delta_sec": round(mean_delta, 4),
        "stdev_frame_delta_sec": round(stdev_delta, 4),
        "coefficient_of_variation": round(cv, 3),
        "num_long_gaps_over_2.5x_mean": len(long_gaps),
        "long_gap_examples_sec": long_gaps[:10],
        "likely_variable_frame_rate": cv > 0.15,
        "note": "coefficient_of_variation near 0 means frames are spaced very evenly (true CFR); a high value "
                "or several long-gap entries suggests variable frame rate, dropped frames during capture/"
                "encode, or a screen-recording-style source -- but a single legitimate held/freeze-frame shot "
                "will also show up as one long gap, so cross-check num_long_gaps against `freeze_frames` "
                "before calling it a real problem.",
    }


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

    aspect_ratio = orientation = None
    if vstream and vstream.get("width") and vstream.get("height"):
        w, h = vstream["width"], vstream["height"]
        g = math.gcd(w, h) or 1
        aspect_ratio = f"{w // g}:{h // g}"
        orientation = "landscape" if w > h else ("portrait" if h > w else "square")

    color_transfer = vstream.get("color_transfer") if vstream else None
    is_hdr = color_transfer in ("smpte2084", "arib-std-b67") if color_transfer else None

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
            "aspect_ratio": aspect_ratio,
            "orientation": orientation,
            "color_space": vstream.get("color_space") if vstream else None,
            "color_transfer": color_transfer,
            "color_primaries": vstream.get("color_primaries") if vstream else None,
            "is_hdr": is_hdr,
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
    """Hard-cut candidate timestamps via ffmpeg's `scene` select expression.

    This only fires on an abrupt frame-to-frame jump -- by design, a fade or
    a dissolve changes gradually frame-by-frame and does NOT produce a scene
    score spike, so it is invisible to this detector no matter how the
    threshold is tuned. See `detect_soft_transitions` for the complementary
    pass that catches those."""
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
            cuts.append({"time": round(t, 3), "luma_mean": round(mean[0], 1) if mean else None,
                         "detection": "scene_score"})
    return cuts


def detect_soft_transitions(path, duration, max_dim=120, min_run_frames=3, min_span_sec=0.12,
                             pixel_change_threshold=20, cluster_window_sec=2.5, timeout=600):
    """Catch gradual transitions (fades, dissolves) that `detect_cuts` structurally
    can't see: scans every decoded frame (downscaled + grayscale, so it's cheap)
    for runs of several consecutive frames with *moderately* elevated
    frame-to-frame change -- elevated enough to be a real transition, but never
    spiking the way a hard cut does. Each qualifying run's midpoint becomes a
    transition candidate; `classify_transition` (run later, per-candidate) then
    determines whether it's actually a fade/dissolve/wipe from a closer look.

    A run of elevated mean frame-diff alone doesn't distinguish a real
    transition from a small on-screen element animating in place --
    kinetic-typography text drawing itself on, a bar chart growing, an icon
    spinning, a graphic scrolling all produce the same "sustained
    moderately-elevated global diff" signature a real fade/dissolve/wipe does.
    An earlier version of this function tried to reject those outright using
    a spatial-coverage threshold (what fraction of the frame's *area*
    changed), on the theory that a real transition changes most of the frame
    while an animating graphic only changes a small region. Tested against
    real footage, that didn't hold: on dark/stylized content, genuine
    dissolves between two different scenes can have just as little measured
    pixel-coverage as a false-positive graphic animation (the coverage
    ranges overlap), so a hard cutoff there silently dropped real cuts.
    Distinguishing "the whole picture changed" from "one element animated in
    a static composition" from motion statistics alone isn't reliable --
    it's a content-understanding call, not a numeric one.

    So each candidate here still gets computed (never dropped) with two
    extra diagnostic fields for whoever is *writing the report* to weigh
    against the actual frames: `frame_coverage` (fraction of frame area that
    changed across the run -- low is *consistent with* an animating graphic
    but not proof of one) and `nearby_soft_candidates` (how many other
    frame_diff_scan candidates fall within `cluster_window_sec` of this one
    -- a tight cluster of several is the strongest real signal of "this is
    one continuous on-screen animation registering as multiple candidates,"
    since genuine edits are rarely stacked that densely). See
    references/metrics.md for how to read these."""
    if not ensure_opencv():
        warn("opencv unavailable, skipping soft-transition (fade/dissolve) scan")
        return []
    if duration > 0 and duration > 1800:
        warn("video is > 30min; soft-transition scan may take a while")
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        warn("could not open video for soft-transition scan")
        return []
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0

    frames = []   # downscaled grayscale frames, kept so candidate runs can be re-examined spatially
    series = []   # (time, diff, luma) -- series[k] is the diff between frames[k] and frames[k+1]
    prev = None
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape
        if w > max_dim:
            scale = max_dim / w
            gray = cv2.resize(gray, (max_dim, max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
        frames.append(gray)
        if prev is not None:
            d = float(np.mean(np.abs(gray.astype(np.int16) - prev.astype(np.int16))))
            series.append((idx / fps, d, float(np.mean(gray))))
        prev = gray
        idx += 1
    cap.release()
    if len(series) < min_run_frames * 2:
        return []

    vals = [d for _, d, _ in series]
    med = statistics.median(vals)
    mad = statistics.median([abs(v - med) for v in vals]) or 0.5
    soft_lo = med + 3 * mad + 1.0     # elevated above ambient noise/motion
    soft_hi = med + 8 * mad + 3.0     # below this, i.e. not a hard-cut-grade spike

    def run_coverage(start_idx, end_idx):
        """Fraction of frame pixels that changed by more than `pixel_change_threshold`
        at least once across series[start_idx..end_idx] (i.e. frames[start_idx..end_idx+1])."""
        h, w = frames[0].shape
        changed = np.zeros((h, w), dtype=bool)
        for k in range(start_idx, end_idx + 1):
            d = np.abs(frames[k].astype(np.int16) - frames[k + 1].astype(np.int16))
            changed |= d > pixel_change_threshold
        return float(np.count_nonzero(changed)) / (h * w)

    candidates = []
    i, n = 0, len(series)
    while i < n:
        d = series[i][1]
        if soft_lo <= d < soft_hi:
            j = i
            run = []
            while j < n and soft_lo <= series[j][1] < soft_hi:
                run.append(series[j])
                j += 1
            span = run[-1][0] - run[0][0]
            if len(run) >= min_run_frames and span >= min_span_sec:
                coverage = run_coverage(i, j - 1)
                mid_t, _, mid_luma = run[len(run) // 2]
                candidates.append({"time": round(mid_t, 3), "luma_mean": round(mid_luma, 1),
                                    "detection": "frame_diff_scan", "span_sec": round(span, 2),
                                    "frame_coverage": round(coverage, 2)})
            i = j
        else:
            i += 1

    for c in candidates:
        c["nearby_soft_candidates"] = sum(
            1 for o in candidates if o is not c and abs(o["time"] - c["time"]) <= cluster_window_sec
        )
    return candidates


def merge_cut_candidates(hard_cuts, soft_candidates, dedupe_window=0.3):
    """Union hard-cut (scene-score) and soft-transition (frame-diff-run) candidates,
    dropping a soft candidate that's really just the tail of a hard cut already found."""
    combined = list(hard_cuts)
    for s in soft_candidates:
        if not any(abs(s["time"] - c["time"]) < dedupe_window for c in combined):
            combined.append(s)
    combined.sort(key=lambda c: c["time"])
    return combined


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


LOUDNORM_JSON_RE = re.compile(r"\{[^{}]*\"input_i\"[^{}]*\}", re.S)


def measure_loudness_lufs(path, has_audio, timeout=180):
    """Integrated loudness (LUFS), true peak, and loudness range (LRA) via
    ffmpeg's `loudnorm` filter in single-pass measure mode -- the actual
    broadcast/streaming loudness standard, as opposed to the raw per-second
    RMS dB in `loudness_curve` (which is better for spotting relative spikes
    over time, not for checking mix levels against a delivery spec)."""
    if not has_audio:
        return {"available": False, "reason": "no audio track"}
    r = run(["ffmpeg", "-i", path, "-af", "loudnorm=print_format=json", "-f", "null", "-"], timeout=timeout)
    m = LOUDNORM_JSON_RE.search(r.stderr)
    if not m:
        return {"available": False, "reason": "loudnorm did not report measurements (very short/silent audio?)"}
    try:
        data = json.loads(m.group(0))
    except Exception as e:
        return {"available": False, "reason": f"failed to parse loudnorm output: {e}"}

    def f(key):
        try:
            return float(data.get(key))
        except (TypeError, ValueError):
            return None

    return {
        "available": True,
        "integrated_lufs": f("input_i"),
        "loudness_range_lu": f("input_lra"),
        "true_peak_dbtp": f("input_tp"),
        "threshold_lufs": f("input_thresh"),
    }


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


def select_cuts_subset(cuts, max_count):
    """Evenly subsample a cut list down to max_count entries, preserving order.
    Used to keep both frame extraction and frame-diff classification bounded
    (and pointed at the *same* cuts) on cut-heavy videos."""
    if len(cuts) <= max_count:
        return cuts
    step = len(cuts) / max_count
    return [cuts[int(i * step)] for i in range(max_count)]


def extract_frames(path, chosen_cuts, duration, frames_dir, max_frames=36):
    os.makedirs(frames_dir, exist_ok=True)
    targets = []  # (time, tag)

    if chosen_cuts:
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


def extract_audio_wav(path, workdir, sample_rate=16000, cache_key="audio"):
    """Extract mono audio to WAV once; reused by transcription and beat detection."""
    wav_path = os.path.join(workdir, f"{cache_key}_{sample_rate}.wav")
    if os.path.isfile(wav_path) and os.path.getsize(wav_path) > 0:
        return wav_path
    run(["ffmpeg", "-y", "-i", path, "-vn", "-ac", "1", "-ar", str(sample_rate), wav_path],
        timeout=300, check=True)
    return wav_path


def transcribe(path, has_audio, workdir, model_size="base", skip=False):
    if skip:
        return {"available": False, "reason": "skipped by user"}
    if not has_audio:
        return {"available": False, "reason": "no audio track"}
    if not ensure_pip_package("faster-whisper", "faster_whisper", timeout=240):
        return {"available": False, "reason": "faster-whisper unavailable (install failed or offline)"}

    try:
        wav_path = extract_audio_wav(path, workdir, sample_rate=16000)
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


# ---------------------------------------------------------------------------
# Advanced analysis: automatic transition classification, motion, faces,
# on-screen text (OCR), music beat/tempo alignment, color palette/grading,
# per-shot camera movement, and audio/video edit-offset (J-cut/L-cut).
# ---------------------------------------------------------------------------

def _load_gray_small(path, width=96):
    import cv2
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return None
    h, w = img.shape
    if w == 0:
        return None
    scale = width / w
    return cv2.resize(img, (width, max(1, int(h * scale))), interpolation=cv2.INTER_AREA)


def classify_transition(path, cut_time, workdir, half_window=0.5, burst_fps=20, timeout=30):
    """
    Sample a short burst of frames straddling a cut and classify how the
    shot actually changes, using frame-to-frame pixel diffs, a luma ramp
    (for fades), and left/right-half diff asymmetry (for wipes) -- instead
    of leaving the transition *type* as a pure guess from two still frames.
    Returns a dict with `type`, `confidence` (0-1), and `detail` for
    transparency; never raises -- degrades to type "unknown" on any failure.
    """
    if not ensure_opencv():
        return {"type": "unknown", "confidence": 0.0, "detail": {"reason": "opencv unavailable"}}
    import numpy as np

    start = max(cut_time - half_window, 0.0)
    burst_dir = os.path.join(workdir, "_burst_tmp")
    os.makedirs(burst_dir, exist_ok=True)
    for f in os.listdir(burst_dir):
        os.remove(os.path.join(burst_dir, f))
    pattern = os.path.join(burst_dir, "b_%03d.jpg")
    try:
        run(["ffmpeg", "-y", "-ss", f"{start:.3f}", "-i", path, "-t", f"{half_window * 2:.3f}",
             "-vf", f"fps={burst_fps}", "-q:v", "3", pattern], timeout=timeout, check=True)
    except Exception as e:
        return {"type": "unknown", "confidence": 0.0, "detail": {"reason": f"burst extraction failed: {e}"}}

    files = sorted(f for f in os.listdir(burst_dir) if f.endswith(".jpg"))
    if len(files) < 4:
        return {"type": "unknown", "confidence": 0.0, "detail": {"reason": "too few burst frames"}}

    frames = [_load_gray_small(os.path.join(burst_dir, f)) for f in files]
    frames = [f for f in frames if f is not None]
    if len(frames) < 4:
        return {"type": "unknown", "confidence": 0.0, "detail": {"reason": "too few decodable burst frames"}}

    diffs, luma, left_diffs, right_diffs = [], [float(np.mean(frames[0]))], [], []
    for a, b in zip(frames, frames[1:]):
        d = np.abs(a.astype(np.int16) - b.astype(np.int16))
        diffs.append(float(np.mean(d)))
        luma.append(float(np.mean(b)))
        mid = a.shape[1] // 2
        left_diffs.append(float(np.mean(d[:, :mid])))
        right_diffs.append(float(np.mean(d[:, mid:])))

    max_diff = max(diffs)
    med_diff = statistics.median(diffs)
    spike_idx = diffs.index(max_diff)
    is_single_spike = max_diff > 3 * (med_diff + 0.5) and sum(1 for d in diffs if d > 0.5 * max_diff) <= 2
    elevated_run = sum(1 for d in diffs if d > 0.35 * max_diff)

    min_luma, max_luma = min(luma), max(luma)
    near_black = min_luma < 18
    near_white = max_luma > 235

    # crude wipe signal: one half changes well before/after the other around the spike
    onset_l = next((i for i, d in enumerate(left_diffs) if d > 0.5 * max(left_diffs, default=1)), None)
    onset_r = next((i for i, d in enumerate(right_diffs) if d > 0.5 * max(right_diffs, default=1)), None)
    asymmetric = (
        onset_l is not None and onset_r is not None and abs(onset_l - onset_r) >= 2
        and max(max(left_diffs, default=0), max(right_diffs, default=0)) > 0.4 * max_diff
    )

    detail = {
        "max_frame_diff": round(max_diff, 2),
        "median_frame_diff": round(med_diff, 2),
        "elevated_frame_pairs": elevated_run,
        "min_luma_in_window": round(min_luma, 1),
        "max_luma_in_window": round(max_luma, 1),
        "left_right_onset_gap_frames": None if onset_l is None or onset_r is None else abs(onset_l - onset_r),
    }

    if near_black:
        return {"type": "fade_to/from_black", "confidence": 0.75, "detail": detail}
    if near_white:
        return {"type": "fade_to/from_white", "confidence": 0.7, "detail": detail}
    if asymmetric:
        return {"type": "wipe_candidate", "confidence": 0.5, "detail": detail}
    if is_single_spike:
        return {"type": "hard_cut", "confidence": 0.85, "detail": detail}
    if elevated_run >= 3:
        return {"type": "dissolve/cross_fade", "confidence": 0.6, "detail": detail}
    return {"type": "hard_cut", "confidence": 0.4, "detail": detail}


def motion_curve(path, duration, sample_fps=3, max_dim=160, timeout=600):
    """Frame-to-frame visual-change curve (0-100), independent of hard cuts --
    catches camera pans/action within a single unbroken shot that scene-cut
    detection deliberately ignores."""
    if not ensure_opencv():
        warn("opencv unavailable, skipping motion curve")
        return []
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        warn("could not open video for motion analysis")
        return []
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    step = max(1, round(src_fps / sample_fps))

    points = []
    prev = None
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % step == 0:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            h, w = gray.shape
            if w > max_dim:
                scale = max_dim / w
                gray = cv2.resize(gray, (max_dim, max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
            if prev is not None:
                d = float(np.mean(np.abs(gray.astype(np.int16) - prev.astype(np.int16))))
                points.append({"time": round(idx / src_fps, 2), "motion": round(min(d * 3.0, 100.0), 1)})
            prev = gray
        idx += 1
    cap.release()
    return points


def detect_faces_in_frames(frame_manifest, output_dir):
    """Tag already-extracted sample frames with a face count using a bundled
    Haar cascade (fully offline -- no model download needed). When a face is
    found, also derive a rough shot-framing guess (close-up/medium/wide) from
    how much of the frame the largest face occupies -- a cheap, evidence-based
    stand-in for real shot-type classification (no ML model for that here)."""
    if not frame_manifest:
        return frame_manifest
    if not os.path.isfile(FACE_CASCADE_PATH):
        warn("face-detection cascade asset missing, skipping face detection")
        return frame_manifest
    if not ensure_opencv():
        warn("opencv unavailable, skipping face detection")
        return frame_manifest
    import cv2
    cascade = cv2.CascadeClassifier(FACE_CASCADE_PATH)
    if cascade.empty():
        warn("failed to load face-detection cascade")
        return frame_manifest
    for entry in frame_manifest:
        fpath = os.path.join(output_dir, entry["file"])
        img = cv2.imread(fpath, cv2.IMREAD_GRAYSCALE)
        if img is None:
            continue
        faces = cascade.detectMultiScale(img, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40))
        entry["faces"] = int(len(faces))
        if len(faces) > 0:
            img_h, img_w = img.shape
            fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
            ratio = (fw * fh) / (img_w * img_h) if img_w and img_h else 0
            entry["largest_face_frame_area_pct"] = round(ratio * 100, 1)
            if img_w and img_h:
                entry["largest_face_center_pct"] = [
                    round(100 * (fx + fw / 2) / img_w, 1), round(100 * (fy + fh / 2) / img_h, 1),
                ]
            if ratio > 0.15:
                entry["shot_type_guess"] = "close-up"
            elif ratio > 0.04:
                entry["shot_type_guess"] = "medium"
            else:
                entry["shot_type_guess"] = "wide"
    return frame_manifest


def ocr_frames(frame_manifest, output_dir, only_tag_prefix="interval_", max_frames=20, timeout=15):
    """Best-effort OCR for burned-in text (titles, lower-thirds, captions) on
    the evenly-sampled frames. Skipped gracefully if tesseract isn't
    installed -- it's a system binary, not something this script installs.

    Also derives a rough text-prominence label from the tallest confident
    word box on the frame (relative to frame height) -- a cheap stand-in for
    "is this a title card, a lower-third, or fine-print/captions" since
    identifying actual font/weight isn't feasible without a layout model."""
    if not which("tesseract"):
        return {"available": False, "reason": "tesseract-ocr binary not found on PATH (optional system package)"}
    if not ensure_pip_package("pytesseract", "pytesseract", timeout=60):
        return {"available": False, "reason": "pytesseract unavailable"}
    import numpy as np
    import pytesseract
    from pytesseract import Output
    from PIL import Image

    def region_contrast(arr, box, pad=8):
        """Mean luma inside a text bbox vs. a padded ring around it -- a coarse
        proxy for text/background contrast (not a true WCAG contrast-ratio
        formula, just a luma-difference read on 0-255)."""
        H, W = arr.shape
        l, t, w, h = box
        l0, t0 = max(int(l), 0), max(int(t), 0)
        l1, t1 = min(int(l + w), W), min(int(t + h), H)
        if l1 <= l0 or t1 <= t0:
            return None
        text_mean = float(arr[t0:t1, l0:l1].mean())
        ol0, ot0 = max(l0 - pad, 0), max(t0 - pad, 0)
        ol1, ot1 = min(l1 + pad, W), min(t1 + pad, H)
        outer = arr[ot0:ot1, ol0:ol1]
        mask = np.ones(outer.shape, dtype=bool)
        mask[(t0 - ot0):(t1 - ot0), (l0 - ol0):(l1 - ol0)] = False
        bg_pixels = outer[mask]
        if bg_pixels.size == 0:
            return None
        bg_mean = float(bg_pixels.mean())
        return text_mean, bg_mean, abs(text_mean - bg_mean)

    hits = []
    candidates = [e for e in frame_manifest if e["tag"].startswith(only_tag_prefix)][:max_frames]
    for entry in candidates:
        fpath = os.path.join(output_dir, entry["file"])
        try:
            data = pytesseract.image_to_data(fpath, config="--psm 11", output_type=Output.DICT, timeout=timeout)
        except Exception:
            continue
        words = [w for w in data.get("text", []) if w.strip()]
        text = re.sub(r"\s+", " ", " ".join(words)).strip()
        if len(text) < 3:
            continue
        entry["ocr_text"] = text[:200]
        hit = {"time": entry["time"], "text": text[:200]}
        try:
            with Image.open(fpath) as im:
                img_h = im.height
                arr = np.array(im.convert("L"), dtype=np.float64)
            heights = data.get("height", [])
            confs = data.get("conf", [])
            confident_idx = [i for i, (h, c) in enumerate(zip(heights, confs)) if h and float(c) > 30]
            if confident_idx:
                best_i = max(confident_idx, key=lambda i: heights[i])
                max_h = heights[best_i]
                if img_h:
                    prom_pct = round(100.0 * max_h / img_h, 1)
                    hit["prominence_pct"] = prom_pct
                    hit["prominence_label"] = (
                        "title/headline" if prom_pct >= 8 else
                        "subtitle/lower-third" if prom_pct >= 3 else
                        "fine-print/caption"
                    )
                box = (data["left"][best_i], data["top"][best_i], data["width"][best_i], data["height"][best_i])
                contrast = region_contrast(arr, box)
                if contrast:
                    text_mean, bg_mean, diff = contrast
                    hit["text_luma"] = round(text_mean, 1)
                    hit["background_luma"] = round(bg_mean, 1)
                    hit["luma_contrast_0_255"] = round(diff, 1)
                    hit["readability_label"] = (
                        "high contrast/likely readable" if diff >= 80 else
                        "medium contrast" if diff >= 30 else
                        "low contrast/may be hard to read"
                    )
        except Exception:
            pass
        hits.append(hit)
    return {
        "available": True,
        "detections": hits,
        "readability_note": "luma_contrast_0_255/readability_label is a coarse text-vs-background luma-"
                             "difference proxy on the tallest confident word's box, not a real WCAG contrast-"
                             "ratio calculation and not aware of text color vs. background color separately "
                             "from brightness (e.g. equally-bright but differently-hued text/background can "
                             "read as low contrast here while still being readable to a viewer).",
    }


def beat_analysis(path, workdir, cuts, has_audio, tolerance_sec=0.15):
    """Music tempo + beat grid via librosa, and what fraction of cuts land on
    (or very near) a beat -- a real editorial signal for music-driven edits."""
    if not has_audio:
        return {"available": False, "reason": "no audio track"}
    if not ensure_pip_package("librosa", "librosa", timeout=240):
        return {"available": False, "reason": "librosa unavailable (install failed or offline)"}
    try:
        wav_path = extract_audio_wav(path, workdir, sample_rate=22050, cache_key="audio_beat")
        import librosa
        y, sr = librosa.load(wav_path, sr=None, mono=True)
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
        tempo_val = float(tempo) if not hasattr(tempo, "item") else float(tempo.item()) if tempo.size == 1 else float(tempo[0])
    except Exception as e:
        return {"available": False, "reason": f"beat detection failed: {e}"}

    on_beat = 0
    for c in cuts:
        if any(abs(c["time"] - bt) <= tolerance_sec for bt in beat_times):
            on_beat += 1
    pct = round(100.0 * on_beat / len(cuts), 1) if cuts else None

    return {
        "available": True,
        "tempo_bpm": round(tempo_val, 1),
        "num_beats": len(beat_times),
        "beat_times": [round(t, 2) for t in beat_times[:400]],
        "cuts_on_beat": on_beat,
        "cuts_on_beat_pct": pct,
        "tolerance_sec": tolerance_sec,
    }


def analyze_color_palette(frame_manifest, output_dir, k=5, max_frames=20):
    """Dominant-color extraction (k-means over downsampled pixels) per sampled
    frame plus an overall palette across all of them, with average
    saturation/brightness as a quick read on "vibrant vs. desaturated/grungy"
    grading. Reuses frames already extracted for visual inspection -- no
    extra decoding pass -- and only needs opencv, already a dependency."""
    if not ensure_opencv():
        return {"available": False, "reason": "opencv unavailable"}
    import cv2
    import numpy as np

    candidates = [e for e in frame_manifest if e["tag"].startswith("interval_")][:max_frames]
    if not candidates:
        candidates = frame_manifest[:max_frames]

    def dominant(pixels, kk):
        kk = max(1, min(kk, len(pixels)))
        criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 15, 1.0)
        _, labels, centers = cv2.kmeans(pixels, kk, None, criteria, 3, cv2.KMEANS_RANDOM_CENTERS)
        counts = np.bincount(labels.flatten(), minlength=kk)
        order = np.argsort(-counts)
        out = []
        for idx in order:
            b, g, r = centers[idx]
            out.append({
                "hex": "#{:02x}{:02x}{:02x}".format(int(r), int(g), int(b)),
                "pct": round(100.0 * counts[idx] / counts.sum(), 1),
            })
        return out

    per_frame, all_pixels = [], []
    for entry in candidates:
        fpath = os.path.join(output_dir, entry["file"])
        img = cv2.imread(fpath)
        if img is None:
            continue
        small = cv2.resize(img, (64, 36), interpolation=cv2.INTER_AREA)
        pixels = small.reshape(-1, 3).astype(np.float32)
        per_frame.append({"time": entry["time"], "palette": dominant(pixels, k)[:5]})
        all_pixels.append(pixels)

    if not per_frame:
        return {"available": False, "reason": "no frames to sample"}

    stacked = np.vstack(all_pixels)
    if len(stacked) > 20000:
        idx = np.random.default_rng(0).choice(len(stacked), 20000, replace=False)
        stacked = stacked[idx]
    overall = dominant(stacked, k)[:6]

    hsv = cv2.cvtColor(stacked.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_BGR2HSV).reshape(-1, 3)
    avg_sat = round(float(np.mean(hsv[:, 1])) / 255 * 100, 1)
    avg_val = round(float(np.mean(hsv[:, 2])) / 255 * 100, 1)

    b_mean, g_mean, r_mean = (float(np.mean(stacked[:, i])) for i in range(3))
    warmth = (r_mean - b_mean) / max(r_mean + b_mean, 1.0)
    wb_label = (
        "warm (amber/red-leaning)" if warmth > 0.08 else
        "cool (blue-leaning)" if warmth < -0.08 else
        "neutral"
    )

    return {
        "available": True,
        "overall_palette": overall,
        "avg_saturation_pct": avg_sat,
        "avg_brightness_pct": avg_val,
        "white_balance_estimate": {
            "avg_r": round(r_mean, 1), "avg_g": round(g_mean, 1), "avg_b": round(b_mean, 1),
            "warmth_score": round(warmth, 3), "label": wb_label,
            "note": "a channel-mean-ratio proxy for warm/cool color-temperature bias across the sampled "
                    "frames, not a measured Kelvin value and not a substitute for a real white-balance "
                    "reading off a reference card -- a scene that's genuinely warm-lit (e.g. a sunset) will "
                    "read 'warm' here whether or not the white balance itself was set correctly.",
        },
        "per_frame": per_frame,
    }


def detect_camera_movement(path, cuts, duration, max_shots=24, sample_fps=2.0, max_dim=160,
                            max_shot_span=6.0, min_shot_len=0.4):
    """Per-shot camera-movement classification (static/pan-tilt/zoom-in/
    zoom-out/handheld) from dense optical flow -- motion_curve tells you *how
    much* changed within a shot, this tells you *what kind* of movement did
    it. A heuristic like the rest of the classifiers here: returns a
    confidence and the raw flow numbers behind the call, not just a label.
    Capped to `max_shots` (evenly sampled across the whole shot list) and a
    `max_shot_span` per shot to keep cost bounded on long/cut-heavy videos.
    Note: frame seeking by timestamp is approximate on long-GOP codecs, so
    treat exact per-shot boundaries as approximate too."""
    if not ensure_opencv():
        warn("opencv unavailable, skipping camera-movement classification")
        return []
    import cv2
    import numpy as np

    bounds = sorted(set(round(b, 3) for b in [0.0] + [c["time"] for c in cuts] + ([duration] if duration else [])))
    shots = [(a, b) for a, b in zip(bounds, bounds[1:]) if b - a >= min_shot_len]
    if not shots:
        return []
    selected = select_cuts_subset(shots, max_shots)

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        warn("could not open video for camera-movement analysis")
        return []

    results = []
    for start, end in selected:
        span = min(end - start, max_shot_span)
        n_samples = max(3, int(span * sample_fps))
        grays = []
        for i in range(n_samples + 1):
            t = start + i * (span / n_samples)
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, frame = cap.read()
            if not ok:
                continue
            g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            h, w = g.shape
            if w > max_dim:
                scale = max_dim / w
                g = cv2.resize(g, (max_dim, max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
            grays.append(g)
        if len(grays) < 3:
            continue

        h, w = grays[0].shape
        yy, xx = np.mgrid[0:h, 0:w]
        rx, ry = (xx - w / 2.0), (yy - h / 2.0)
        rnorm = np.sqrt(rx ** 2 + ry ** 2) + 1e-6
        rux, ruy = rx / rnorm, ry / rnorm

        mags, mean_dxs, mean_dys, radial_scores = [], [], [], []
        for a, b in zip(grays, grays[1:]):
            flow = cv2.calcOpticalFlowFarneback(a, b, None, 0.5, 2, 15, 2, 5, 1.1, 0)
            fx, fy = flow[..., 0], flow[..., 1]
            mags.append(float(np.mean(np.sqrt(fx ** 2 + fy ** 2))))
            mean_dxs.append(float(np.mean(fx)))
            mean_dys.append(float(np.mean(fy)))
            radial_scores.append(float(np.mean(fx * rux + fy * ruy)))

        mean_mag = statistics.mean(mags)
        mean_dx, mean_dy = statistics.mean(mean_dxs), statistics.mean(mean_dys)
        translation_mag = math.hypot(mean_dx, mean_dy)
        mean_radial = statistics.mean(radial_scores)
        angles = [math.atan2(dy, dx) for dx, dy in zip(mean_dxs, mean_dys) if math.hypot(dx, dy) > 0.05]
        angle_var = statistics.pstdev(angles) if len(angles) > 1 else 0.0

        detail = {
            "mean_flow_magnitude": round(mean_mag, 3),
            "mean_translation_magnitude": round(translation_mag, 3),
            "mean_radial_flow": round(mean_radial, 3),
            "direction_angle_stdev": round(angle_var, 3),
            "samples": len(grays),
        }

        if mean_mag < 0.35:
            movement = {"type": "static", "confidence": 0.7, "detail": detail}
        elif abs(mean_radial) > 0.5 * mean_mag and abs(mean_radial) > 0.3:
            movement = {"type": "zoom_in" if mean_radial > 0 else "zoom_out", "confidence": 0.55, "detail": detail}
        elif angle_var > 1.2 and mean_mag > 0.6:
            movement = {"type": "handheld/shake", "confidence": 0.5, "detail": detail}
        elif translation_mag > 0.4 * mean_mag:
            movement = {"type": "pan/tilt", "confidence": 0.6, "detail": detail}
        else:
            movement = {"type": "static", "confidence": 0.4, "detail": detail}

        results.append({"shot_start": round(start, 2), "shot_end": round(end, 2), "movement": movement})
    cap.release()
    return results


def detect_edit_offset(path, cut_time, workdir, window=1.2, resolution_sec=0.05, timeout=20):
    """Check whether the audio actually changes character (a real RMS-level
    jump, not just ambient noise) right at a video cut, or measurably before
    (a J-cut -- next scene's sound leads the picture) or after (an L-cut --
    previous scene's sound trails the picture) it. Standard professional
    editing techniques that pure video-side cut detection can't see at all.
    A heuristic on coarse RMS windows, not a proper audio-scene-change model
    -- treat `confidence` accordingly, and 'no_clear_audio_transition' as
    just that (this cut's audio didn't shift enough to say anything), not
    proof there's no edit there."""
    start = max(cut_time - window, 0.0)
    clip_path = os.path.join(workdir, "_editoffset_tmp.wav")
    try:
        run(["ffmpeg", "-y", "-ss", f"{start:.3f}", "-i", path, "-t", f"{window * 2:.3f}",
             "-vn", "-ac", "1", "-ar", "16000", clip_path], timeout=timeout, check=True)
    except Exception as e:
        return {"type": "unknown", "confidence": 0.0, "detail": {"reason": f"clip extraction failed: {e}"}}

    n = int(16000 * resolution_sec)
    r = run(
        ["ffmpeg", "-i", clip_path, "-af",
         f"asetnsamples=n={n}:p=0,astats=metadata=1:reset=1,"
         "ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
         "-f", "null", "-"],
        timeout=timeout,
    )
    try:
        os.remove(clip_path)
    except OSError:
        pass

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
            points.append((pending_t, db))
            pending_t = None

    if len(points) < 4:
        return {"type": "unknown", "confidence": 0.0, "detail": {"reason": "too few audio samples"}}

    best_idx, best_jump = None, 0.0
    for i in range(1, len(points)):
        d0, d1 = points[i - 1][1], points[i][1]
        if d0 is None or d1 is None:
            continue
        jump = abs(d1 - d0)
        if jump > best_jump:
            best_jump, best_idx = jump, i

    if best_idx is None or best_jump < 4.0:
        return {"type": "no_clear_audio_transition", "confidence": 0.0, "detail": {"max_jump_db": round(best_jump, 1)}}

    jump_time_abs = start + points[best_idx][0]
    offset = round(jump_time_abs - cut_time, 3)
    detail = {"max_jump_db": round(best_jump, 1), "audio_jump_offset_from_cut_sec": offset}

    if abs(offset) <= 0.1:
        return {"type": "aligned_cut", "confidence": 0.6, "detail": detail}
    elif offset < -0.1:
        return {"type": "j_cut_candidate", "confidence": round(min(0.3 + abs(offset), 0.8), 2), "detail": detail}
    else:
        return {"type": "l_cut_candidate", "confidence": round(min(0.3 + abs(offset), 0.8), 2), "detail": detail}


def analyze_exposure(frame_manifest, output_dir, max_frames=20):
    """Histogram-based exposure read per sampled frame: percentage of pixels
    clipped near-black (crushed shadows) or near-white (blown highlights),
    and a contrast/dynamic-range estimate from the 5th/95th percentile luma
    spread. Reuses frames already extracted -- no extra decode pass."""
    if not ensure_opencv():
        return {"available": False, "reason": "opencv unavailable"}
    import cv2
    import numpy as np

    candidates = [e for e in frame_manifest if e["tag"].startswith("interval_")][:max_frames]
    if not candidates:
        candidates = frame_manifest[:max_frames]

    per_frame, all_shadow, all_highlight, all_contrast = [], [], [], []
    for entry in candidates:
        img = cv2.imread(os.path.join(output_dir, entry["file"]), cv2.IMREAD_GRAYSCALE)
        if img is None:
            continue
        total = img.size
        shadow_clip = float(np.count_nonzero(img <= 5)) / total * 100
        highlight_clip = float(np.count_nonzero(img >= 250)) / total * 100
        p5, p95 = np.percentile(img, [5, 95])
        contrast = float(p95 - p5)
        per_frame.append({
            "time": entry["time"], "shadow_clip_pct": round(shadow_clip, 1),
            "highlight_clip_pct": round(highlight_clip, 1), "contrast_range_0_255": round(contrast, 1),
        })
        all_shadow.append(shadow_clip); all_highlight.append(highlight_clip); all_contrast.append(contrast)

    if not per_frame:
        return {"available": False, "reason": "no frames to sample"}

    return {
        "available": True,
        "avg_shadow_clip_pct": round(statistics.mean(all_shadow), 1),
        "avg_highlight_clip_pct": round(statistics.mean(all_highlight), 1),
        "avg_contrast_range_0_255": round(statistics.mean(all_contrast), 1),
        "per_frame": per_frame,
        "note": "clipping/contrast measured on the sparse sampled-frame set, not a full waveform/vectorscope "
                "trace of the whole timeline -- a brief clipped moment between samples can be missed. This is "
                "a luma-histogram proxy for exposure and (visual) dynamic range, not a calibrated light-meter "
                "or scope reading, and says nothing about *why* a frame is clipped (deliberate high-key/low-"
                "key look vs. an actual exposure mistake) -- weigh it against the actual frame.",
    }


def analyze_sharpness_noise(frame_manifest, output_dir, max_frames=20):
    """Focus/detail proxy per sampled frame via Laplacian variance -- a
    standard cheap blur metric: crisp edges produce a high-variance
    Laplacian response, a soft/out-of-focus or heavily-denoised image
    produces a low one. Not a real signal-to-noise-ratio measurement (that
    needs a clean reference signal to compare against, which a single frame
    doesn't provide) -- it's the closest local proxy available."""
    if not ensure_opencv():
        return {"available": False, "reason": "opencv unavailable"}
    import cv2

    candidates = [e for e in frame_manifest if e["tag"].startswith("interval_")][:max_frames]
    if not candidates:
        candidates = frame_manifest[:max_frames]

    per_frame, sharp_vals = [], []
    for entry in candidates:
        img = cv2.imread(os.path.join(output_dir, entry["file"]), cv2.IMREAD_GRAYSCALE)
        if img is None:
            continue
        lap_var = float(cv2.Laplacian(img, cv2.CV_64F).var())
        per_frame.append({"time": entry["time"], "sharpness_laplacian_var": round(lap_var, 1)})
        sharp_vals.append(lap_var)

    if not per_frame:
        return {"available": False, "reason": "no frames to sample"}

    return {
        "available": True,
        "avg_sharpness_laplacian_var": round(statistics.mean(sharp_vals), 1),
        "per_frame": per_frame,
        "read_guide": "rough feel only, varies hugely by content/resolution/detail level: under ~50 often "
                       "reads as soft/out-of-focus/heavily denoised, 50-300 is typical, 300+ is crisp/highly "
                       "detailed -- always sanity-check against the actual frame before calling something "
                       "soft or noisy, this is not a calibrated focus-pull or SNR measurement.",
    }


def analyze_compression_artifacts(frame_manifest, output_dir, max_frames=20):
    """Coarse blockiness estimate: DCT-block-based codecs (H.264/H.265/etc.)
    encode in 8x8-aligned blocks, and heavy compression tends to leave faint
    edges at those block boundaries. Compares mean horizontal-gradient
    energy at 8-pixel-aligned columns vs. non-aligned columns -- a
    meaningfully higher ratio suggests visible block-edge artifacting."""
    if not ensure_opencv():
        return {"available": False, "reason": "opencv unavailable"}
    import cv2
    import numpy as np

    candidates = [e for e in frame_manifest if e["tag"].startswith("interval_")][:max_frames]
    if not candidates:
        candidates = frame_manifest[:max_frames]

    ratios = []
    for entry in candidates:
        img = cv2.imread(os.path.join(output_dir, entry["file"]), cv2.IMREAD_GRAYSCALE)
        if img is None:
            continue
        img = img.astype(np.float32)
        gx = np.abs(np.diff(img, axis=1))
        h, w = gx.shape
        if w < 16:
            continue
        cols = np.arange(w)
        aligned = gx[:, (cols % 8 == 7)]
        other = gx[:, (cols % 8 != 7)]
        if aligned.size == 0 or other.size == 0:
            continue
        other_mean = float(np.mean(other)) or 1e-6
        ratios.append(float(np.mean(aligned)) / other_mean)

    if not ratios:
        return {"available": False, "reason": "no frames to sample"}

    return {
        "available": True,
        "avg_block_edge_ratio": round(statistics.mean(ratios), 3),
        "read_guide": "~1.0 means no detectable 8x8 block edges above the surrounding gradient (clean/high-"
                       "bitrate footage, or a compression scheme not aligned to 8px blocks); notably above "
                       "~1.15 suggests visible blocking from heavy compression.",
        "note": "a coarse gradient-ratio heuristic on the sparse sampled-frame set -- no ringing/mosquito-"
                "noise detection, no bitrate-ladder awareness, and it can't tell deliberate stylized noise/"
                "grain from real compression damage. Treat as a rough hint, and confirm against the actual "
                "frames before reporting visible blocking.",
    }


def analyze_composition(frame_manifest, output_dir, max_frames=20):
    """Coarse rule-of-thirds proxy: finds each frame's main point of visual
    interest (the detected face center when one exists, otherwise the
    centroid of strong edge energy) and measures how close it falls to a
    rule-of-thirds intersection vs. dead-center. This is NOT real
    composition analysis (no leading-lines, headroom, or framing-intent
    understanding) -- it's a cheap geometric heuristic to flag likely
    centered/flat framing vs. off-center/thirds-leaning framing for
    whoever writes the report to verify against the actual frame."""
    if not ensure_opencv():
        return {"available": False, "reason": "opencv unavailable"}
    import cv2
    import numpy as np

    candidates = [e for e in frame_manifest if e["tag"].startswith("interval_")][:max_frames]
    if not candidates:
        candidates = frame_manifest[:max_frames]

    per_frame = []
    for entry in candidates:
        img = cv2.imread(os.path.join(output_dir, entry["file"]), cv2.IMREAD_GRAYSCALE)
        if img is None:
            continue
        h, w = img.shape
        cx = cy = source = None
        face_center = entry.get("largest_face_center_pct")
        if face_center:
            cx, cy = face_center[0] / 100.0 * w, face_center[1] / 100.0 * h
            source = "face_center"
        else:
            gx = cv2.Sobel(img, cv2.CV_32F, 1, 0, ksize=3)
            gy = cv2.Sobel(img, cv2.CV_32F, 0, 1, ksize=3)
            mag = np.hypot(gx, gy)
            total = float(mag.sum())
            if total < 1e-3:
                continue
            yy, xx = np.mgrid[0:h, 0:w]
            cx, cy = float((xx * mag).sum() / total), float((yy * mag).sum() / total)
            source = "edge_energy_centroid"

        thirds_x, thirds_y = (w / 3, 2 * w / 3), (h / 3, 2 * h / 3)
        nearest_thirds_dist = min(math.hypot(cx - tx, cy - ty) for tx in thirds_x for ty in thirds_y)
        center_dist = math.hypot(cx - w / 2, cy - h / 2)
        diag = math.hypot(w, h)
        per_frame.append({
            "time": entry["time"],
            "interest_point_source": source,
            "interest_point_pct": [round(100 * cx / w, 1), round(100 * cy / h, 1)],
            "dist_to_nearest_thirds_intersection_pct_of_diagonal": round(100 * nearest_thirds_dist / diag, 1),
            "dist_to_center_pct_of_diagonal": round(100 * center_dist / diag, 1),
        })

    if not per_frame:
        return {"available": False, "reason": "no frames to sample"}

    thirds_leaning = sum(
        1 for f in per_frame
        if f["dist_to_nearest_thirds_intersection_pct_of_diagonal"] < f["dist_to_center_pct_of_diagonal"]
    )
    return {
        "available": True,
        "per_frame": per_frame,
        "pct_frames_closer_to_thirds_than_center": round(100 * thirds_leaning / len(per_frame), 1),
        "note": "a geometric proxy only -- 'interest point' is the detected face center when available, "
                "otherwise the centroid of strong edge energy, which can land on background clutter rather "
                "than the real subject on busy/textured or faceless (product/landscape) shots. Says nothing "
                "about headroom, leading lines, or framing intent. Not a substitute for actually looking at "
                "the frame's composition.",
    }


def analyze_cut_similarity(cuts, frame_manifest, output_dir):
    """For each cut with extracted before/after frames, a coarse 'how much
    did the whole scene change' read via color-histogram correlation --
    high correlation is consistent with a same-scene/same-subject cut
    (jump-cut-like), low correlation with a full scene/location change
    (cutaway/hard-scene-cut-like). Mutates `cuts` in place, adding a
    `scene_similarity` sub-object to entries where both frames exist. This
    does NOT identify true editing grammar (jump cut vs. match cut vs.
    cutaway needs subject/continuity understanding, not pixel statistics)
    -- it's a numeric hint to weigh against the actual frames."""
    if not ensure_opencv():
        return
    import cv2

    by_time = {}
    for f in frame_manifest:
        m = re.match(r"cut_([\d.]+)s_(before|after)", f["tag"])
        if m:
            by_time.setdefault(round(float(m.group(1)), 2), {})[m.group(2)] = f["file"]

    for c in cuts:
        pair = by_time.get(round(c["time"], 2))
        if not pair or "before" not in pair or "after" not in pair:
            continue
        img_a = cv2.imread(os.path.join(output_dir, pair["before"]))
        img_b = cv2.imread(os.path.join(output_dir, pair["after"]))
        if img_a is None or img_b is None:
            continue
        hist_a = cv2.calcHist([img_a], [0, 1, 2], None, [8, 8, 8], [0, 256, 0, 256, 0, 256])
        hist_b = cv2.calcHist([img_b], [0, 1, 2], None, [8, 8, 8], [0, 256, 0, 256, 0, 256])
        cv2.normalize(hist_a, hist_a)
        cv2.normalize(hist_b, hist_b)
        corr = float(cv2.compareHist(hist_a, hist_b, cv2.HISTCMP_CORREL))
        c["scene_similarity"] = {
            "color_histogram_correlation": round(corr, 3),
            "likely_read": (
                "same-scene continuation (jump-cut-like, small change)" if corr > 0.75 else
                "different scene/location (full cut/cutaway-like)" if corr < 0.35 else
                "ambiguous"
            ),
            "note": "color-histogram correlation between the before/after frames is a coarse pixel-statistics "
                    "proxy, not real shot/scene understanding -- a same-location cut under different lighting "
                    "can read as low, and two different-but-similarly-colored scenes can read as high. Verify "
                    "against the actual frames before calling something a jump cut vs. a scene change.",
        }


def summarize_av_sync_drift(cuts):
    """Aggregates the per-cut `edit_offset` audio-jump-vs-video-cut readings
    into a whole-file signal, distinct from any single cut's J-cut/L-cut
    call: a consistent nonzero offset with LOW spread across many cuts
    suggests a systematic mux/sync problem (audio and video genuinely out
    of sync throughout the file), whereas a high spread with offsets
    scattered in both directions is what normal editorial J-cuts/L-cuts
    look like in aggregate (a deliberate technique, not a sync bug)."""
    offsets = [
        c["edit_offset"]["detail"]["audio_jump_offset_from_cut_sec"]
        for c in cuts
        if c.get("edit_offset", {}).get("type") in ("aligned_cut", "j_cut_candidate", "l_cut_candidate")
        and c["edit_offset"].get("detail", {}).get("audio_jump_offset_from_cut_sec") is not None
    ]
    if len(offsets) < 3:
        return {"available": False, "reason": "too few classified cuts with a usable audio-offset reading"}
    mean_offset = statistics.mean(offsets)
    stdev_offset = statistics.pstdev(offsets) if len(offsets) > 1 else 0.0
    return {
        "available": True,
        "num_cuts_sampled": len(offsets),
        "mean_offset_sec": round(mean_offset, 3),
        "stdev_offset_sec": round(stdev_offset, 3),
        "likely_systematic_av_drift": abs(mean_offset) > 0.08 and stdev_offset < 0.06,
        "note": "derived from the same coarse RMS-jump heuristic as each cut's `edit_offset` (see "
                "references/metrics.md), so treat it accordingly -- not a frame-accurate sync measurement. "
                "`likely_systematic_av_drift: true` (consistent offset, low spread) points at a real mux/"
                "encode sync bug; a high spread with offsets in both directions is normal editorial J-cut/"
                "L-cut usage, not a drift problem -- don't conflate the two.",
    }


def build_timeline_html(report_data, outdir):
    """A self-contained, dependency-free HTML/SVG timeline of the whole
    analysis (shots, motion, loudness, brightness, beats, transcript) so the
    user has a visual artifact to look at, not just JSON. No network calls,
    no JS framework -- opens directly in any browser."""
    duration = report_data["metadata"]["duration_sec"] or 1.0
    W, H = 1200, 46
    rows = []

    def x(t):
        return round((t / duration) * W, 1)

    def path_from_curve(curve, key, lo, hi, height, invert=False):
        pts = []
        for p in curve:
            v = p.get(key)
            if v is None:
                continue
            frac = (v - lo) / (hi - lo) if hi > lo else 0
            frac = min(max(frac, 0.0), 1.0)
            y = height - frac * height if not invert else frac * height
            pts.append(f"{x(p['time'])},{round(y, 1)}")
        return "polyline points='" + " ".join(pts) + "'" if pts else None

    # shots row (alternating shading + cut ticks)
    cut_times = [c["time"] for c in report_data["cuts"]]
    bounds = [0.0] + cut_times + [duration]
    shot_rects = "".join(
        f"<rect x='{x(a)}' y='0' width='{max(x(b) - x(a), 0.5)}' height='{H}' "
        f"class='{'shot-a' if i % 2 == 0 else 'shot-b'}'><title>shot {i+1}: {a:.2f}s - {b:.2f}s "
        f"({b-a:.2f}s)</title></rect>"
        for i, (a, b) in enumerate(zip(bounds, bounds[1:]))
    )
    cut_ticks = "".join(
        f"<line x1='{x(t)}' x2='{x(t)}' y1='0' y2='{H}' class='cut-tick'><title>cut at {t:.2f}s</title></line>"
        for t in cut_times
    )
    rows.append(("Shots / cuts", f"<g>{shot_rects}{cut_ticks}</g>", H))

    motion = report_data.get("motion_curve") or []
    if motion:
        p = path_from_curve(motion, "motion", 0, 100, H)
        rows.append(("Motion", f"<{p} class='line-motion' fill='none'/>" if p else "", H))

    loud = [p for p in report_data.get("loudness_curve", []) if p.get("rms_db") is not None]
    if loud:
        p = path_from_curve(loud, "rms_db", -60, 0, H)
        rows.append(("Loudness (dB)", f"<{p} class='line-loud' fill='none'/>" if p else "", H))
        spikes = "".join(
            f"<circle cx='{x(s['time'])}' cy='4' r='3' class='spike'>"
            f"<title>possible SFX at {s['time']:.2f}s (+{s['jump_from_local_median_db']}dB)</title></circle>"
            for s in report_data.get("loudness_spikes_candidate_sfx", [])
        )
        rows.append(("SFX candidates", f"<g>{spikes}</g>", 12))

    bright = report_data.get("brightness_curve") or []
    if bright:
        p = path_from_curve(bright, "luma_mean", 0, 255, H)
        rows.append(("Brightness", f"<{p} class='line-bright' fill='none'/>" if p else "", H))

    palette = report_data.get("color_palette", {})
    if palette.get("available"):
        sw_w = W / max(1, len(palette["overall_palette"]))
        swatches = "".join(
            f"<rect x='{round(i*sw_w,1)}' y='0' width='{round(sw_w,1)}' height='16' fill='{c['hex']}'>"
            f"<title>{c['hex']} ({c['pct']}% of sampled pixels)</title></rect>"
            for i, c in enumerate(palette["overall_palette"])
        )
        rows.append(("Color palette", f"<g>{swatches}</g>", 16))

    beats = report_data.get("beat_analysis", {})
    if beats.get("available"):
        ticks = "".join(
            f"<line x1='{x(t)}' x2='{x(t)}' y1='0' y2='10' class='beat-tick'/>"
            for t in beats.get("beat_times", [])
        )
        rows.append((f"Beat grid ({beats['tempo_bpm']:.0f} BPM)", f"<g>{ticks}</g>", 12))

    transcript = report_data.get("transcript", {})
    if transcript.get("available"):
        segs = "".join(
            f"<rect x='{x(s['start'])}' y='0' width='{max(x(s['end']) - x(s['start']), 1)}' "
            f"height='16' class='transcript-seg'><title>{s['text'][:180]}</title></rect>"
            for s in transcript.get("segments", [])
        )
        rows.append(("Voice-over", f"<g>{segs}</g>", 16))

    n_axis_ticks = 10
    axis_ticks = "".join(
        f"<text x='{x(i * duration / n_axis_ticks)}' y='12' class='axis-label'>"
        f"{int(i * duration / n_axis_ticks) // 60:02d}:{int(i * duration / n_axis_ticks) % 60:02d}</text>"
        for i in range(n_axis_ticks + 1)
    )
    rows.append(("Time", f"<g>{axis_ticks}</g>", 16))

    y_cursor = 0
    row_svgs = []
    for label, content, h in rows:
        row_svgs.append(
            f"<g transform='translate(0,{y_cursor})'>"
            f"<text x='-8' y='{h/2+4}' text-anchor='end' class='row-label'>{label}</text>"
            f"<g transform='translate(140,0)'>{content}</g>"
            f"</g>"
        )
        y_cursor += h + 6
    total_h = y_cursor

    src_name = report_data["metadata"].get("filename", "video")
    dur_s = f"{int(duration // 60)}:{int(duration % 60):02d}"
    html = f"""<title>watchutube timeline: {src_name}</title>
<style>
  :root {{ --bg:#ffffff; --fg:#1a1a1a; --muted:#6b7280; --grid:#e5e7eb;
           --shot-a:#f3f4f6; --shot-b:#e5e7eb; --cut:#dc2626;
           --motion:#8b5cf6; --loud:#f59e0b; --bright:#0ea5e9;
           --spike:#dc2626; --beat:#10b981; --vo:#3b82f6; }}
  @media (prefers-color-scheme: dark) {{
    :root {{ --bg:#111318; --fg:#e5e7eb; --muted:#9ca3af; --grid:#2a2e37;
             --shot-a:#1a1d24; --shot-b:#20242c; --cut:#f87171;
             --motion:#a78bfa; --loud:#fbbf24; --bright:#38bdf8;
             --spike:#f87171; --beat:#34d399; --vo:#60a5fa; }}
  }}
  body {{ background:var(--bg); color:var(--fg); font-family:-apple-system,Segoe UI,Roboto,sans-serif;
          margin:0; padding:24px; }}
  h1 {{ font-size:16px; margin:0 0 2px; }}
  .meta {{ color:var(--muted); font-size:13px; margin-bottom:20px; }}
  svg {{ overflow:visible; }}
  .row-label {{ fill:var(--muted); font-size:11px; }}
  .axis-label {{ fill:var(--muted); font-size:10px; }}
  .shot-a {{ fill:var(--shot-a); }}
  .shot-b {{ fill:var(--shot-b); }}
  .cut-tick {{ stroke:var(--cut); stroke-width:1.5; }}
  .beat-tick {{ stroke:var(--beat); stroke-width:1; opacity:0.8; }}
  .spike {{ fill:var(--spike); }}
  .transcript-seg {{ fill:var(--vo); opacity:0.55; }}
  .line-motion {{ stroke:var(--motion); stroke-width:1.5; }}
  .line-loud {{ stroke:var(--loud); stroke-width:1.5; }}
  .line-bright {{ stroke:var(--bright); stroke-width:1.5; }}
  .wrap {{ overflow-x:auto; }}
  .legend {{ display:flex; gap:16px; flex-wrap:wrap; margin-top:16px; font-size:12px; color:var(--muted); }}
  .legend span {{ display:inline-flex; align-items:center; gap:5px; }}
  .swatch {{ width:10px; height:10px; border-radius:2px; display:inline-block; }}
</style>
<h1>watchutube timeline</h1>
<div class="meta">{src_name} &middot; {dur_s} &middot; {report_data['metadata']['video']['width'] if report_data['metadata'].get('video') else '?'}x{report_data['metadata']['video']['height'] if report_data['metadata'].get('video') else '?'} &middot; {report_data['pacing']['num_cuts']} cuts &middot; {report_data['pacing']['cuts_per_minute']} cuts/min</div>
<div class="wrap">
<svg width="{W + 140}" height="{total_h}" viewBox="0 0 {W + 140} {total_h}">
{''.join(row_svgs)}
</svg>
</div>
<div class="legend">
  <span><span class="swatch" style="background:var(--motion)"></span>motion</span>
  <span><span class="swatch" style="background:var(--loud)"></span>loudness</span>
  <span><span class="swatch" style="background:var(--bright)"></span>brightness</span>
  <span><span class="swatch" style="background:var(--cut)"></span>cut</span>
  <span><span class="swatch" style="background:var(--spike)"></span>SFX candidate</span>
  <span><span class="swatch" style="background:var(--beat)"></span>beat</span>
  <span><span class="swatch" style="background:var(--vo)"></span>voice-over</span>
</div>
"""
    out_path = os.path.join(outdir, "timeline.html")
    with open(out_path, "w") as f:
        f.write(html)
    return out_path


def main():
    ap = argparse.ArgumentParser(description="Deep video analysis engine for the watchutube skill")
    ap.add_argument("source", help="Local video file path or a video URL")
    ap.add_argument("--outdir", default=None, help="Output directory (default: ./watchutube_analysis_<name>)")
    ap.add_argument("--skip-transcription", action="store_true")
    ap.add_argument("--whisper-model", default="base", choices=["tiny", "base", "small", "medium"])
    ap.add_argument("--max-frames", type=int, default=36)
    ap.add_argument("--cut-threshold", type=float, default=0.28)
    ap.add_argument("--max-download-height", type=int, default=1080)
    ap.add_argument("--max-classified-cuts", type=int, default=40,
                     help="Cap on how many cuts get full frame-diff transition classification")
    ap.add_argument("--skip-advanced", action="store_true",
                     help="Skip transition classification, motion curve, face detection, OCR, beat "
                          "detection, and the HTML timeline -- just the original core metrics, fast")
    ap.add_argument("--skip-ocr", action="store_true", help="Skip on-screen text detection")
    ap.add_argument("--skip-faces", action="store_true", help="Skip face-presence/shot-framing detection")
    ap.add_argument("--skip-beat-detection", action="store_true", help="Skip music tempo/beat analysis")
    ap.add_argument("--skip-timeline", action="store_true", help="Skip generating timeline.html")
    ap.add_argument("--skip-color", action="store_true", help="Skip color-palette/grading analysis")
    ap.add_argument("--skip-camera-movement", action="store_true",
                     help="Skip per-shot camera-movement classification (optical flow)")
    ap.add_argument("--skip-edit-offset", action="store_true",
                     help="Skip J-cut/L-cut (audio/video edit offset) detection per cut")
    ap.add_argument("--max-classified-shots", type=int, default=24,
                     help="Cap on how many shots get camera-movement classification")
    ap.add_argument("--skip-platform-metadata", action="store_true",
                     help="Skip fetching public platform metadata (views/likes/etc.) for a URL source")
    ap.add_argument("--skip-frame-rate-check", action="store_true",
                     help="Skip the per-frame-timestamp frame-rate-consistency/dropped-frame check")
    ap.add_argument("--skip-exposure", action="store_true", help="Skip exposure/dynamic-range analysis")
    ap.add_argument("--skip-sharpness", action="store_true", help="Skip focus/sharpness (blur) analysis")
    ap.add_argument("--skip-compression-check", action="store_true",
                     help="Skip the coarse compression-blockiness heuristic")
    ap.add_argument("--skip-composition", action="store_true",
                     help="Skip the rule-of-thirds composition-proxy analysis")
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

    platform_metadata = {"available": False, "reason": "skipped"}
    if not args.skip_platform_metadata:
        info("Fetching public platform metadata (if URL source)...")
        platform_metadata = get_source_platform_metadata(args.source)

    frame_rate_consistency = {"available": False, "reason": "skipped"}
    if not args.skip_frame_rate_check:
        info("Checking frame-rate consistency (per-frame timestamps)...")
        frame_rate_consistency = check_frame_rate_consistency(local_path)

    info("Detecting hard cuts (scene-score spikes)...")
    cuts = detect_cuts(local_path, duration, threshold=args.cut_threshold)

    if not args.skip_advanced:
        info("Scanning for gradual transitions (fades/dissolves scene-score can't see)...")
        soft = detect_soft_transitions(local_path, duration)
        cuts = merge_cut_candidates(cuts, soft)

    info("Detecting silence...")
    silence = detect_silence(local_path) if has_audio else []

    info("Detecting black frames...")
    black = detect_black(local_path)

    info("Detecting freeze frames...")
    freeze = detect_freeze(local_path)

    info("Building loudness curve...")
    loudness = loudness_curve(local_path, has_audio)
    spikes = find_loudness_spikes(loudness) if loudness else []

    info("Measuring integrated loudness (LUFS)...")
    loudness_lufs = measure_loudness_lufs(local_path, has_audio)

    info("Building brightness curve...")
    brightness = brightness_curve(local_path)

    pacing = compute_pacing(cuts, duration)

    chosen_cuts = select_cuts_subset(cuts, max(4, args.max_frames // 3))
    info("Extracting representative frames for visual inspection...")
    frame_manifest = extract_frames(local_path, chosen_cuts, duration, frames_dir, max_frames=args.max_frames)

    transcript = transcribe(
        local_path, has_audio, outdir,
        model_size=args.whisper_model, skip=args.skip_transcription,
    )

    motion = []
    faces_summary = None
    shot_type_summary = None
    ocr = {"available": False, "reason": "skipped"}
    beats = {"available": False, "reason": "skipped"}
    color_palette = {"available": False, "reason": "skipped"}
    camera_movement = []
    av_sync_drift = {"available": False, "reason": "skipped"}
    exposure = {"available": False, "reason": "skipped"}
    sharpness_noise = {"available": False, "reason": "skipped"}
    compression_artifacts = {"available": False, "reason": "skipped"}
    composition = {"available": False, "reason": "skipped"}
    timeline_path = None

    if not args.skip_advanced:
        info("Classifying transitions per cut (frame-diff burst analysis)...")
        classify_cuts = select_cuts_subset(cuts, args.max_classified_cuts)
        classified_times = {c["time"] for c in classify_cuts}
        for c in cuts:
            if c["time"] in classified_times:
                c["transition"] = classify_transition(local_path, c["time"], outdir)

        info("Estimating before/after scene similarity per cut (jump-cut vs. scene-change hint)...")
        analyze_cut_similarity(cuts, frame_manifest, outdir)

        if not args.skip_edit_offset and has_audio:
            info("Checking audio/video edit offset per cut (J-cut/L-cut candidates)...")
            for c in cuts:
                if c["time"] in classified_times:
                    c["edit_offset"] = detect_edit_offset(local_path, c["time"], outdir)
            info("Summarizing whole-file audio/video sync drift...")
            av_sync_drift = summarize_av_sync_drift(cuts)

        info("Building motion/energy curve...")
        motion = motion_curve(local_path, duration)

        if not args.skip_camera_movement:
            info("Classifying camera movement per shot (optical flow)...")
            camera_movement = detect_camera_movement(
                local_path, cuts, duration, max_shots=args.max_classified_shots,
            )

        if not args.skip_faces:
            info("Detecting faces in sampled frames...")
            frame_manifest = detect_faces_in_frames(frame_manifest, outdir)
            with_face = [f for f in frame_manifest if f.get("faces", 0) > 0]
            pct_with_face = round(100 * len(with_face) / len(frame_manifest), 1) if frame_manifest else None
            faces_summary = {
                "frames_with_face": len(with_face),
                "frames_checked": len(frame_manifest),
                "pct_frames_with_face": pct_with_face,
                "style_guess": (
                    None if pct_with_face is None else
                    "talking-head-heavy" if pct_with_face >= 60 else
                    "b-roll/abstract-heavy" if pct_with_face <= 20 else
                    "mixed"
                ),
                "note": "style_guess is a coarse label from the sampled-frame face-presence percentage, not "
                        "a scene-by-scene breakdown of talking-head vs. b-roll segments.",
            }
            shot_types = [f["shot_type_guess"] for f in with_face if f.get("shot_type_guess")]
            if shot_types:
                shot_type_summary = {t: shot_types.count(t) for t in ("close-up", "medium", "wide")}

        if not args.skip_composition:
            info("Estimating composition / rule-of-thirds proxy...")
            composition = analyze_composition(frame_manifest, outdir)

        if not args.skip_ocr:
            info("Running OCR on sampled frames for on-screen text...")
            ocr = ocr_frames(frame_manifest, outdir)

        if not args.skip_beat_detection:
            info("Analyzing music tempo/beat grid...")
            beats = beat_analysis(local_path, outdir, cuts, has_audio)

        if not args.skip_color:
            info("Extracting color palette / grading signature...")
            color_palette = analyze_color_palette(frame_manifest, outdir)

        if not args.skip_exposure:
            info("Analyzing exposure / dynamic range...")
            exposure = analyze_exposure(frame_manifest, outdir)

        if not args.skip_sharpness:
            info("Analyzing focus/sharpness...")
            sharpness_noise = analyze_sharpness_noise(frame_manifest, outdir)

        if not args.skip_compression_check:
            info("Estimating compression-artifact/blockiness signal...")
            compression_artifacts = analyze_compression_artifacts(frame_manifest, outdir)

    elapsed = round(time.time() - t0, 1)

    report_data = {
        "source": args.source,
        "local_path": local_path,
        "metadata": metadata,
        "platform_metadata": platform_metadata,
        "frame_rate_consistency": frame_rate_consistency,
        "cuts": cuts,
        "pacing": pacing,
        "silence": silence,
        "black_frames": black,
        "freeze_frames": freeze,
        "loudness_curve": loudness,
        "loudness_spikes_candidate_sfx": spikes,
        "loudness_lufs": loudness_lufs,
        "av_sync_drift_summary": av_sync_drift,
        "brightness_curve": brightness,
        "exposure": exposure,
        "sharpness_noise": sharpness_noise,
        "compression_artifacts": compression_artifacts,
        "motion_curve": motion,
        "camera_movement": camera_movement,
        "composition": composition,
        "faces_summary": faces_summary,
        "shot_type_summary": shot_type_summary,
        "on_screen_text": ocr,
        "beat_analysis": beats,
        "color_palette": color_palette,
        "transcript": transcript,
        "frames": frame_manifest,
        "analysis_time_sec": elapsed,
        "warnings": WARNINGS,
    }

    if not args.skip_advanced and not args.skip_timeline:
        try:
            timeline_path = build_timeline_html(report_data, outdir)
        except Exception as e:
            warn(f"timeline.html generation failed: {e}")
            report_data["warnings"] = WARNINGS

    manifest_path = os.path.join(outdir, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(report_data, f, indent=2)

    print(json.dumps({
        "ok": True,
        "outdir": outdir,
        "manifest": manifest_path,
        "frames_dir": frames_dir,
        "timeline_html": timeline_path,
        "num_frames": len(frame_manifest),
        "num_cuts": len(cuts),
        "duration_sec": duration,
        "transcript_available": transcript.get("available", False),
        "beat_analysis_available": beats.get("available", False),
        "on_screen_text_available": ocr.get("available", False),
        "color_palette_available": color_palette.get("available", False),
        "loudness_lufs_available": loudness_lufs.get("available", False),
        "num_shots_camera_classified": len(camera_movement),
        "platform_metadata_available": platform_metadata.get("available", False),
        "frame_rate_consistency_available": frame_rate_consistency.get("available", False),
        "exposure_available": exposure.get("available", False),
        "sharpness_available": sharpness_noise.get("available", False),
        "compression_check_available": compression_artifacts.get("available", False),
        "composition_available": composition.get("available", False),
        "av_sync_drift_available": av_sync_drift.get("available", False),
        "warnings": WARNINGS,
        "elapsed_sec": elapsed,
    }))


if __name__ == "__main__":
    main()
