#!/usr/bin/env python3
"""
Final assembly: takes a cutlist (source clips + transitions between them) and
produces one master file in a single ffmpeg pass — no intermediate re-encodes.

Three transition kinds, matching manifest.json's render_mode:
  - "baked":   the owning engine (Blender/Remotion/HyperFrames) already
               rendered a self-contained clip bridging both source clips.
               Just concatenated in — no filter needed at the join itself.
  - "overlay": a hard cut between the two source clips, with a translucent/
               blend-mode element (film burn, light leak, smoke, embers...)
               composited on top spanning the cut point.
  - "native":  ffmpeg builds the whole transition itself via the `xfade`
               filter — no external asset. Covers the subset of manifest.json's
               "native" entries that have a clean stock xfade equivalent
               (dissolve, wipes, radial, pixelize, circleopen/close, etc).
               A few native entries (Venetian Blind's slat mask, the VHS/
               glitch distortions) need a bespoke filter graph beyond a
               stock xfade name — those fall back to "fade" with a warning
               printed at build time; swap in a real geq/noise filter graph
               for those later rather than treating the fallback as final.

Encoder: probes `ffmpeg -encoders` for av1_amf / h264_amf (AMD hardware
encode) and uses whichever is available; falls back to libx264 if neither is
present (e.g. this sandbox, which has no GPU at all) or --software is passed.

Usage:
  python3 assemble.py --cutlist cutlist.json --out master.mp4
  python3 assemble.py --cutlist cutlist.json --out master.mp4 --software

Cutlist JSON schema — see cutlist.example.json in this directory.
"""
import argparse
import json
import subprocess
import sys

# manifest transition id -> ffmpeg xfade transition name, for the "native"
# bucket entries that have a clean stock equivalent. Not exhaustive — see
# module docstring.
NATIVE_XFADE_MAP = {
    2: "dissolve",       # Natural Mask / Edge Wipe (matte from source itself; dissolve as the honest fallback until a real matte-from-footage filter graph is built)
    8: "fade",           # Graphic Match Cut (pure editorial cut — a fast fade covers the join point)
    17: "fade",          # DOF Rack Focus Blur (blur ramp isn't a stock xfade name; fade stands in)
    18: "fade",          # Negative/Solarization Flash (build with lutrgb/negate around a fade — TODO custom)
    33: "fade",          # Subliminal Montage Strobe (needs frame-hold trickery, not xfade — TODO custom)
    37: "fade",          # Security Camera Fisheye (needs lenscorrection, not xfade — TODO custom)
    39: "fade",          # Venetian Blind Shadow Wipe — TODO: custom geq slat-mask filter graph
    43: "dissolve",      # Sky Tilt & Horizon Dissolve
    56: "pixelize",      # Video Compression Artifact Dissolve — closest stock analog
    67: "fade",          # Thermal Vision FLIR (needs pseudocolor filter first — TODO custom)
    68: "fadewhite",     # Magnesium Flashbulb Bleach-Out
    75: "fade",          # Magnetic Tape Tracking Crease — TODO custom geq/noise
    81: "wipeleft",      # Guillotine Blade diagonal slash — closest stock analog (not literally diagonal)
    88: "fade",          # Cyanotype Architectural Flash (needs lut3d — TODO custom)
    99: "fade",          # Vinyl Needle Scratch & Skew — TODO custom skew filter
    116: "fade",         # Analog Rewind & Reverse — needs the reverse filter on clip A, not xfade alone
}


def ffprobe_duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True,
    ).stdout.strip()
    return float(out)


def probe_hw_encoder(force_software):
    if force_software:
        return "libx264", ["-preset", "medium", "-crf", "18"]
    try:
        out = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
    except FileNotFoundError:
        print("ffmpeg not found on PATH", file=sys.stderr)
        sys.exit(1)
    if "av1_amf" in out:
        print("Using av1_amf (AMD hardware AV1 encode)")
        return "av1_amf", ["-quality", "quality"]
    if "h264_amf" in out:
        print("Using h264_amf (AMD hardware H.264 encode)")
        return "h264_amf", ["-quality", "quality"]
    print("No AMF hardware encoder found — falling back to libx264 (software). "
          "Expected on this sandbox (no GPU); should pick up av1_amf/h264_amf "
          "automatically on the RX 9060 XT box.", file=sys.stderr)
    return "libx264", ["-preset", "medium", "-crf", "18"]


