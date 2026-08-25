#!/usr/bin/env python3
"""Break a video down into what Claude needs to actually 'watch' it closely:
shot-boundary frames, dense uniform-sampled frames, an audio waveform image,
and silence intervals — all via ffmpeg/ffprobe, no external API required.

Usage:
  python3 extract_frames.py <video_path> [output_dir] [--scene-threshold 0.35] [--max-uniform-frames 40]

Writes <output_dir>/manifest.json describing everything it produced.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def probe(video_path):
    result = run([
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(video_path),
    ])
    if result.returncode != 0:
        sys.exit(f"ffprobe failed: {result.stderr}")
    data = json.loads(result.stdout)
    fmt = data["format"]
    video_stream = next((s for s in data["streams"] if s["codec_type"] == "video"), None)
    audio_stream = next((s for s in data["streams"] if s["codec_type"] == "audio"), None)
    if video_stream is None:
        sys.exit("No video stream found.")
    num, den = (video_stream.get("r_frame_rate") or "0/1").split("/")
    fps = float(num) / float(den) if float(den) else 0.0
    return {
        "duration": float(fmt["duration"]),
        "width": video_stream.get("width"),
        "height": video_stream.get("height"),
        "fps": round(fps, 3),
        "has_audio": audio_stream is not None,
        "codec": video_stream.get("codec_name"),
    }


def extract_scene_changes(video_path, out_dir, threshold, duration):
    """Grab one frame at every detected shot boundary — this is what actually
    separates 'watching' a video from skimming a filmstrip: cuts are where
    composition, subject, and pacing all change at once."""
    pattern = out_dir / "scene_%04d.png"
    result = run([
        "ffmpeg", "-y", "-i", str(video_path),
        "-vf", f"select='gt(scene,{threshold})',showinfo",
        "-vsync", "vfr", str(pattern),
    ])
    timestamps = []
    for line in result.stderr.splitlines():
        m = re.search(r"pts_time:([\d.]+)", line)
        if m and "showinfo" in line:
            timestamps.append(float(m.group(1)))
    frames = sorted(out_dir.glob("scene_*.png"))
    scenes = []
    for f, t in zip(frames, timestamps):
        new_name = out_dir / f"scene_t{t:07.2f}.png"
        f.rename(new_name)
        scenes.append({"file": new_name.name, "timestamp": round(t, 2)})
    # Always include frame 0 as the first shot's start, even if scene detection missed it.
    if not any(s["timestamp"] < 0.5 for s in scenes):
        first = out_dir / "scene_t0000.00.png"
        run(["ffmpeg", "-y", "-ss", "0", "-i", str(video_path), "-frames:v", "1", str(first)])
        if first.exists():
            scenes.insert(0, {"file": first.name, "timestamp": 0.0})
    return sorted(scenes, key=lambda s: s["timestamp"])


def extract_uniform_frames(video_path, out_dir, duration, max_frames, scene_timestamps):
    """Dense, evenly-spaced sampling to catch motion, camera movement, and pacing
    *within* a shot, not just at cuts. Frame count scales with duration but is
    capped so a long video doesn't produce an unreadable flood of images."""
    n = max(8, min(max_frames, round(duration * 2)))
    interval = duration / n
    saved = []
    for i in range(n):
        t = round(i * interval, 2)
        # Skip anything within 0.3s of a scene-cut frame we already have — no point duplicating.
        if any(abs(t - st) < 0.3 for st in scene_timestamps):
            continue
        out_path = out_dir / f"frame_t{t:07.2f}.png"
        run(["ffmpeg", "-y", "-ss", str(t), "-i", str(video_path), "-frames:v", "1", str(out_path)])
        if out_path.exists():
            saved.append({"file": out_path.name, "timestamp": t})
    return saved


def extract_audio(video_path, out_dir, has_audio, duration):
    if not has_audio:
        return {"waveform_image": None, "audio_file": None, "silence_intervals": []}

    waveform_path = out_dir / "waveform.png"
    width = max(800, min(3000, int(duration * 100)))
    run([
        "ffmpeg", "-y", "-i", str(video_path),
        "-filter_complex", f"[0:a]showwavespic=s={width}x300:colors=white",
        "-frames:v", "1", str(waveform_path),
    ])

    audio_path = out_dir / "audio.wav"
    run(["ffmpeg", "-y", "-i", str(video_path), "-vn", "-ac", "1", "-ar", "16000", str(audio_path)])

    # silencedetect gives objective quiet/loud structure without needing transcription.
    result = run([
        "ffmpeg", "-i", str(video_path), "-af", "silencedetect=noise=-30dB:d=0.3",
        "-f", "null", "-",
    ])
    intervals = []
    start = None
    for line in result.stderr.splitlines():
        if "silence_start" in line:
            m = re.search(r"silence_start:\s*([\d.]+)", line)
            if m:
                start = float(m.group(1))
        elif "silence_end" in line and start is not None:
            m = re.search(r"silence_end:\s*([\d.]+)", line)
            if m:
                intervals.append({"start": round(start, 2), "end": round(float(m.group(1)), 2)})
                start = None

    return {
        "waveform_image": waveform_path.name if waveform_path.exists() else None,
        "audio_file": audio_path.name if audio_path.exists() else None,
        "silence_intervals": intervals,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video_path")
    parser.add_argument("output_dir", nargs="?", default=None)
    parser.add_argument("--scene-threshold", type=float, default=0.35,
                         help="Lower = more sensitive to cuts (more scene frames). 0.2-0.4 is typical.")
    parser.add_argument("--max-uniform-frames", type=int, default=40)
    args = parser.parse_args()

    video_path = Path(args.video_path).resolve()
    if not video_path.exists():
        sys.exit(f"Video not found: {video_path}")

    out_dir = Path(args.output_dir) if args.output_dir else video_path.parent / f"{video_path.stem}_analysis"
    out_dir.mkdir(parents=True, exist_ok=True)

    meta = probe(video_path)
    scenes = extract_scene_changes(video_path, out_dir, args.scene_threshold, meta["duration"])
    scene_ts = [s["timestamp"] for s in scenes]
    uniform = extract_uniform_frames(video_path, out_dir, meta["duration"], args.max_uniform_frames, scene_ts)
    audio = extract_audio(video_path, out_dir, meta["has_audio"], meta["duration"])

    all_frames = sorted(scenes + uniform, key=lambda f: f["timestamp"])
    manifest = {
        "video": str(video_path),
        "output_dir": str(out_dir),
        "metadata": meta,
        "scene_cut_count": len(scenes),
        "frames": all_frames,
        "audio": audio,
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))

    print(f"Extracted {len(scenes)} scene-cut frames + {len(uniform)} uniform-sampled frames "
          f"({len(all_frames)} total) to {out_dir}")
    if audio["waveform_image"]:
        print(f"Audio: waveform -> {audio['waveform_image']}, "
              f"{len(audio['silence_intervals'])} silence interval(s) detected")
    else:
        print("Audio: no audio stream in this file")
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()
