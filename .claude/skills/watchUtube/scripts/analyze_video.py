#!/usr/bin/env python3
"""
analyze_video.py — offline video analysis engine for the watchUtube skill.

Given a local video FILE, it produces everything Claude needs to "watch" and
deeply analyse the video:

  * technical metadata           (ffprobe -> metadata.json)
  * shot / scene-cut detection   (ffmpeg scene score -> cuts.json + pacing stats)
  * representative cut frames     (one full-res frame at each detected cut)
  * uniform timeline frames       (a frame every N seconds, for even coverage)
  * contact-sheet montages        (tiled low-res grids: the whole video at a glance)
  * audio loudness + dynamics     (EBU R128 integrated/range, peak)
  * silence / speech-gap map      (silencedetect -> pauses, used for pacing/VO)
  * an analysis.json summary       (all numbers rolled up, ready to cite)

It does NOT download anything and needs no network — run ingest.sh first if the
source is a URL. Everything is written under an output directory you choose.

Usage:
    python3 analyze_video.py INPUT.mp4 --out OUTDIR [options]

Options:
    --scene-threshold FLOAT   scene-change sensitivity 0..1 (default 0.30;
                              lower = more cuts detected)
    --interval SECONDS        uniform frame sampling period (default 3)
    --max-cut-frames N        cap on saved cut frames (default 120)
    --montage-cols N          tiles per row in contact sheets (default 5)
    --montage-rows N          rows per contact sheet (default 6)
    --frame-width PX          width of saved full-res frames (default 960)
    --quiet                   less logging

Requires: ffmpeg, ffprobe on PATH. Python 3.8+.
"""
import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


def log(msg, quiet=False):
    if not quiet:
        print(f"[analyze] {msg}", file=sys.stderr, flush=True)


def die(msg, code=1):
    print(f"[analyze] ERROR: {msg}", file=sys.stderr, flush=True)
    sys.exit(code)


def run(cmd, **kw):
    """Run a command, capturing stderr (ffmpeg logs go to stderr)."""
    return subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, **kw
    )


def require_tools():
    for t in ("ffmpeg", "ffprobe"):
        if shutil.which(t) is None:
            die(f"'{t}' not found on PATH. Install ffmpeg first.")


def ffprobe_metadata(inp, outdir, quiet):
    log("probing metadata (ffprobe)…", quiet)
    r = run([
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams", str(inp)
    ])
    if r.returncode != 0 or not r.stdout.strip():
        die(f"ffprobe failed: {r.stderr.strip()[:400]}")
    data = json.loads(r.stdout)
    (outdir / "metadata.json").write_text(json.dumps(data, indent=2))

    fmt = data.get("format", {})
    v = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
    a = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), {})

    def num(x, d=0.0):
        try:
            return float(x)
        except (TypeError, ValueError):
            return d

    # frame rate can be "30000/1001"
    fps = 0.0
    rate = v.get("avg_frame_rate") or v.get("r_frame_rate") or "0/0"
    if "/" in rate:
        n, d = rate.split("/")
        fps = num(n) / num(d) if num(d) else 0.0

    summary = {
        "filename": os.path.basename(str(inp)),
        "duration_sec": round(num(fmt.get("duration")), 3),
        "size_bytes": int(num(fmt.get("size"))),
        "bit_rate_kbps": round(num(fmt.get("bit_rate")) / 1000, 1),
        "container": fmt.get("format_name"),
        "video": {
            "codec": v.get("codec_name"),
            "width": v.get("width"),
            "height": v.get("height"),
            "fps": round(fps, 3),
            "pix_fmt": v.get("pix_fmt"),
        },
        "audio": {
            "codec": a.get("codec_name"),
            "sample_rate": a.get("sample_rate"),
            "channels": a.get("channels"),
            "channel_layout": a.get("channel_layout"),
        } if a else None,
    }
    return summary