def build_filter_graph(cutlist):
    """Builds one filter_complex graph for the whole sequence. Returns
    (filter_complex_str, input_files, final_video_label)."""
    seq = cutlist["sequence"]
    width, height = (int(x) for x in cutlist.get("resolution", "1920x1080").lower().split("x"))
    fps = cutlist.get("fps", 30)
    inputs = []
    filters = []
    label_counter = [0]

    def new_label():
        label_counter[0] += 1
        return f"v{label_counter[0]}"

    def add_input(path):
        inputs.append(path)
        return len(inputs) - 1

    # every source — clip, baked-transition clip, or overlay asset — gets
    # normalized to one common resolution/SAR/framerate before it hits
    # concat/xfade/blend, which all require matching geometry AND framerate
    # across inputs (mixing 24fps footage with a 30fps rendered bridge in a
    # concat otherwise produces timing/stutter artifacts).
    scale_expr = (
        f"fps={fps},scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1"
    )

    clip_labels = []
    for item in seq:
        if "clip" in item:
            idx = add_input(item["clip"])
            trim_in = item.get("trim_in", 0)
            trim_out = item.get("trim_out")
            src_duration = ffprobe_duration(item["clip"])
            seg_duration = (trim_out if trim_out is not None else src_duration) - trim_in
            lbl = new_label()
            trim_expr = f"trim=start={trim_in}" + (f":end={trim_out}" if trim_out else "")
            filters.append(f"[{idx}:v]{trim_expr},setpts=PTS-STARTPTS,{scale_expr}[{lbl}]")
            clip_labels.append(("clip", lbl, seg_duration))
        elif "transition_id" in item:
            tid = item["transition_id"]
            duration = item.get("duration", 0.5)
            if item.get("baked_clip"):
                idx = add_input(item["baked_clip"])
                seg_duration = ffprobe_duration(item["baked_clip"])
                lbl = new_label()
                filters.append(f"[{idx}:v]setpts=PTS-STARTPTS,{scale_expr}[{lbl}]")
                clip_labels.append(("baked", lbl, seg_duration))
            elif item.get("asset"):
                idx = add_input(item["asset"])
                lbl = new_label()
                # trim the overlay asset itself to exactly `duration` so the
                # windowed blend below lines up frame-for-frame with the window.
                filters.append(
                    f"[{idx}:v]trim=start=0:end={duration},setpts=PTS-STARTPTS,{scale_expr}[{lbl}]"
                )
                clip_labels.append(("overlay", lbl, duration))
            else:
                xfade_name = NATIVE_XFADE_MAP.get(tid, "fade")
                if tid not in NATIVE_XFADE_MAP:
                    print(f"WARNING: transition id {tid} has no NATIVE_XFADE_MAP entry, "
                          f"using 'fade' as a placeholder — build a real filter graph for it.",
                          file=sys.stderr)
                clip_labels.append(("native", xfade_name, duration))
        else:
            raise ValueError(f"cutlist item has neither 'clip' nor 'transition_id': {item}")

    # fold clip_labels pairwise: clip, [transition,] clip, [transition,] clip...
    # current_duration tracks the running length (seconds) of `current` so
    # overlay windows and xfade offsets can be placed correctly without any
    # lookahead into the rest of the sequence.
    current = None
    current_duration = 0.0
    i = 0
    while i < len(clip_labels):
        kind = clip_labels[i][0]
        if kind in ("clip", "baked"):
            lbl, dur = clip_labels[i][1], clip_labels[i][2]
            if current is None:
                current, current_duration = lbl, dur
            else:
                out_lbl = new_label()
                filters.append(f"[{current}][{lbl}]concat=n=2:v=1:a=0[{out_lbl}]")
                current, current_duration = out_lbl, current_duration + dur
            i += 1
        elif kind == "native":
            _, xfade_name, duration = clip_labels[i]
            next_lbl, next_dur = clip_labels[i + 1][1], clip_labels[i + 1][2]
            out_lbl = new_label()
            offset = max(current_duration - duration, 0)
            filters.append(
                f"[{current}][{next_lbl}]xfade=transition={xfade_name}:duration={duration}:offset={offset}[{out_lbl}]"
            )
            current = out_lbl
            current_duration = current_duration + next_dur - duration
            i += 2  # consumed the following clip too
        elif kind == "overlay":
            _, overlay_lbl, duration = clip_labels[i]
            next_lbl, next_dur = clip_labels[i + 1][1], clip_labels[i + 1][2]
            joined = new_label()
            filters.append(f"[{current}][{next_lbl}]concat=n=2:v=1:a=0[{joined}]")

            cut_time = current_duration
            window_start = max(cut_time - duration / 2, 0)
            window_end = window_start + duration

            # filter_complex requires an explicit split to fan one labeled
            # output out to multiple downstream filters — feeding [joined]
            # into three separate trim filters directly is not valid.
            joined_a, joined_b, joined_c = new_label(), new_label(), new_label()
            filters.append(f"[{joined}]split=3[{joined_a}][{joined_b}][{joined_c}]")

            pre_lbl = new_label()
            filters.append(f"[{joined_a}]trim=start=0:end={window_start},setpts=PTS-STARTPTS[{pre_lbl}]")
            window_lbl = new_label()
            filters.append(
                f"[{joined_b}]trim=start={window_start}:end={window_end},setpts=PTS-STARTPTS[{window_lbl}]"
            )
            post_lbl = new_label()
            filters.append(f"[{joined_c}]trim=start={window_end},setpts=PTS-STARTPTS[{post_lbl}]")

            blended_lbl = new_label()
            filters.append(f"[{window_lbl}][{overlay_lbl}]blend=all_mode=screen:shortest=1[{blended_lbl}]")

            out_lbl = new_label()
            filters.append(f"[{pre_lbl}][{blended_lbl}][{post_lbl}]concat=n=3:v=1:a=0[{out_lbl}]")
            current = out_lbl
            current_duration = current_duration + next_dur
            i += 2

    return ";".join(filters), inputs, current


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--cutlist", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--software", action="store_true", help="force libx264 instead of probing for AMF")
    args = p.parse_args()

    with open(args.cutlist) as f:
        cutlist = json.load(f)

    encoder, encoder_args = probe_hw_encoder(args.software)
    filter_complex, inputs, final_label = build_filter_graph(cutlist)

    cmd = ["ffmpeg", "-y"]
    for path in inputs:
        cmd += ["-i", path]
    cmd += [
        "-filter_complex", filter_complex,
        "-map", f"[{final_label}]",
        "-c:v", encoder,
        *encoder_args,
        "-r", str(cutlist.get("fps", 30)),
        args.out,
    ]

    print("Running:", " ".join(cmd))
    subprocess.run(cmd, check=True)
    print(f"Assembled -> {args.out}")


if __name__ == "__main__":
    main()
