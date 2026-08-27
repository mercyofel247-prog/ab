#!/usr/bin/env python3
"""
magnate-cut timeline generator.

Turns a folder of ordered clips + a VO into a ready-to-render timeline.json,
so you never hand-author hundreds of rows. Built for the common case: the
clips are the FINAL selected shots, one per beat, in order.

It reads:
  <project>/clips/     ordered clip files (natural-sorted by filename;
                       name them 0001_*.mp4, 0002_*.mp4, ... to lock order)
  <project>/vo/        the voice-over (first audio file, or --vo NAME)
  <project>/audio/music/  optional: one music file per tonal family; beds are
                          laid one-per-chapter, rotating families
  <project>/beats.csv  optional overrides (see --beats): per-clip transition,
                       duration, chapter, overlay, trims, an sfx event

and writes <project>/timeline.json with:
  - every clip as an ordered segment, graded, at the delivery peg;
  - a VARIED native transition rotation (hard cut base, periodic dissolves,
    a fade-to-black at each chapter break) so nothing reads locked;
  - auto chapters, with a music bed per chapter (families rotated) if music
    files are present;
  - the delivery + mastering targets baked into meta.

Then render with assemble.py. Edit the CSV or the JSON to refine — the
generator gives you a correct, complete starting point, not a black box.

Usage:
    python3 build_timeline.py <project> [--vo narration.wav] [--beat-len 0]
        [--chapters auto] [--out timeline.json] [--palette oxblood]
        [--beats beats.csv]
"""

import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import sys

VID_EXT = (".mp4", ".mov", ".m4v", ".webm", ".mkv")
AUD_EXT = (".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg")
FAMILIES = ["tense", "uplifting", "epic", "serene"]


