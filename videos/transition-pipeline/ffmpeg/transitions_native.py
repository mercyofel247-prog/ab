#!/usr/bin/env python3
"""
Generators for the ffmpeg-owned S-tier transitions that need a bespoke filter
graph (more than a stock `xfade` name), rendered as baked bridge clips so they
drop straight into assemble.py's "baked_clip" path.

Each generator takes the outgoing clip (A) and incoming clip (B), pulls the
tail of A and the head of B, and produces a short self-contained bridge clip
of the requested duration.

  whip_pan  (#11 Dynamic Whip-Pan Snap): xfade slide + heavy horizontal
            average-blur — the directional smear that sells a whip.
  glitch    (#13 Glitch & Digital Distortion): hard cut mid-bridge with RGB
            channel split (chromatic aberration) + temporal noise + a
            saturation push across the whole bridge.

Usage:
  python3 transitions_native.py whip_pan  --clip-a A.mp4 --clip-b B.mp4 --duration 0.35 --out bridge.mp4
  python3 transitions_native.py glitch    --clip-a A.mp4 --clip-b B.mp4 --duration 0.30 --out bridge.mp4
  [--resolution 1280x720] [--fps 30] [--software]
"""
import argparse
import subprocess
import sys


def encoder_args(force_software):
    if force_software:
        return ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p"]
    probe = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
    if "h264_amf" in probe:
        return ["-c:v", "h264_amf", "-quality", "quality"]
    return ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p"]


def norm(w, h, fps):
    return (
        f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
        f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps}"
    )


def whip_pan(a, b, dur, w, h, fps, out, enc):
    n = norm(w, h, fps)
    # each input trimmed to exactly `dur`; xfade over the full window makes a
    # `dur`-long output. Heavy horizontal-only blur = the whip smear.
    fc = (
        f"[0:v]{n}[a];[1:v]{n}[b];"
        f"[a][b]xfade=transition=slideleft:duration={dur}:offset=0,"
        f"avgblur=sizeX=80:sizeY=1[out]"
    )
    cmd = ["ffmpeg", "-y",
           "-sseof", f"-{dur}", "-i", a,
           "-t", str(dur), "-i", b,
           "-filter_complex", fc, "-map", "[out]", *enc, "-r", str(fps), out]
    subprocess.run(cmd, check=True)


def glitch(a, b, dur, w, h, fps, out, enc):
    n = norm(w, h, fps)
    half = dur / 2
    # hard cut at the midpoint, chromatic aberration + temporal noise +
    # saturation push over the whole bridge.
    fc = (
        f"[0:v]{n}[a];[1:v]{n}[b];"
        f"[a][b]concat=n=2:v=1:a=0,"
        f"rgbashift=rh=14:bh=-14:rv=-6:bv=6,"
        f"noise=alls=28:allf=t+u,"
        f"eq=saturation=1.5:contrast=1.15[out]"
    )
    cmd = ["ffmpeg", "-y",
           "-sseof", f"-{half}", "-i", a,
           "-t", str(half), "-i", b,
           "-filter_complex", fc, "-map", "[out]", *enc, "-r", str(fps), out]
    subprocess.run(cmd, check=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("kind", choices=["whip_pan", "glitch"])
    p.add_argument("--clip-a", required=True)
    p.add_argument("--clip-b", required=True)
    p.add_argument("--duration", type=float, default=0.35)
    p.add_argument("--resolution", default="1280x720")
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--out", required=True)
    p.add_argument("--software", action="store_true")
    args = p.parse_args()

    w, h = (int(x) for x in args.resolution.lower().split("x"))
    enc = encoder_args(args.software)
    fn = {"whip_pan": whip_pan, "glitch": glitch}[args.kind]
    fn(args.clip_a, args.clip_b, args.duration, w, h, args.fps, args.out, enc)
    print(f"Wrote {args.kind} bridge -> {args.out}")


if __name__ == "__main__":
    main()
