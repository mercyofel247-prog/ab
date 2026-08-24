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


def shatter_to_shards(plane, n_frames, hold_frac=0.18):
    """Splits the subdivided plane into shard objects and KEYFRAME-animates
    each one exploding outward with spin, gravity droop, and shrink — a
    deliberate, readable shatter rather than a physics sim.

    Earlier this used rigid-body physics AND manual keyframes at once, which
    conflict: the sim overrode the keyframes and the shards barely moved, so
    the whole thing read as a soft dissolve instead of a shatter. Pure
    keyframe animation is both more dramatic (full control over trajectory,
    spin, and timing) and far faster on CPU (no sim bake).

    Motion: the plate holds intact for `hold_frac` of the shot (anticipation),
    then every shard bursts away from screen center — direction = its own
    offset from center, so they fan out — flying toward and past the camera
    (−Y) with random spin and an accelerating downward drift, shrinking as
    they go so clip B behind is fully revealed by the end."""
    bpy.context.view_layer.objects.active = plane
    plane.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")

    shards = [o for o in bpy.context.selected_objects]
    hold = max(1, int(n_frames * hold_frac))

    for obj in shards:
        # set origin to the shard's own geometry so it spins about itself
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="MEDIAN")
        ox, oy, oz = obj.location  # centroid, relative to screen center at (0,*,~0)

        # outward direction in the screen plane (x horizontal, z vertical)
        import math
        dx, dz = ox, oz
        mag = math.hypot(dx, dz) or 0.001
        dx, dz = dx / mag, dz / mag
        spread = 6.5 + random.uniform(0, 4)          # how far it flies sideways
        toward_cam = 9.0 + random.uniform(0, 6)      # −Y, past the lens
        spin = [random.uniform(-8, 8) for _ in range(3)]

        start_loc = obj.location.copy()
        start_rot = obj.rotation_euler.copy()

        # hold intact
        obj.keyframe_insert(data_path="location", frame=hold)
        obj.keyframe_insert(data_path="rotation_euler", frame=hold)
        obj.keyframe_insert(data_path="scale", frame=hold)

        # burst to final
        obj.location = (
            start_loc.x + dx * spread + random.uniform(-1.5, 1.5),
            start_loc.y - toward_cam,
            start_loc.z + dz * spread - 3.0,  # gravity droop
        )
        obj.rotation_euler = (
            start_rot.x + spin[0], start_rot.y + spin[1], start_rot.z + spin[2],
        )
        obj.scale = (0.5, 0.5, 0.5)
        obj.keyframe_insert(data_path="location", frame=n_frames)
        obj.keyframe_insert(data_path="rotation_euler", frame=n_frames)
        obj.keyframe_insert(data_path="scale", frame=n_frames)

        # ease-in so the burst accelerates out of the hold (snappy)
        if obj.animation_data and obj.animation_data.action:
            for fc in obj.animation_data.action.fcurves:
                for kp in fc.keyframe_points:
                    kp.interpolation = "SINE" if kp.co[0] == hold else "QUAD"
                    kp.easing = "EASE_IN"
    return shards


def add_impact_flash(n_frames, z=0.2):
    """A white emission plane that pops on the shatter frame and fades —
    the light spike that sells the impact."""
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 0, z))
    flash = bpy.context.active_object
    flash.name = "impact_flash"
    flash.scale = (14, 9, 1)
    flash.rotation_euler = (1.5708, 0, 0)
    mat = bpy.data.materials.new("flash_mat")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    emit = nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (1, 1, 1, 1)
    transp = nodes.new("ShaderNodeBsdfTransparent")
    mix = nodes.new("ShaderNodeMixShader")
    links.new(transp.outputs["BSDF"], mix.inputs[1])
    links.new(emit.outputs["Emission"], mix.inputs[2])
    links.new(mix.outputs["Shader"], out.inputs["Surface"])
    mat.blend_method = "BLEND"
    flash.data.materials.append(mat)

    hold = max(1, int(n_frames * 0.18))
    fac = mix.inputs["Fac"]
    fac.default_value = 0.0
    fac.keyframe_insert("default_value", frame=max(1, hold - 1))
    fac.default_value = 0.9
    fac.keyframe_insert("default_value", frame=hold)
    fac.default_value = 0.0
    fac.keyframe_insert("default_value", frame=min(n_frames, hold + 5))
    return flash


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
    shatter_to_shards(front, n_frames)
    add_impact_flash(n_frames)

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