def natkey(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def dur(path):
    cp = subprocess.run(["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                         "-of", "default=nw=1:nk=1", path],
                        stdout=subprocess.PIPE, text=True)
    try:
        return float(cp.stdout.strip())
    except ValueError:
        return 0.0


def default_transition(i, n, is_chapter_end):
    """Varied but native (no missing-bridge warnings). Chapter ends fade to
    black; otherwise a hard-cut base with a periodic dissolve and the odd wipe
    so a chunk never locks to one type (the 8-video continuity finding).
    Swap any of these to 'crash_zoom'/'fly_through' by hand once you've
    rendered the matching HyperFrames bridge."""
    if is_chapter_end:
        return ("fadeblack", 0.7)
    if i % 6 == 5:
        return ("dissolve", 0.5)
    if i % 11 == 8:
        return ("wipeleft", 0.4)
    return ("hard_cut", 0.04)


def main():
    ap = argparse.ArgumentParser(description="magnate-cut timeline generator")
    ap.add_argument("project")
    ap.add_argument("--clips-dir", default="clips")
    ap.add_argument("--vo", default=None, help="VO filename inside vo/ (default: first audio there)")
    ap.add_argument("--beat-len", type=float, default=0.0,
                     help="trim every clip to this many seconds (0 = use full clip length)")
    ap.add_argument("--chapters", default="auto",
                     help="'auto' (~1 per 40 clips) or an integer count")
    ap.add_argument("--palette", default="oxblood", choices=["oxblood", "gold"])
    ap.add_argument("--fps", type=int, default=24)
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--beats", default="beats.csv", help="optional CSV of per-clip overrides")
    ap.add_argument("--out", default="timeline.json")
    args = ap.parse_args()

    project = os.path.abspath(args.project)
    if not shutil.which("ffprobe"):
        print(json.dumps({"ok": False, "error": "ffprobe not on PATH"})); sys.exit(1)

    clips_dir = os.path.join(project, args.clips_dir)
    if not os.path.isdir(clips_dir):
        print(json.dumps({"ok": False, "error": f"no clips dir at {clips_dir}"})); sys.exit(1)
    clips = sorted([f for f in os.listdir(clips_dir) if f.lower().endswith(VID_EXT)], key=natkey)
    if not clips:
        print(json.dumps({"ok": False, "error": f"no clips in {clips_dir}"})); sys.exit(1)

    # VO
    vo_dir = os.path.join(project, "vo")
    vo_file = args.vo
    if not vo_file and os.path.isdir(vo_dir):
        auds = sorted([f for f in os.listdir(vo_dir) if f.lower().endswith(AUD_EXT)], key=natkey)
        vo_file = auds[0] if auds else None
    vo_rel = f"vo/{vo_file}" if vo_file else "vo/narration.wav"

    n = len(clips)
    if args.chapters == "auto":
        nchap = max(1, round(n / 40))
    else:
        nchap = max(1, int(args.chapters))
    per_chap = max(1, -(-n // nchap))  # ceil

    # optional per-clip overrides keyed by clip filename OR 1-based index
    overrides = {}
    beats_path = os.path.join(project, args.beats)
    if os.path.isfile(beats_path):
        with open(beats_path, newline="") as f:
            for row in csv.DictReader(f):
                key = (row.get("clip") or row.get("index") or "").strip()
                if key:
                    overrides[key] = row

    segments = []
    music_marks = []   # (chapter_idx, start_time, end_time)
    t = 0.0            # running timeline position (accounts for transitions)
    prev_tdur = 0.0
    chap_start_t = 0.0
    cur_chap = 0
    for i, name in enumerate(clips):
        path = os.path.join(clips_dir, name)
        d = dur(path)
        chap = i // per_chap
        is_chap_end = ((i + 1) % per_chap == 0) or (i == n - 1)

        ttype, tdur = default_transition(i, n, is_chap_end and i != n - 1)
        out_s = None
        in_s = 0.0
        overlay = None
        sfx_here = None
        ov = overrides.get(name) or overrides.get(str(i + 1))
        if ov:
            ttype = (ov.get("transition") or ttype).strip() or ttype
            if ov.get("dur"): tdur = float(ov["dur"])
            if ov.get("in"): in_s = float(ov["in"])
            if ov.get("out"): out_s = float(ov["out"])
            if ov.get("overlay"): overlay = ov["overlay"].strip() or None
            if ov.get("chapter"): chap = int(ov["chapter"])
            if ov.get("sfx_file") and ov.get("sfx_at"):
                sfx_here = {"file": ov["sfx_file"].strip(), "at_s": None, "rel_at": float(ov["sfx_at"])}
        eff_len = (out_s if out_s is not None else d) - in_s

        seg = {
            "id": f"s{i+1:04d}",
            "type": "clip",
            "src": f"{args.clips_dir}/{name}",
            "in_s": round(in_s, 3),
            "out_s": (round(out_s, 3) if out_s is not None else None),
            "grade": True,
            "chapter": f"ch{chap+1}",
        }
        if overlay:
            seg["overlay"] = overlay
        if i != n - 1:
            seg["transition_out"] = {"type": ttype, "dur_s": tdur}
            if ttype in ("crash_zoom", "fly_through"):
                seg["transition_out"]["src"] = None  # supply a rendered bridge
        segments.append(seg)

        # SFX event resolved to absolute time (rel_at from segment start)
        if sfx_here:
            sfx_here["at_s"] = round(t + sfx_here.pop("rel_at"), 3)

        # advance timeline clock (xfade shortens total by tdur)
        seg_start = t
        t = t + eff_len - (tdur if i != n - 1 else 0.0)

        # chapter bookkeeping for music beds
        if is_chap_end or i == n - 1:
            music_marks.append((cur_chap, round(chap_start_t, 2), round(t, 2)))
            chap_start_t = t
            cur_chap += 1

    # music beds — one per chapter, families rotated, if music files exist
    music = []
    music_dir = os.path.join(project, "audio", "music")
    music_files = []
    if os.path.isdir(music_dir):
        music_files = sorted([f for f in os.listdir(music_dir) if f.lower().endswith(AUD_EXT)], key=natkey)
    for ci, cstart, cend in music_marks:
        if not music_files:
            break
        fam = FAMILIES[ci % len(FAMILIES)]
        mf = music_files[ci % len(music_files)]
        music.append({
            "chapter": f"ch{ci+1}", "file": f"audio/music/{mf}",
            "start_s": cstart, "end_s": cend,
            "gain_db": -18, "duck_db": -15, "family": fam,
            "fade_in_s": 0.8, "fade_out_s": 1.0,
        })

    grade = {"lut": None,
             "eq": {"contrast": 1.04, "brightness": -0.005, "saturation": 0.95, "gamma": 1.02},
             "grain": 3}

    timeline = {
        "meta": {
            "title": os.path.basename(project),
            "palette_track": args.palette,
            "fps": args.fps, "width": args.width, "height": args.height,
            "master_lufs": -14.0, "master_true_peak_dbtp": -1.0,
        },
        "grade": grade,
        "vo": {"file": vo_rel, "offset_s": 0.0, "gain_db": 0},
        "music": music,
        "sfx": [],
        "segments": segments,
    }

    out_path = os.path.join(project, args.out)
    with open(out_path, "w") as f:
        json.dump(timeline, f, indent=2)

    print(json.dumps({
        "ok": True,
        "out": out_path,
        "num_clips": n,
        "chapters": nchap,
        "approx_runtime_sec": round(t, 1),
        "music_beds": len(music),
        "vo": vo_rel,
        "overrides_applied": len(overrides),
        "note": "Review/edit timeline.json (or beats.csv), add SFX + music, swap any "
                "transition to crash_zoom/fly_through once its HyperFrames bridge is rendered, "
                "then run assemble.py.",
    }))


if __name__ == "__main__":
    main()
