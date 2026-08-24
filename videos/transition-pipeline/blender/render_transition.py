#!/usr/bin/env python3
"""
Blender driver for transition #24 "Glass Fracture & Screen Shatter" (blender
bucket, rigid-body fracture, render_mode=baked in manifest.json).

Builds the whole scene from scratch via bpy (no pre-authored .blend needed,
so it's portable across machines) — two video-textured planes, the front one
subdivided into shards with rigid-body physics that shatter outward under an
explosion force, revealing the plane behind it (clip B) as the shards clear
frame. Renders a single self-contained clip that bridges both source clips
(render_mode=baked -> straight concat at ffmpeg assembly, no compositing).

GPU: sets Cycles compute_device_type to HIP and enables every HIP device
found (RDNA1+; RX 9060 XT is RDNA4 so this engages). HIP-RT (hardware ray
tracing) is enabled defensively via getattr/try-except because the exact
scene.cycles attribute name has moved between Blender versions — if it's not
present on your local Blender build, HIP compute still applies, you just
don't get the HIP-RT ray-tracing acceleration on top. Verify in
Edit > Preferences > System > Cycles Render Devices that the 9060 XT is
listed and checked before a full-res run.

Usage (run locally where the GPU actually exists):
  blender --background --factory-startup --python render_transition.py -- \\
      --clip-a /path/to/sceneA.mp4 --clip-b /path/to/sceneB.mp4 \\
      --duration 1.0 --fps 30 --resolution 1920x1080 \\
      --out /path/to/renders/024_glass_fracture/frame_

This is a *template* for the blender-bucket entries in manifest.json (47 of
the 140 transitions) — the shard-fracture technique here is the one that
needed physics; the other blender entries (fluid sims, cloth, character
rigs, PBR props) swap out build_shard_plane() for the matching bpy
technique but reuse everything else (video-texture planes, HIP device
setup, render settings).
"""
import argparse
import random
import sys

import bpy


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    p = argparse.ArgumentParser()
    p.add_argument("--clip-a", required=True, help="video that shatters away (front plane)")
    p.add_argument("--clip-b", required=True, help="video revealed behind it")
    p.add_argument("--duration", type=float, default=1.0, help="transition length in seconds")
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--resolution", default="1920x1080")
    p.add_argument("--shards-x", type=int, default=10)
    p.add_argument("--shards-y", type=int, default=6)
    p.add_argument("--samples", type=int, default=96, help="Cycles samples; denoiser makes this fine")
    p.add_argument("--out", required=True, help="output frame path prefix, e.g. renders/024_/frame_")
    return p.parse_args(argv)


def setup_gpu():
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "HIP"
    except TypeError:
        print("WARNING: HIP not offered by this Blender build/driver — falling back to CPU. "
              "Check AMD driver + Blender version (RDNA4 needs a recent 4.x build).", file=sys.stderr)
        return
    prefs.get_devices()
    for d in prefs.devices:
        d.use = (d.type == "HIP")
        print(f"Cycles device: {d.name} ({d.type}) use={d.use}")

    scene = bpy.context.scene
    scene.cycles.device = "GPU"

    # HIP-RT toggle: attribute name has moved across Blender releases, so
    # probe defensively rather than assume one path.
    for attr in ("cycles_hip_rt", "use_hiprt", "hip_rt"):
        if hasattr(scene.cycles, attr):
            setattr(scene.cycles, attr, True)
            print(f"Enabled HIP-RT via scene.cycles.{attr}")
            return
    print("NOTE: could not find a HIP-RT toggle on this Blender build — "
          "HIP compute still applies, just without RT acceleration. "
          "Check Render Properties > Cycles > Device on your local install.")