def detect_cuts(inp, outdir, threshold, max_frames, frame_width, quiet):
    """Detect scene cuts and save one full-res frame at each cut."""
    log(f"detecting scene cuts (threshold={threshold})…", quiet)
    frames_dir = outdir / "frames" / "cuts"
    frames_dir.mkdir(parents=True, exist_ok=True)

    # Pass 1: get cut timestamps via showinfo on selected scene-change frames.
    # We parse pts_time from the showinfo log.
    vf = f"select='gt(scene,{threshold})',showinfo"
    r = run(["ffmpeg", "-hide_banner", "-i", str(inp),
             "-vf", vf, "-vsync", "vfr", "-f", "null", "-"])
    times = []
    for m in re.finditer(r"pts_time:([0-9.]+)", r.stderr):
        times.append(round(float(m.group(1)), 3))
    times = sorted(set(times))

    # Cap the number of frames we actually save (keep them spread across the video).
    saved_times = times
    if len(times) > max_frames:
        step = len(times) / max_frames
        saved_times = [times[int(i * step)] for i in range(max_frames)]

    # Pass 2: save a frame at each saved cut timestamp (accurate seek).
    saved = []
    for i, t in enumerate(saved_times):
        out = frames_dir / f"cut_{i:04d}_t{t:08.2f}.jpg"
        rr = run(["ffmpeg", "-hide_banner", "-ss", f"{t}", "-i", str(inp),
                  "-frames:v", "1", "-vf", f"scale={frame_width}:-2",
                  "-q:v", "3", "-y", str(out)])
        if rr.returncode == 0 and out.exists():
            saved.append({"index": i, "time_sec": t, "file": str(out.relative_to(outdir))})

    (outdir / "cuts.json").write_text(json.dumps({
        "scene_threshold": threshold,
        "cut_count": len(times),
        "cut_times_sec": times,
        "saved_frames": saved,
    }, indent=2))
    log(f"  {len(times)} cuts detected, {len(saved)} frames saved", quiet)
    return times


def uniform_frames(inp, outdir, interval, frame_width, quiet):
    log(f"sampling uniform frames every {interval}s…", quiet)
    d = outdir / "frames" / "timeline"
    d.mkdir(parents=True, exist_ok=True)
    r = run(["ffmpeg", "-hide_banner", "-i", str(inp),
             "-vf", f"fps=1/{interval},scale={frame_width}:-2",
             "-q:v", "3", "-y", str(d / "t_%04d.jpg")])
    n = len(list(d.glob("*.jpg")))
    log(f"  {n} timeline frames", quiet)
    return n


def contact_sheets(inp, outdir, cols, rows, interval, quiet):
    """Tiled low-res montages: the whole video at a glance for Claude's vision."""
    log("building contact-sheet montages…", quiet)
    d = outdir / "frames" / "montage"
    d.mkdir(parents=True, exist_ok=True)
    per = cols * rows
    # One tile every `interval` seconds, tiled cols x rows per sheet.
    vf = f"fps=1/{interval},scale=320:-2,tile={cols}x{rows}"
    r = run(["ffmpeg", "-hide_banner", "-i", str(inp),
             "-vf", vf, "-q:v", "4", "-y", str(d / "sheet_%03d.jpg")])
    sheets = sorted(d.glob("*.jpg"))
    log(f"  {len(sheets)} contact sheet(s) ({cols}x{rows} tiles, 1 tile/{interval}s)", quiet)
    return [str(s.relative_to(outdir)) for s in sheets]


def loudness(inp, outdir, quiet):
    log("measuring loudness (EBU R128)…", quiet)
    r = run(["ffmpeg", "-hide_banner", "-i", str(inp),
             "-filter_complex", "ebur128=peak=true", "-f", "null", "-"])
    txt = r.stderr
    (outdir / "loudness.log").write_text(txt)

    def grab(pat):
        m = re.findall(pat, txt)
        return m[-1] if m else None

    return {
        "integrated_LUFS": grab(r"I:\s*(-?[0-9.]+)\s*LUFS"),
        "loudness_range_LU": grab(r"LRA:\s*(-?[0-9.]+)\s*LU"),
        "true_peak_dBFS": grab(r"Peak:\s*(-?[0-9.]+)\s*dBFS"),
    }


