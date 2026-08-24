#!/usr/bin/env python3
"""
Reads manifest/manifest.json + a cutlist, dispatches each transition's
render job to the right engine (Blender/Remotion/HyperFrames), runs them
concurrently across a worker pool, then calls ffmpeg/assemble.py once
everything the cutlist needs is on disk.

Concurrency default = os.cpu_count(). On this sandbox that's 4; on the
RX 9060 XT / Windows box it'll pick up however many cores that machine has.
Cap it explicitly with --concurrency if you want to leave headroom for
whatever else is running.

This only dispatches transitions with render_mode "baked" or "overlay" that
need an engine to actually produce something (baked -> full engine render;
overlay -> nothing to dispatch, the asset is expected to already exist).
"native" entries need nothing rendered — ffmpeg builds them directly at
assembly time.

Usage:
  python3 orchestrate.py --manifest manifest/manifest.json \\
      --cutlist ffmpeg/cutlist.example.json --clips-dir /path/to/clips \\
      --renders-dir renders/ --out master.mp4 [--concurrency N] [--software]

Each cutlist "transition_id" entry with a "baked_clip" path that doesn't
exist yet gets rendered by looking up that id's engine in the manifest:
  - blender     -> blender/render_transition.py (currently wired for #24's
                   fracture technique; swap the scene-build function for
                   other blender-bucket ids per manifest['note'])
  - remotion    -> remotion-app/render-transition.mjs, composition id must
                   match a registered Remotion composition (see
                   remotion-app/src/transitions/)
  - hyperframes -> the per-id project under hyperframes-scenes/<NNN-slug>/,
                   rendered via `hyperframes render --gpu --browser-gpu`
"""
import argparse
import concurrent.futures
import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent


def load_manifest(path):
    with open(path) as f:
        data = json.load(f)
    return {t["id"]: t for t in data["transitions"]}


def dispatch_blender(transition, clip_a, clip_b, out_path, duration, fps, resolution):
    # wired for #24 Glass Fracture's scene-build function today; other
    # blender-bucket ids need their own build_shard_plane()-equivalent
    # swapped in per the manifest's "note" field (fluid sim, cloth, rig...).
    script = REPO_ROOT / "blender" / "render_transition.py"
    cmd = [
        "blender", "--background", "--factory-startup", "--python", str(script), "--",
        "--clip-a", clip_a, "--clip-b", clip_b,
        "--duration", str(duration), "--fps", str(fps), "--resolution", resolution,
        "--out", str(Path(out_path).with_suffix("")) + "_",
    ]
    return cmd


def dispatch_remotion(transition, clip_a, clip_b, out_path, composition_id, concurrency):
    script = REPO_ROOT / "remotion-app" / "render-transition.mjs"
    cmd = [
        "node", str(script),
        "--composition-id", composition_id,
        "--clip-a", clip_a, "--clip-b", clip_b,
        "--out", str(out_path),
    ]
    if concurrency:
        cmd += ["--concurrency", str(concurrency)]
    return cmd


def dispatch_hyperframes(transition, project_dir, out_path, clip_a, clip_b):
    cmd = [
        "npx", "hyperframes", "render", "--gpu", "--browser-gpu",
        "--variables", json.dumps({"clipA": clip_a, "clipB": clip_b}),
        "-o", str(out_path),
        str(project_dir),
    ]
    return cmd


def run_job(cmd, cwd=None):
    print("Running:", " ".join(cmd))
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"FAILED: {' '.join(cmd)}\n{result.stdout[-2000:]}\n{result.stderr[-2000:]}", file=sys.stderr)
        raise RuntimeError(f"job failed: {' '.join(cmd)}")
    return result


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--manifest", required=True)
    p.add_argument("--cutlist", required=True)
    p.add_argument("--renders-dir", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--concurrency", type=int, default=os.cpu_count())
    p.add_argument("--software", action="store_true")
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--resolution", default="1920x1080")
    args = p.parse_args()

    manifest = load_manifest(args.manifest)
    with open(args.cutlist) as f:
        cutlist = json.load(f)

    # --renders-dir just needs to exist as a convenience default for cutlist
    # authors to point baked_clip paths into — the cutlist's own baked_clip
    # value is the actual source of truth for where output goes, since
    # assemble.py resolves that same string later and the two must agree.
    Path(args.renders_dir).mkdir(parents=True, exist_ok=True)

    jobs = []
    seq = cutlist["sequence"]
    for i, item in enumerate(seq):
        if "transition_id" not in item or "baked_clip" not in item:
            continue
        out_path = Path(item["baked_clip"])
        out_path.parent.mkdir(parents=True, exist_ok=True)
        if out_path.exists():
            continue
        tid = item["transition_id"]
        t = manifest.get(tid)
        if t is None:
            print(f"WARNING: transition id {tid} not in manifest, skipping", file=sys.stderr)
            continue
        clip_a = seq[i - 1]["clip"]
        clip_b = seq[i + 1]["clip"]
        duration = item.get("duration", 1.0)

        if t["engine"] == "blender":
            cmd = dispatch_blender(t, clip_a, clip_b, out_path, duration, args.fps, args.resolution)
        elif t["engine"] == "remotion":
            composition_id = item.get("composition_id")
            if not composition_id:
                print(f"WARNING: transition {tid} needs 'composition_id' in the cutlist "
                      f"to dispatch to Remotion, skipping", file=sys.stderr)
                continue
            cmd = dispatch_remotion(t, clip_a, clip_b, out_path, composition_id, None)
        elif t["engine"] == "hyperframes":
            project_dir = item.get("hyperframes_project")
            if not project_dir:
                print(f"WARNING: transition {tid} needs 'hyperframes_project' in the cutlist "
                      f"to dispatch to HyperFrames, skipping", file=sys.stderr)
                continue
            cmd = dispatch_hyperframes(t, project_dir, out_path, clip_a, clip_b)
        else:
            continue  # ffmpeg-native entries need nothing dispatched
        jobs.append(cmd)

    if jobs:
        print(f"Dispatching {len(jobs)} render job(s) across {args.concurrency} workers...")
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            futures = [pool.submit(run_job, cmd) for cmd in jobs]
            for f in concurrent.futures.as_completed(futures):
                f.result()  # re-raises on failure
    else:
        print("No render jobs needed — all baked clips already on disk (or cutlist has none).")

    assemble_cmd = [
        sys.executable, str(REPO_ROOT / "ffmpeg" / "assemble.py"),
        "--cutlist", args.cutlist, "--out", args.out,
    ]
    if args.software:
        assemble_cmd.append("--software")
    print("Assembling final output...")
    subprocess.run(assemble_cmd, check=True)


if __name__ == "__main__":
    main()
