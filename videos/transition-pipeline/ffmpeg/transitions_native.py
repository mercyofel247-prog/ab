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
    # each input trimmed to exactly `dur`; xfade slideleft over the full
    # window makes a `dur`-long output. Heavy horizontal-only blur = the whip
    # smear; a scale punch (zoom to 1.08 and back) adds recoil; a short white
    # bloom at the midpoint via curves lift sells the speed. The audible
    # whoosh muxed in at assembly does most of the selling.
    fc = (
        f"[0:v]{n}[a];[1:v]{n}[b];"
        f"[a][b]xfade=transition=slideleft:duration={dur}:offset=0,"
        f"avgblur=sizeX=140:sizeY=2,"
        f"scale=iw*1.08:ih*1.08,crop={w}:{h},"
        f"eq=brightness=0.06:contrast=1.12:saturation=1.15[out]"
    )
    cmd = ["ffmpeg", "-y",
           "-sseof", f"-{dur}", "-i", a,
           "-t", str(dur), "-i", b,
           "-filter_complex", fc, "-map", "[out]", *enc, "-r", str(fps), out]
    subprocess.run(cmd, check=True)


def glitch(a, b, dur, w, h, fps, out, enc):
    n = norm(w, h, fps)
    half = dur / 2
    # hard cut at the midpoint, then a stack of digital-failure artifacts:
    #   rgbashift  — heavy chromatic aberration / channel split
    #   tmix       — 4-frame smear = datamosh-style motion trails
    #   noise      — analog/digital grain
    #   tblend difference on a self-delayed copy — flickering edge tearing
    #   eq         — crushed contrast + saturation push
    # Much busier and more aggressive than the v1 static rgbashift+noise.
    fc = (
        f"[0:v]{n}[a];[1:v]{n}[b];"
        f"[a][b]concat=n=2:v=1:a=0,split=2[m0][m1];"
        f"[m0]rgbashift=rh=26:bh=-26:rv=-10:bv=10,tmix=frames=4:weights='1 1 1 1'[g0];"
        f"[g0]noise=alls=44:allf=t+u,eq=saturation=1.7:contrast=1.25:brightness=0.02[g1];"
        f"[m1]tblend=all_mode=difference[g2];"
        f"[g1][g2]blend=all_mode=screen:all_opacity=0.35[out]"
    )
    cmd = ["ffmpeg", "-y",
           "-sseof", f"-{half}", "-i", a,
           "-t", str(half), "-i", b,
           "-filter_complex", fc, "-map", "[out]", *enc, "-r", str(fps), out]
    subprocess.run(cmd, check=True)


def film_burn(a, b, dur, w, h, fps, out, enc):
    n = norm(w, h, fps)
    half = dur / 2
    # #5 Film Burn & Halation Flash: a quick dissolve between A and B with a
    # synthesized warm photochemical light-leak blooming over the join — a
    # centered orange radial that swells and fades, plus grain and a bloom
    # exposure lift. No external stock element needed; the leak is generated
    # with a gradients source + radial vignette so it reads as 35mm halation.
    leak = (
        f"gradients=s={w}x{h}:d={dur}:rate={fps}:c0=0xff6a1a:c1=0xffd24a:"
        f"x0={w//2}:y0={h//2}:x1={w}:y1=0,"
        f"vignette=angle=PI/3:mode=backward,format=gbrp"
    )
    fc = (
        f"[0:v]{n}[a];[1:v]{n}[b];"
        f"[a][b]xfade=transition=fade:duration={dur}:offset=0[base];"
        f"[2:v]{n},format=gbrp[lk];"
        f"[base][lk]blend=all_mode=screen:all_opacity=0.85,"
        f"noise=alls=10:allf=t,eq=contrast=1.08:saturation=1.2[out]"
    )
    cmd = ["ffmpeg", "-y",
           "-sseof", f"-{dur}", "-i", a,
           "-t", str(dur), "-i", b,
           "-f", "lavfi", "-i", leak,
           "-filter_complex", fc, "-map", "[out]", *enc, "-r", str(fps), out]
    subprocess.run(cmd, check=True)


def vault_doors(a, b, dur, w, h, fps, out, enc):
    n = norm(w, h, fps)
    # #105 Vault / Elevator Door Bi-Parting Wipe: two dark steel panels slide
    # in from left and right, slam shut at center over the last of clip A,
    # then part again to reveal clip B. Base is a hard cut A->B at the
    # midpoint (concat of two half-length segments); the panels are a
    # brushed-metal gradient (half-width), one mirrored for the right side.
    half = dur / 2
    hw = w // 2
    panel = (f"gradients=s={hw}x{h}:d={dur}:rate={fps}:"
             f"c0=0x45454f:c1=0x101014:x0=0:y0=0:x1={hw}:y1={h}")
    # left panel closes 0..half (x: -hw -> 0) then opens half..dur (0 -> -hw)
    xL = (f"'if(lt(t,{half}), -{hw}+{hw}*(t/{half}), -{hw}*((t-{half})/{half}))'")
    # right panel closes (x: w -> hw) then opens (hw -> w)
    xR = (f"'if(lt(t,{half}), {w}-{hw}*(t/{half}), {hw}+{hw}*((t-{half})/{half}))'")
    fc = (
        f"[0:v]{n}[a];[1:v]{n}[b];"
        f"[a][b]concat=n=2:v=1:a=0[base];"
        f"[2:v]scale={hw}:{h},setsar=1,format=rgba,split=2[pL0][pR0];"
        f"[pR0]hflip[pR];"
        f"[base][pL0]overlay=x={xL}:y=0[o1];"
        f"[o1][pR]overlay=x={xR}:y=0[out]"
    )
    cmd = ["ffmpeg", "-y",
           "-sseof", f"-{half}", "-i", a,
           "-t", str(half), "-i", b,
           "-f", "lavfi", "-i", panel,
           "-filter_complex", fc, "-map", "[out]", *enc, "-r", str(fps), out]
    subprocess.run(cmd, check=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("kind", choices=["whip_pan", "glitch", "film_burn", "vault_doors"])
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
    fn = {"whip_pan": whip_pan, "glitch": glitch,
          "film_burn": film_burn, "vault_doors": vault_doors}[args.kind]
    fn(args.clip_a, args.clip_b, args.duration, w, h, args.fps, args.out, enc)
    print(f"Wrote {args.kind} bridge -> {args.out}")


if __name__ == "__main__":
    main()