def silences(inp, outdir, quiet, noise_db=-30, min_dur=0.4):
    log("mapping silences / speech gaps…", quiet)
    r = run(["ffmpeg", "-hide_banner", "-i", str(inp),
             "-af", f"silencedetect=noise={noise_db}dB:d={min_dur}",
             "-f", "null", "-"])
    txt = r.stderr
    starts = [float(x) for x in re.findall(r"silence_start:\s*(-?[0-9.]+)", txt)]
    ends = [float(x) for x in re.findall(r"silence_end:\s*(-?[0-9.]+)", txt)]
    durs = [float(x) for x in re.findall(r"silence_duration:\s*([0-9.]+)", txt)]
    return {
        "noise_floor_dB": noise_db,
        "min_silence_sec": min_dur,
        "silence_count": len(durs),
        "total_silence_sec": round(sum(durs), 2),
        "longest_silence_sec": round(max(durs), 2) if durs else 0,
        "gaps": [{"start": round(s, 2), "end": round(e, 2)}
                 for s, e in zip(starts, ends)][:200],
    }


def pacing_stats(cut_times, duration):
    if duration <= 0:
        return {}
    intervals = [round(b - a, 3) for a, b in zip(cut_times, cut_times[1:])]
    cuts_per_min = round(len(cut_times) / (duration / 60), 2) if duration else 0
    avg = round(sum(intervals) / len(intervals), 3) if intervals else None
    # rough tempo buckets
    fast = sum(1 for i in intervals if i < 2)
    med = sum(1 for i in intervals if 2 <= i < 5)
    slow = sum(1 for i in intervals if i >= 5)
    return {
        "total_cuts": len(cut_times),
        "cuts_per_minute": cuts_per_min,
        "avg_shot_length_sec": avg,
        "min_shot_length_sec": round(min(intervals), 3) if intervals else None,
        "max_shot_length_sec": round(max(intervals), 3) if intervals else None,
        "shots_under_2s": fast,
        "shots_2_to_5s": med,
        "shots_over_5s": slow,
    }


def main():
    ap = argparse.ArgumentParser(description="Offline video analysis engine.")
    ap.add_argument("input")
    ap.add_argument("--out", required=True)
    ap.add_argument("--scene-threshold", type=float, default=0.30)
    ap.add_argument("--interval", type=float, default=3.0)
    ap.add_argument("--max-cut-frames", type=int, default=120)
    ap.add_argument("--montage-cols", type=int, default=5)
    ap.add_argument("--montage-rows", type=int, default=6)
    ap.add_argument("--frame-width", type=int, default=960)
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    require_tools()
    inp = Path(args.input)
    if not inp.exists():
        die(f"input not found: {inp}")
    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    q = args.quiet

    meta = ffprobe_metadata(inp, outdir, q)
    duration = meta.get("duration_sec", 0) or 0

    cut_times = detect_cuts(inp, outdir, args.scene_threshold,
                            args.max_cut_frames, args.frame_width, q)
    uniform_frames(inp, outdir, args.interval, args.frame_width, q)
    sheets = contact_sheets(inp, outdir, args.montage_cols, args.montage_rows,
                            args.interval, q)

    has_audio = meta.get("audio") is not None
    loud = loudness(inp, outdir, q) if has_audio else None
    sil = silences(inp, outdir, q) if has_audio else None

    analysis = {
        "source": str(inp),
        "metadata": meta,
        "pacing": pacing_stats(cut_times, duration),
        "loudness": loud,
        "silence": sil,
        "contact_sheets": sheets,
        "artifacts": {
            "metadata_json": "metadata.json",
            "cuts_json": "cuts.json",
            "cut_frames_dir": "frames/cuts",
            "timeline_frames_dir": "frames/timeline",
            "montage_dir": "frames/montage",
            "loudness_log": "loudness.log" if has_audio else None,
        },
    }
    (outdir / "analysis.json").write_text(json.dumps(analysis, indent=2))

    log("done. Summary:", q)
    print(json.dumps(analysis["pacing"], indent=2))
    print(f"\nOutput dir: {outdir}")
    print(f"Contact sheets: {len(sheets)}  |  "
          f"Cut frames: {len(list((outdir/'frames/cuts').glob('*.jpg')))}  |  "
          f"Timeline frames: {len(list((outdir/'frames/timeline').glob('*.jpg')))}")


if __name__ == "__main__":
    main()
