#!/usr/bin/env python3
"""
magnate-cut assembly engine.

Takes a timeline.json (the machine-readable M-HYBRID clip table) plus its
assets — provided video clips, animations generated here (HyperFrames /
Remotion / Blender), pre-rendered signature transitions, a provided
voice-over, music beds, and SFX — and produces ONE finished, mastered
MagnatesMedia-style video:

  - every visual segment normalized to the delivery peg (1920x1080 @ 24fps)
    and pushed through ONE shared colour grade (the continuity layer, so
    independently-generated clips read as one film, not assembled clips);
  - segments joined by S-tier transitions: ffmpeg-native for
    hard_cut/dissolve/fade*/wipe*/smooth*, and spliced pre-rendered
    HyperFrames bridges for the crash_zoom / fly_through signature;
  - optional transparent Mode-A overlays (kinetic type / arrows / alert
    wash) composited over a clip;
  - a designed audio stack: music beds (ducked under the VO via real
    sidechain compression — voice always wins), SFX placed in the gaps,
    scored silence where the beds leave a gap, all under the provided VO;
  - mastered to spec: -14 LUFS integrated, true peak <= -1.0 dBTP (two-pass
    loudnorm) — the single biggest lesson from the 8-video audit, where 7 of
    8 clips were clipping over 0 dBTP.

It does NOT generate assets. Clips + VO are provided; animations, transitions,
SFX and music are generated in separate steps (see the skill workflow) and
referenced by path. This script is the MERGE + FINISH stage only.

Usage:
    python3 assemble.py <project_dir> [--timeline timeline.json]
                        [--out renders/final.mp4] [--draft] [--no-master]

Prints one JSON line on completion.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

# ffmpeg xfade transition-name for each timeline transition type.
# hard_cut is a 1-frame fade (reads as a straight cut but keeps one uniform
# xfade chain, which is far more robust than mixing concat + xfade).
XFADE_MAP = {
    "hard_cut": "fade",
    "dissolve": "fade",
    "fadeblack": "fadeblack",
    "fadewhite": "fadewhite",
    "wipeleft": "wipeleft",
    "wiperight": "wiperight",
    "wipeup": "wipeup",
    "wipedown": "wipedown",
    "smoothleft": "smoothleft",
    "smoothright": "smoothright",
    "whip_pan": "smoothleft",      # native approximation of a whip
    "dof_rack": "fade",            # native approximation of a rack-focus handoff
}
# These require a pre-rendered HyperFrames bridge spliced in as its own unit.
SPLICE_TYPES = {"crash_zoom", "fly_through"}
ONE_FRAME = None  # set from fps


def run(cmd, timeout=None):
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=True, timeout=timeout)


def must(cp, what):
    if cp.returncode != 0:
        sys.stderr.write(f"[magnate-cut] FAILED: {what}\n{cp.args}\n{cp.stderr[-3000:]}\n")
        raise SystemExit(1)


def ffprobe_dur(path):
    cp = run(["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
              "-of", "default=nw=1:nk=1", path])
    try:
        return float(cp.stdout.strip())
    except ValueError:
        return 0.0


def grade_filter(grade, want):
    """Build the eq/grade filter fragment (continuity look-block)."""
    if not want or not grade:
        return ""
    parts = []
    eq = (grade or {}).get("eq", {})
    eqbits = []
    if eq:
        if "contrast" in eq:  eqbits.append(f"contrast={eq['contrast']}")
        if "brightness" in eq: eqbits.append(f"brightness={eq['brightness']}")
        if "saturation" in eq: eqbits.append(f"saturation={eq['saturation']}")
        if "gamma" in eq:     eqbits.append(f"gamma={eq['gamma']}")
    if eqbits:
        parts.append("eq=" + ":".join(eqbits))
    lut = (grade or {}).get("lut")
    if lut:
        parts.append(f"lut3d='{lut}'")
    grain = float((grade or {}).get("grain", 0) or 0)
    if grain > 0:
        parts.append(f"noise=alls={grain}:allf=t+u")
    return ",".join(parts)


def normalize_segment(seg, project, workdir, meta, grade, idx):
    """Trim + scale/pad to the delivery peg + fps + grade + optional overlay,
    write a clean intermediate MP4 with uniform SAR/pix_fmt so xfade/concat
    never choke on mismatched inputs."""
    W, H, FPS = meta["width"], meta["height"], meta["fps"]
    src = os.path.join(project, seg["src"])
    if not os.path.isfile(src):
        raise SystemExit(f"[magnate-cut] missing asset: {src}")
    in_s = float(seg.get("in_s", 0) or 0)
    out_s = seg.get("out_s", None)

    vf = [
        f"scale={W}:{H}:force_original_aspect_ratio=decrease",
        f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black",
        "setsar=1",
        f"fps={FPS}",
    ]
    g = grade_filter(grade, seg.get("grade", True))
    if g:
        vf.append(g)
    vf.append("format=yuv420p")

    trim = ["-ss", f"{in_s:.3f}"]
    if out_s is not None:
        trim += ["-t", f"{float(out_s) - in_s:.3f}"]

    out = os.path.join(workdir, f"seg_{idx:03d}.mp4")
    cmd = ["ffmpeg", "-y", *trim, "-i", src]

    overlay = seg.get("overlay")
    if overlay:
        ov = os.path.join(project, overlay)
        # overlay is a transparent element scaled to frame, composited on top.
        # Force yuva420p BEFORE and AFTER the scale so the alpha channel
        # survives (scale silently drops alpha to yuv420p otherwise, which
        # would render the overlay's transparent regions as opaque black).
        fc = (f"[0:v]{','.join(vf)}[base];"
              f"[1:v]format=yuva420p,scale={W}:{H}:force_original_aspect_ratio=decrease,"
              f"setsar=1,format=yuva420p[ov];"
              f"[base][ov]overlay=(W-w)/2:(H-h)/2:format=auto,format=yuv420p[v]")
        cmd += ["-i", ov, "-filter_complex", fc, "-map", "[v]"]
    else:
        cmd += ["-vf", ",".join(vf)]
    cmd += ["-an", "-r", str(FPS), "-c:v", "libx264", "-preset", "veryfast",
            "-crf", "18", "-pix_fmt", "yuv420p", out]
    must(run(cmd, timeout=600), f"normalize segment {seg.get('id', idx)}")
    return out, ffprobe_dur(out)


def build_units(segments, project, workdir, meta, grade):
    """Expand segments into a flat list of video 'units' plus the join spec
    between consecutive units. A spliced signature transition (crash_zoom /
    fly_through) becomes its own unit, hard-joined on both sides."""
    units = []   # list of {path, dur}
    joins = []   # join[i] describes unit[i] -> unit[i+1]
    for i, seg in enumerate(segments):
        path, dur = normalize_segment(seg, project, workdir, meta, grade, len(units))
        units.append({"path": path, "dur": dur, "id": seg.get("id")})

        tr = seg.get("transition_out") or None
        is_last = (i == len(segments) - 1)
        if is_last or tr is None:
            if not is_last:
                joins.append({"type": "hard_cut", "dur": ONE_FRAME})
            continue

        ttype = tr.get("type", "hard_cut")
        tdur = float(tr.get("dur_s", 0.5) or 0.5)

        if ttype in SPLICE_TYPES:
            bridge = tr.get("src")
            if bridge and os.path.isfile(os.path.join(project, bridge)):
                # normalize the bridge as its own unit; hard-join both sides
                bseg = {"src": bridge, "grade": True, "id": f"{seg.get('id')}_bridge"}
                bpath, bdur = normalize_segment(bseg, project, workdir, meta, grade, len(units))
                joins.append({"type": "hard_cut", "dur": ONE_FRAME})   # A -> bridge
                units.append({"path": bpath, "dur": bdur, "id": bseg["id"]})
                joins.append({"type": "hard_cut", "dur": ONE_FRAME})   # bridge -> B
            else:
                # no bridge supplied: fall back to a fast dissolve so the cut
                # still reads intentional (and warn).
                sys.stderr.write(f"[magnate-cut] WARNING: {ttype} on {seg.get('id')} has no "
                                 f"pre-rendered `src` bridge; falling back to a {tdur}s dissolve.\n")
                joins.append({"type": "dissolve", "dur": tdur})
        else:
            joins.append({"type": ttype, "dur": tdur})
    return units, joins


def build_video(units, joins, workdir, meta, out_path):
    """Fold the units into one video via a single xfade filter_complex.
    Cumulative offsets account for each xfade shortening the running total."""
    FPS = meta["fps"]
    if len(units) == 1:
        shutil.copy(units[0]["path"], out_path)
        return

    inputs = []
    for u in units:
        inputs += ["-i", u["path"]]

    fc = []
    # label each input v0..vN (already normalized, just relabel with settb/setpts reset)
    for i in range(len(units)):
        fc.append(f"[{i}:v]settb=AVTB,setpts=PTS-STARTPTS[v{i}]")

    running = units[0]["dur"]
    cur = "v0"
    for i in range(1, len(units)):
        j = joins[i - 1]
        tdur = float(j["dur"])
        # clamp: transition can't exceed either neighbouring clip
        tdur = max(1.0 / FPS, min(tdur, units[i - 1]["dur"] - 1.0 / FPS,
                                  units[i]["dur"] - 1.0 / FPS))
        trans = XFADE_MAP.get(j["type"], "fade")
        offset = running - tdur
        if offset < 0:
            offset = 0.0
        outl = f"x{i}"
        fc.append(f"[{cur}][v{i}]xfade=transition={trans}:duration={tdur:.3f}:"
                  f"offset={offset:.3f}[{outl}]")
        running = running + units[i]["dur"] - tdur
        cur = outl

    filter_complex = ";".join(fc)
    cmd = ["ffmpeg", "-y", *inputs, "-filter_complex", filter_complex,
           "-map", f"[{cur}]", "-r", str(FPS),
           "-c:v", "libx264", "-preset", "medium", "-crf", "18",
           "-pix_fmt", "yuv420p", out_path]
    must(run(cmd, timeout=1800), "build video (xfade chain)")


def build_audio(tl, project, workdir, total_dur, meta, out_path):
    """Design + mix the audio stack: music beds ducked under VO, SFX in the
    gaps, all under the provided VO, mastered to -14 LUFS / <= -1 dBTP."""
    vo = tl["vo"]
    vo_path = os.path.join(project, vo["file"])
    if not os.path.isfile(vo_path):
        raise SystemExit(f"[magnate-cut] missing VO: {vo_path}")
    vo_off = float(vo.get("offset_s", 0) or 0)
    vo_gain = float(vo.get("gain_db", 0) or 0)

    inputs = ["-i", vo_path]
    idx = 1
    fc = []

    # VO -> stereo, delayed, gained; this is the sidechain key AND the top layer
    fc.append(f"[0:a]aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=48000,"
              f"adelay={int(vo_off*1000)}|{int(vo_off*1000)},volume={vo_gain}dB,"
              f"apad,atrim=0:{total_dur:.3f},asetpts=PTS-STARTPTS[vo]")

    # Music beds -> amix into one bed track
    beds = tl.get("music", []) or []
    bed_labels = []
    for b in beds:
        bp = os.path.join(project, b["file"])
        if not os.path.isfile(bp):
            sys.stderr.write(f"[magnate-cut] WARNING: missing music bed {bp}; skipping.\n")
            continue
        inputs += ["-stream_loop", "-1", "-i", bp]
        start = float(b["start_s"]); end = float(b["end_s"])
        seglen = max(0.1, end - start)
        gain = float(b.get("gain_db", -18))
        fin = float(b.get("fade_in_s", 0.5)); fout = float(b.get("fade_out_s", 0.8))
        lbl = f"bed{idx}"
        fc.append(f"[{idx}:a]aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=48000,"
                  f"atrim=0:{seglen:.3f},asetpts=PTS-STARTPTS,"
                  f"afade=t=in:st=0:d={fin},afade=t=out:st={max(0,seglen-fout):.3f}:d={fout},"
                  f"volume={gain}dB,adelay={int(start*1000)}|{int(start*1000)}[{lbl}]")
        bed_labels.append(lbl)
        idx += 1

    music_out = None
    if bed_labels:
        if len(bed_labels) == 1:
            fc.append(f"[{bed_labels[0]}]apad,atrim=0:{total_dur:.3f}[bedmix]")
        else:
            fc.append("".join(f"[{l}]" for l in bed_labels) +
                      f"amix=inputs={len(bed_labels)}:normalize=0:dropout_transition=0,"
                      f"apad,atrim=0:{total_dur:.3f}[bedmix]")
        # sidechain-duck the bed under the VO (voice always wins). Split VO so
        # we keep a clean copy for the final mix.
        fc.append("[vo]asplit=2[vokey][votop]")
        duck = float(beds[0].get("duck_db", -15))
        # sidechaincompress: threshold/ratio tuned so VO presence pulls the bed
        # down ~ duck_db; makeup keeps it audible in the gaps.
        fc.append(f"[bedmix][vokey]sidechaincompress=threshold=0.05:ratio=8:"
                  f"attack=20:release=350:makeup=1[bedducked]")
        music_out = "bedducked"
        vo_final = "votop"
    else:
        vo_final = "vo"

    # SFX events -> placed at absolute times, in the gaps
    sfx = tl.get("sfx", []) or []
    sfx_labels = []
    for s in sfx:
        sp = os.path.join(project, s["file"])
        if not os.path.isfile(sp):
            sys.stderr.write(f"[magnate-cut] WARNING: missing SFX {sp}; skipping.\n")
            continue
        inputs += ["-i", sp]
        at = float(s["at_s"]); gain = float(s.get("gain_db", -8))
        lbl = f"sfx{idx}"
        fc.append(f"[{idx}:a]aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=48000,"
                  f"volume={gain}dB,adelay={int(at*1000)}|{int(at*1000)}[{lbl}]")
        sfx_labels.append(lbl)
        idx += 1

    # Final mix: ducked music + sfx + VO(top). VO stays at its level (wins).
    mix_ins = []
    if music_out:
        mix_ins.append(music_out)
    mix_ins += sfx_labels
    mix_ins.append(vo_final)
    if len(mix_ins) == 1:
        fc.append(f"[{mix_ins[0]}]apad,atrim=0:{total_dur:.3f}[premaster]")
    else:
        fc.append("".join(f"[{l}]" for l in mix_ins) +
                  f"amix=inputs={len(mix_ins)}:normalize=0:dropout_transition=0,"
                  f"apad,atrim=0:{total_dur:.3f}[premaster]")

    filter_complex = ";".join(fc)
    cmd = ["ffmpeg", "-y", *inputs, "-filter_complex", filter_complex,
           "-map", "[premaster]", "-c:a", "pcm_s24le", "-ar", "48000", out_path]
    must(run(cmd, timeout=1200), "build audio stack")


def master_audio(in_wav, out_wav, lufs, tp, workdir):
    """Two-pass loudnorm to the integrated-loudness + true-peak targets.
    This is the fix for the 8-video audit finding (7/8 clipping over 0 dBTP)."""
    # pass 1: measure
    cp = run(["ffmpeg", "-i", in_wav, "-af",
              f"loudnorm=I={lufs}:TP={tp}:LRA=11:print_format=json",
              "-f", "null", "-"], timeout=600)
    meas = {}
    txt = cp.stderr
    try:
        start = txt.rindex("{"); end = txt.rindex("}") + 1
        meas = json.loads(txt[start:end])
    except (ValueError, json.JSONDecodeError):
        sys.stderr.write("[magnate-cut] WARNING: loudnorm pass-1 measure failed; single-pass fallback.\n")
    if meas:
        af = (f"loudnorm=I={lufs}:TP={tp}:LRA=11:"
              f"measured_I={meas['input_i']}:measured_TP={meas['input_tp']}:"
              f"measured_LRA={meas['input_lra']}:measured_thresh={meas['input_thresh']}:"
              f"offset={meas['target_offset']}:linear=true:print_format=summary")
    else:
        af = f"loudnorm=I={lufs}:TP={tp}:LRA=11"
    must(run(["ffmpeg", "-y", "-i", in_wav, "-af", af,
              "-ar", "48000", "-c:a", "pcm_s24le", out_wav], timeout=600),
         "master audio (loudnorm pass 2)")


def main():
    ap = argparse.ArgumentParser(description="magnate-cut assembly engine")
    ap.add_argument("project", help="project directory (contains timeline.json + assets)")
    ap.add_argument("--timeline", default="timeline.json")
    ap.add_argument("--out", default=None, help="output path (default: <project>/renders/final.mp4)")
    ap.add_argument("--draft", action="store_true", help="faster/lower-quality encode")
    ap.add_argument("--no-master", action="store_true", help="skip the LUFS mastering pass")
    ap.add_argument("--keep-temp", action="store_true")
    args = ap.parse_args()

    global ONE_FRAME
    project = os.path.abspath(args.project)
    tl_path = os.path.join(project, args.timeline)
    if not os.path.isfile(tl_path):
        print(json.dumps({"ok": False, "error": f"no timeline at {tl_path}"})); sys.exit(1)
    tl = json.load(open(tl_path))

    meta = tl.get("meta", {})
    meta.setdefault("fps", 24); meta.setdefault("width", 1920); meta.setdefault("height", 1080)
    meta.setdefault("master_lufs", -14.0); meta.setdefault("master_true_peak_dbtp", -1.0)
    ONE_FRAME = round(1.0 / meta["fps"], 4)

    for b in ("ffmpeg", "ffprobe"):
        if not shutil.which(b):
            print(json.dumps({"ok": False, "error": f"{b} not on PATH"})); sys.exit(1)

    out_path = args.out or os.path.join(project, "renders", "final.mp4")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    workdir = tempfile.mkdtemp(prefix="magnatecut_")

    try:
        segments = tl.get("segments", [])
        if not segments:
            print(json.dumps({"ok": False, "error": "no segments in timeline"})); sys.exit(1)

        sys.stderr.write(f"[magnate-cut] normalizing {len(segments)} segments to "
                         f"{meta['width']}x{meta['height']}@{meta['fps']} + shared grade...\n")
        units, joins = build_units(segments, project, workdir, meta, tl.get("grade"))

        video_only = os.path.join(workdir, "video.mp4")
        sys.stderr.write(f"[magnate-cut] joining {len(units)} units with transitions...\n")
        build_video(units, joins, workdir, meta, video_only)
        total = ffprobe_dur(video_only)

        sys.stderr.write("[magnate-cut] designing + mixing audio (VO-ducked beds + SFX)...\n")
        audio_raw = os.path.join(workdir, "audio_raw.wav")
        build_audio(tl, project, workdir, total, meta, audio_raw)

        if args.no_master:
            audio_final = audio_raw
            mastered = False
        else:
            sys.stderr.write(f"[magnate-cut] mastering to {meta['master_lufs']} LUFS / "
                             f"{meta['master_true_peak_dbtp']} dBTP...\n")
            audio_final = os.path.join(workdir, "audio_master.wav")
            master_audio(audio_raw, audio_final, meta["master_lufs"],
                         meta["master_true_peak_dbtp"], workdir)
            mastered = True

        sys.stderr.write("[magnate-cut] muxing final...\n")
        vbr = ["-c:v", "libx264", "-preset", ("veryfast" if args.draft else "slow"),
               "-crf", ("23" if args.draft else "17"), "-pix_fmt", "yuv420p",
               "-movflags", "+faststart"]
        must(run(["ffmpeg", "-y", "-i", video_only, "-i", audio_final,
                  "-map", "0:v:0", "-map", "1:a:0", *vbr,
                  "-c:a", "aac", "-b:a", "320k", "-ar", "48000",
                  "-shortest", out_path], timeout=1800), "final mux")

        print(json.dumps({
            "ok": True,
            "out": out_path,
            "duration_sec": round(ffprobe_dur(out_path), 2),
            "num_segments": len(segments),
            "num_units": len(units),
            "resolution": f"{meta['width']}x{meta['height']}",
            "fps": meta["fps"],
            "mastered": mastered,
            "target_lufs": meta["master_lufs"],
            "target_true_peak_dbtp": meta["master_true_peak_dbtp"],
            "note": "Run watchutube on the output to verify LUFS/peak/transitions against target.",
        }))
    finally:
        if not args.keep_temp:
            shutil.rmtree(workdir, ignore_errors=True)
        else:
            sys.stderr.write(f"[magnate-cut] temp kept at {workdir}\n")


if __name__ == "__main__":
    main()