def make_video_plane(name, video_path, z, width=16.0):
    img = bpy.data.images.load(video_path)
    img.source = "MOVIE"
    aspect = img.size[1] / img.size[0] if img.size[0] else 9 / 16
    height = width * aspect

    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 0, z))
    plane = bpy.context.active_object
    plane.name = name
    plane.scale = (width / 2, height / 2, 1)
    plane.rotation_euler = (1.5708, 0, 0)  # face camera down +Y

    mat = bpy.data.materials.new(f"{name}_mat")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.image_user.use_auto_refresh = True
    tex.image_user.frame_duration = img.frame_duration
    links.new(tex.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], out.inputs["Surface"])
    plane.data.materials.append(mat)
    return plane, tex


def build_shard_plane(video_path, shards_x, shards_y, z, width=16.0):
    """Subdivides a video-textured plane into shards, gives each rigid-body
    physics with a random outward impulse — the shatter itself."""
    plane, tex = make_video_plane("clip_a_shatter", video_path, z, width)

    bpy.ops.object.mode_set(mode="EDIT")
    import bmesh
    bm = bmesh.from_edit_mesh(plane.data)
    bmesh.ops.subdivide_edges(
        bm, edges=bm.edges[:], cuts=max(shards_x, shards_y),
        use_grid_fill=True,
    )
    bmesh.update_edit_mesh(plane.data)
    bpy.ops.object.mode_set(mode="OBJECT")
    return plane, tex


def shatter_to_shards(plane):
    """Splits the subdivided plane into individual shard objects and gives
    each one rigid-body physics with a random outward velocity."""
    bpy.context.view_layer.objects.active = plane
    plane.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")

    shards = [o for o in bpy.context.selected_objects]
    if not bpy.context.scene.rigidbody_world:
        bpy.ops.rigidbody.world_add()
    for obj in shards:
        bpy.context.view_layer.objects.active = obj
        bpy.ops.rigidbody.object_add(type="ACTIVE")
        obj.rigid_body.mass = 0.05
        obj.rigid_body.collision_shape = "CONVEX_HULL"
        # random outward impulse so shards fly apart in different directions
        obj.rigid_body.kinematic = False
        vx = random.uniform(-3, 3)
        vy = random.uniform(-6, -2)  # away from camera, toward clip B side
        vz = random.uniform(-1, 3)
        obj.keyframe_insert(data_path="location", frame=1)
        obj.location.x += vx * 0.05
        obj.location.y += vy * 0.05
        obj.location.z += vz * 0.05
        obj.keyframe_insert(data_path="location", frame=2)
    return shards


def main():
    args = parse_args()
    w, h = (int(x) for x in args.resolution.lower().split("x"))
    n_frames = max(2, round(args.duration * args.fps))

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.fps = args.fps
    scene.frame_start = 1
    scene.frame_end = n_frames
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True  # OIDN — cuts required samples a lot
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = args.out

    setup_gpu()

    bpy.ops.object.camera_add(location=(0, -12, 0), rotation=(1.5708, 0, 0))
    scene.camera = bpy.context.active_object

    bpy.ops.object.light_add(type="SUN", location=(0, -5, 5))
    bpy.context.active_object.data.energy = 3.0

    make_video_plane("clip_b_behind", args.clip_b, z=0.0)
    front, _ = build_shard_plane(args.clip_a, args.shards_x, args.shards_y, z=0.1)
    shatter_to_shards(front)

    try:
        bpy.ops.render.render(animation=True)
    except RuntimeError as e:
        if "OpenImageDenoiser" in str(e) and scene.cycles.use_denoising:
            print("WARNING: this Blender build has no OpenImageDenoise — "
                  "disabling denoising and re-rendering. Samples will need to "
                  "be higher for a clean image; the official blender.org build "
                  "includes OIDN, so this shouldn't trigger on a normal local install.",
                  file=sys.stderr)
            scene.cycles.use_denoising = False
            bpy.ops.render.render(animation=True)
        else:
            raise
    print(f"Rendered {n_frames} frames to {args.out}*.png")


if __name__ == "__main__":
    main()
