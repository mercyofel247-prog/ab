"""
Oxblood Microscope-Slide Hero — co-equal Mode B Blender build (v2.32).

Builds the entire scene as real 3D geometry with PBR materials, F-curve motion
on non-linear Bezier interpolation, a Cycles alpha (transparent-film) render,
and a compositor Fog-Glow bloom pass for the emissive oxblood spike.

Scene : 1920x1080 @ 24fps, strict 16:9, 72 frames (0..72 == 3.0s).
Run   : blender -b -P build_scene.py -- [--engine CYCLES|BLENDER_EEVEE]
                                         [--samples N] [--test FRAME]
                                         [--save path.blend]

The hero is the ONLY non-neutral element: the oxblood #7A160E data-spike, an
EMISSIVE mesh line (never a flat fill). Everything else sits in the cold,
machined-metal register.
"""

import bpy
import sys
import math
from mathutils import Vector

# --------------------------------------------------------------------------- #
#  CLI args (everything after the "--")                                       #
# --------------------------------------------------------------------------- #
argv = sys.argv
argv = argv[argv.index("--") + 1:] if "--" in argv else []


def arg(flag, default=None):
    if flag in argv:
        i = argv.index(flag)
        return argv[i + 1] if i + 1 < len(argv) else True
    return default


ENGINE = arg("--engine", "CYCLES")
SAMPLES = int(arg("--samples", 64))
TEST_FRAME = arg("--test", None)
SAVE_PATH = arg("--save", None)

# --------------------------------------------------------------------------- #
#  Timeline — ms -> frame @ 24fps                                             #
# --------------------------------------------------------------------------- #
FPS = 24
F_START = 0          # 0 ms
F_SETTLE = 14        # 600 ms  — slide settled / under-light up
F_GROW_END = 36      # 1500 ms — spike fully grown, LAND sync frame ("winners")
F_LAND_PEAK = 38     # 1583 ms — impact overshoot peak
F_LAND_END = 40      # 1650 ms — land settled
F_SUSTAIN_END = 62   # 2600 ms — sustained push ends
F_END = 72           # 3000 ms — exit hold (HOLD-not-fade)

OXBLOOD = (0.478, 0.086, 0.055)  # #7A160E linear-ish; set as sRGB below

# --------------------------------------------------------------------------- #
#  Helpers                                                                    #
# --------------------------------------------------------------------------- #

def srgb_to_linear(c):
    return tuple((((v + 0.055) / 1.055) ** 2.4) if v > 0.04045 else v / 12.92
                 for v in c)


HEX = {
    "oxblood": (0x7A / 255, 0x16 / 255, 0x0E / 255),
    "metal":   (0x15 / 255, 0x16 / 255, 0x18 / 255),   # dark machined metal
    "metal_hi": (0x2a / 255, 0x2c / 255, 0x30 / 255),
    "specimen": (0x08 / 255, 0x0a / 255, 0x0e / 255),
    "caption": (0xcf / 255, 0xd4 / 255, 0xda / 255),   # cold off-white
    "baseline": (0x20 / 255, 0x22 / 255, 0x26 / 255),
}
LIN = {k: srgb_to_linear(v) for k, v in HEX.items()}


def wipe():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def set_input(node, names, value):
    """Set a node input by trying several possible socket names (API drift)."""
    if isinstance(names, str):
        names = [names]
    for n in names:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return True
    return False


def new_principled(name, base_color, metallic=0.0, roughness=0.5,
                   transmission=0.0, ior=1.45, emission_color=None,
                   emission_strength=0.0, anisotropic=0.0, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    set_input(bsdf, "Base Color", (*base_color, 1.0))
    set_input(bsdf, "Metallic", metallic)
    set_input(bsdf, "Roughness", roughness)
    set_input(bsdf, ["Transmission Weight", "Transmission"], transmission)
    set_input(bsdf, "IOR", ior)
    set_input(bsdf, ["Anisotropic", "Anisotropy"], anisotropic)
    set_input(bsdf, "Alpha", alpha)
    if emission_color is not None:
        set_input(bsdf, ["Emission Color", "Emission"], (*emission_color, 1.0))
        set_input(bsdf, "Emission Strength", emission_strength)
    # EEVEE screen-space refraction support for glass
    if transmission > 0.5:
        mat.use_screen_refraction = True
        try:
            mat.refraction_depth = 0.02
        except Exception:
            pass
    return mat


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def bezierize(obj, easing_map=None):
    """Force every f-curve to non-linear Bezier, AUTO_CLAMPED handles.

    easing_map: optional {data_path: 'EASE_IN'|'EASE_OUT'|'EASE_IN_OUT'}.
    """
    ad = obj.animation_data
    if not ad or not ad.action:
        return
    for fc in ad.action.fcurves:
        ease = (easing_map or {}).get(fc.data_path)
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
            kp.handle_left_type = 'AUTO_CLAMPED'
            kp.handle_right_type = 'AUTO_CLAMPED'
            if ease:
                kp.easing = ease
        fc.update()


# --------------------------------------------------------------------------- #
#  Scene / render config                                                      #
# --------------------------------------------------------------------------- #

def configure_scene():
    scene = bpy.context.scene
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.frame_start = F_START
    scene.frame_end = F_END
    scene.render.film_transparent = True            # alpha / transparent film

    if ENGINE == "CYCLES":
        scene.render.engine = 'CYCLES'
        scene.cycles.device = 'CPU'
        scene.cycles.samples = SAMPLES
        # This Blender build ships without OpenImageDenoise, so lean on
        # adaptive sampling instead of a denoiser to keep noise down.
        scene.cycles.use_denoising = False
        scene.cycles.use_adaptive_sampling = True
        scene.cycles.adaptive_threshold = 0.01
        scene.cycles.caustics_reflective = True
        scene.cycles.caustics_refractive = True
        scene.cycles.max_bounces = 12
        scene.cycles.transmission_bounces = 12
        scene.cycles.transparent_max_bounces = 12
        # tame fireflies from the glass/emissive without a denoiser
        scene.cycles.sample_clamp_indirect = 8.0
        scene.cycles.blur_glossy = 1.0
    else:
        scene.render.engine = 'BLENDER_EEVEE'
        ee = scene.eevee
        ee.taa_render_samples = max(SAMPLES, 64)
        ee.use_ssr = True
        ee.use_ssr_refraction = True
        ee.use_gtao = True
        try:
            ee.use_bloom = True
            ee.bloom_intensity = 0.04
        except Exception:
            pass

    # sRGB / Filmic-style view transform for a cinematic register
    scene.view_settings.view_transform = 'Filmic'
    scene.view_settings.look = 'Medium Contrast'

    # timeline marker for the audio-synced LAND (sub-boom + bloom wash)
    mk = scene.timeline_markers.new("LAND_subboom_f36", frame=F_GROW_END)
    return scene


# --------------------------------------------------------------------------- #
#  Geometry                                                                   #
# --------------------------------------------------------------------------- #

def add_box(name, size, location, bevel=0.0, segments=2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.name = name
    # size=1 cube has edge length 1 (verts +/-0.5); scale by size for full edge
    obj.scale = (size[0], size[1], size[2])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        m = obj.modifiers.new("bevel", 'BEVEL')
        m.width = bevel
        m.segments = segments
        m.limit_method = 'ANGLE'
    return obj


def shade_smooth(obj):
    for p in obj.data.polygons:
        p.use_smooth = True


def build_slide_hero(slide_root):
    """Dark brushed-metal frame + refractive glass plate + low-poly specimen
    + oxblood emissive data-spike. Slide lies in the X(width)-Z(height) plane,
    thin along Y; camera views from -Y. Spike grows +Z ("upward along graph").
    Width ~8 units -> locked to ~80% frame width by the camera.
    """
    W, H = 8.0, 2.6          # glass plate width (X), height (Z)
    GLASS_T = 0.18           # glass thickness (Y)
    BORDER = 0.42            # metal frame border
    FRAME_T = 0.55           # metal frame depth (Y)

    mat_metal = new_principled("M_MetalFrame", LIN["metal"], metallic=0.9,
                               roughness=0.35, anisotropic=0.6)
    mat_metal_hi = new_principled("M_MetalEdge", LIN["metal_hi"], metallic=0.92,
                                  roughness=0.28, anisotropic=0.5)
    mat_glass = new_principled("M_Glass", (0.92, 0.95, 0.97), metallic=0.0,
                               roughness=0.02, transmission=1.0, ior=1.46)
    mat_spec = new_principled("M_Specimen", LIN["specimen"], metallic=0.15,
                              roughness=0.65)
    mat_bar = new_principled("M_DataBar", LIN["baseline"], metallic=0.85,
                             roughness=0.4)

    oxb = LIN["oxblood"]
    mat_spike = new_principled("M_OxbloodSpike", oxb, metallic=0.0,
                               roughness=0.3,
                               emission_color=oxb, emission_strength=2.0)

    # --- metal backing tray (set well behind glass so the specimen sits in
    #     front of it and reads through the glass) ---
    back = add_box("MetalBacking", (W + 2 * BORDER, 0.35, H + 2 * BORDER),
                   (0, 0.62, 0), bevel=0.06, segments=3)
    assign(back, mat_metal)
    shade_smooth(back)
    back.parent = slide_root

    # --- four beveled metal frame rails around the glass ---
    rails = []
    hx = W / 2 + BORDER / 2
    hz = H / 2 + BORDER / 2
    rails.append(add_box("RailTop", (W + 2 * BORDER, FRAME_T, BORDER),
                         (0, 0, hz), bevel=0.05, segments=3))
    rails.append(add_box("RailBot", (W + 2 * BORDER, FRAME_T, BORDER),
                         (0, 0, -hz), bevel=0.05, segments=3))
    rails.append(add_box("RailL", (BORDER, FRAME_T, H),
                         (-hx, 0, 0), bevel=0.05, segments=3))
    rails.append(add_box("RailR", (BORDER, FRAME_T, H),
                         (hx, 0, 0), bevel=0.05, segments=3))
    for r in rails:
        assign(r, mat_metal_hi)
        shade_smooth(r)
        r.parent = slide_root

    # --- glass plate (real refractive material) ---
    glass = add_box("GlassPlate", (W, GLASS_T, H), (0, 0, 0), bevel=0.015,
                    segments=2)
    assign(glass, mat_glass)
    shade_smooth(glass)
    glass.parent = slide_root

    # --- trapped specimen: simple low-poly human form, under the glass ---
    specimen = build_specimen(mat_spec)
    specimen.parent = slide_root
    # stand the figure behind the glass, feet near the interior floor, centred
    specimen.location = (0, GLASS_T / 2 + 0.12, -H / 2 + 0.18)
    specimen.scale = (1.02, 1.02, 1.02)

    # --- the data: a short row of neutral bars + the tall oxblood spike ---
    baseline = add_box("GraphBaseline", (W * 0.82, 0.04, 0.05),
                       (0, -GLASS_T / 2 - 0.03, -H / 2 + 0.22), bevel=0.01)
    assign(baseline, mat_bar)
    baseline.parent = slide_root

    # neutral loser-bars (short), placed left of the winner
    bar_heights = [0.35, 0.55, 0.42, 0.7, 0.5]
    bar_x = [-3.0, -2.2, -1.4, -0.6, 0.2]
    base_z = -H / 2 + 0.22
    for i, (bh, bx) in enumerate(zip(bar_heights, bar_x)):
        b = add_box(f"Bar_{i}", (0.22, 0.12, bh),
                    (bx, -GLASS_T / 2 - 0.08, base_z + bh / 2), bevel=0.015)
        assign(b, mat_bar)
        shade_smooth(b)
        b.parent = slide_root

    # --- THE oxblood winner spike: thin emissive line, origin at its base ---
    spike_h = 1.9
    spike = add_box("OxbloodSpike", (0.14, 0.14, spike_h),
                    (1.3, -GLASS_T / 2 - 0.09, base_z), bevel=0.02)
    # move origin to the bottom so scale-Z grows it upward
    spike.location.z = base_z
    for v in spike.data.vertices:
        v.co.z += spike_h / 2      # shift mesh up so base sits at origin
    assign(spike, mat_spike)
    shade_smooth(spike)
    spike.parent = slide_root

    return spike, mat_spike, specimen


def build_specimen(mat):
    """Simple low-poly standing human, built with feet at the world origin and
    thin along Y so it faces the camera (which looks along +Y). Origin is set
    to the feet for predictable placement, total local height ~2.0.
    """
    parts = []

    def prim(kind, **kw):
        if kind == 'ico':
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=kw.pop('sub', 2),
                                                  **kw)
        elif kind == 'cyl':
            bpy.ops.mesh.primitive_cylinder_add(vertices=kw.pop('verts', 8),
                                                **kw)
        elif kind == 'cube':
            bpy.ops.mesh.primitive_cube_add(**kw)
        o = bpy.context.active_object
        bpy.ops.object.transform_apply(location=False, rotation=True,
                                        scale=True)
        parts.append(o)
        return o

    # legs (span z 0.0 .. 0.85)
    for sx in (-0.15, 0.15):
        prim('cyl', verts=8, radius=0.085, depth=0.85, location=(sx, 0, 0.425))
    # torso — tapered slab (z 0.78 .. 1.55)
    t = prim('cube', size=1, location=(0, 0, 1.16))
    t.scale = (0.52, 0.26, 0.78)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    # neck
    prim('cyl', verts=8, radius=0.09, depth=0.16, location=(0, 0, 1.62))
    # head (z 1.45 .. 2.0)
    prim('ico', sub=2, radius=0.27, location=(0, 0, 1.78))
    # arms — angled slightly out, alongside the torso
    for sx, ang in ((-0.45, math.radians(14)), (0.45, math.radians(-14))):
        a = prim('cyl', verts=8, radius=0.07, depth=0.8, location=(sx, 0, 1.18))
        a.rotation_euler = (0, ang, 0)
        bpy.ops.object.transform_apply(location=False, rotation=True,
                                        scale=False)

    # join into one mesh
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    body = bpy.context.active_object
    body.name = "Specimen"
    # origin to the feet (world origin / 3D cursor at (0,0,0))
    bpy.context.scene.cursor.location = (0.0, 0.0, 0.0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    assign(body, mat)
    shade_smooth(body)
    return body


def build_caption():
    cur = bpy.data.curves.new("CaptionCurve", 'FONT')
    cur.body = "WINNERS"
    cur.align_x = 'CENTER'
    cur.align_y = 'CENTER'
    cur.extrude = 0.01
    cur.size = 0.42
    obj = bpy.data.objects.new("Caption", cur)
    bpy.context.collection.objects.link(obj)
    obj.location = (0, -0.9, -1.9)
    obj.rotation_euler = (math.radians(90), 0, 0)
    mat = new_principled("M_Caption", LIN["caption"], metallic=0.4,
                         roughness=0.4, emission_color=LIN["caption"],
                         emission_strength=1.2)
    assign(obj, mat)
    return obj


def build_ground():
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -2.4))
    g = bpy.context.active_object
    g.name = "GroundShadow"
    # soft contact shadow that composites onto the transparent film
    try:
        g.is_shadow_catcher = True
    except Exception:
        mat = new_principled("M_Ground", (0.02, 0.02, 0.025), roughness=0.9)
        assign(g, mat)
    return g


# --------------------------------------------------------------------------- #
#  Lighting                                                                   #
# --------------------------------------------------------------------------- #

def build_lights():
    # dark, faintly-cold world fill so the machined metal never crushes to pure
    # black at its core (the oxblood stays the only chromatic accent).
    world = bpy.data.worlds.new("W_Clinical")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.012, 0.014, 0.02, 1.0)
    bg.inputs["Strength"].default_value = 1.0
    bpy.context.scene.world = world

    # ONE directional key raking L -> R (points toward +X, slightly down/front)
    bpy.ops.object.light_add(type='SUN', location=(-6, -4, 5))
    key = bpy.context.active_object
    key.name = "KeyRake"
    key.data.energy = 3.6
    key.data.angle = math.radians(2.5)
    key.rotation_euler = (math.radians(58), math.radians(0), math.radians(-62))
    key.data.color = (1.0, 0.97, 0.93)

    # rim light grazing the metal edge (cool), from back-right
    bpy.ops.object.light_add(type='AREA', location=(7, 6, 3))
    rim = bpy.context.active_object
    rim.name = "RimMetal"
    rim.data.energy = 150
    rim.data.size = 3
    rim.data.color = (0.8, 0.86, 1.0)
    _point_at(rim, Vector((0, 0, 0)))

    # cold clinical under-light on the specimen (from below, -Z, in front)
    bpy.ops.object.light_add(type='AREA', location=(0, -2.2, -3.0))
    under = bpy.context.active_object
    under.name = "UnderLight"
    under.data.energy = 0.0        # fades up 0->full over f0-14
    under.data.size = 5
    under.data.color = (0.62, 0.78, 1.0)   # cold clinical blue
    _point_at(under, Vector((0, 0, 0)))

    # clinical transillumination panel BEHIND the specimen (between it and the
    # backing), facing the camera -> the specimen reads as a trapped silhouette
    # through the glass, like a lit microscope slide. Ramps up with UnderLight.
    bpy.ops.object.light_add(type='AREA', location=(0, 0.5, 0.0))
    box = bpy.context.active_object
    box.name = "SpecimenBackLight"
    box.data.type = 'AREA'
    box.data.shape = 'RECTANGLE'
    box.data.size = 11.0           # larger than the glass -> edges off-frame
    box.data.size_y = 4.2
    box.data.energy = 0.0          # fades up 0->full over f0-14
    box.data.color = (0.55, 0.72, 1.0)   # cold clinical blue
    box.data.spread = math.radians(60)
    box.rotation_euler = (math.radians(-90), 0, 0)  # face -Y (toward camera)

    return key, rim, under, box


def _point_at(obj, target):
    d = (obj.location - target)
    rot = d.to_track_quat('Z', 'Y').to_euler()
    obj.rotation_euler = rot


# --------------------------------------------------------------------------- #
#  Camera + rig                                                               #
# --------------------------------------------------------------------------- #

def build_camera():
    # rig empty (for shake) -> camera child; camera tracks target at origin
    rig = bpy.data.objects.new("CamRig", None)
    rig.empty_display_size = 0.3
    bpy.context.collection.objects.link(rig)

    bpy.ops.object.camera_add(location=(0, -15.6, 0.35))
    cam = bpy.context.active_object
    cam.name = "HeroCam"
    cam.data.lens = 52
    cam.data.sensor_width = 36
    cam.parent = rig

    target = bpy.data.objects.new("CamTarget", None)
    bpy.context.collection.objects.link(target)
    target.location = (0, 0, 0.05)
    tc = cam.constraints.new('TRACK_TO')
    tc.target = target
    tc.track_axis = 'TRACK_NEGATIVE_Z'
    tc.up_axis = 'UP_Y'

    bpy.context.scene.camera = cam
    return cam, rig


# --------------------------------------------------------------------------- #
#  Animation — all Bezier, full-duration coverage, no dead tail               #
# --------------------------------------------------------------------------- #

def animate(slide_root, spike, mat_spike, cam, rig, under, backlight):
    sc = bpy.context.scene
    base_y = cam.location.y     # -13.6

    # ---- 1) ambient camera PUSH (dolly): distance scale -------------------
    #   f0   1.000  ->  f14 1.010  (ease-in-out)
    #   hold through land, then f40 1.010 -> f62 1.050 (sustained), hold -> f72
    def set_push(frame, factor):
        cam.location.y = base_y * factor
        cam.keyframe_insert("location", index=1, frame=frame)

    set_push(F_START, 1.000)
    set_push(F_SETTLE, 1.010)
    set_push(F_LAND_END, 1.010)
    set_push(F_SUSTAIN_END, 1.050)
    set_push(F_END, 1.050)           # HOLD-not-fade
    bezierize(cam)

    # ---- 2) slide SETTLE into frame (f0-14) + impact PUSH-THROUGH ---------
    #   settle: drop in slightly + tiny scale from 0.985 -> 1.0 (ease-out)
    #   impact: 1.00 -> 1.12 (f38) -> 1.00 (f40)  overshoot-and-settle
    slide_root.scale = (0.985, 0.985, 0.985)
    slide_root.location = (0, 0, 0.12)
    slide_root.keyframe_insert("scale", frame=F_START)
    slide_root.keyframe_insert("location", index=2, frame=F_START)

    slide_root.scale = (1.0, 1.0, 1.0)
    slide_root.location = (0, 0, 0.0)
    slide_root.keyframe_insert("scale", frame=F_SETTLE)
    slide_root.keyframe_insert("location", index=2, frame=F_SETTLE)
    # hold scale into the land
    slide_root.keyframe_insert("scale", frame=F_GROW_END)
    # overshoot peak
    slide_root.scale = (1.12, 1.12, 1.12)
    slide_root.keyframe_insert("scale", frame=F_LAND_PEAK)
    # settle back
    slide_root.scale = (1.0, 1.0, 1.0)
    slide_root.keyframe_insert("scale", frame=F_LAND_END)
    slide_root.keyframe_insert("scale", frame=F_END)   # hold
    bezierize(slide_root)

    # ---- 3) oxblood spike GROWS upward (scale-Z build, f14-36) -----------
    #   power-style ease-out: fast rise then settle into full height
    spike.scale = (1.0, 1.0, 0.001)
    spike.keyframe_insert("scale", index=2, frame=F_SETTLE)
    spike.scale = (1.0, 1.0, 1.0)
    spike.keyframe_insert("scale", index=2, frame=F_GROW_END)
    spike.keyframe_insert("scale", index=2, frame=F_END)   # hold full
    bezierize(spike, easing_map={'scale': 'EASE_OUT'})

    # ---- 4) spike EMISSIVE: low during growth -> SNAP full at land ->
    #         breathe +/-5% sustained -------------------------------------
    bsdf = mat_spike.node_tree.nodes.get("Principled BSDF")
    em = None
    for nm in ("Emission Strength",):
        if nm in bsdf.inputs:
            em = bsdf.inputs[nm]
    if em is not None:
        def key_em(frame, val):
            em.default_value = val
            em.keyframe_insert("default_value", frame=frame)

        key_em(F_SETTLE, 2.0)
        key_em(F_GROW_END, 5.0)
        key_em(F_GROW_END + 1, 34.0)       # discrete SNAP to full emissive
        key_em(F_LAND_END, 26.0)           # settle
        # sustained breathing +/-5%  (f40-62)
        key_em(46, 27.3)
        key_em(52, 24.7)
        key_em(58, 27.3)
        key_em(F_SUSTAIN_END, 26.0)
        key_em(F_END, 26.0)                # HOLD
        # bezierize the material action
        if mat_spike.node_tree.animation_data:
            act = mat_spike.node_tree.animation_data.action
            for fc in act.fcurves:
                for kp in fc.keyframe_points:
                    kp.interpolation = 'BEZIER'
                    kp.handle_left_type = 'AUTO_CLAMPED'
                    kp.handle_right_type = 'AUTO_CLAMPED'
                fc.update()

    # ---- 5) specimen UNDER-LIGHT fades up (f0-14) then holds -------------
    def ramp_light(light, full):
        light.data.energy = 0.0
        light.data.keyframe_insert("energy", frame=F_START)
        light.data.energy = full
        light.data.keyframe_insert("energy", frame=F_SETTLE)
        light.data.keyframe_insert("energy", frame=F_END)   # hold
        if light.data.animation_data:
            for fc in light.data.animation_data.action.fcurves:
                for kp in fc.keyframe_points:
                    kp.interpolation = 'BEZIER'
                    kp.handle_left_type = 'AUTO_CLAMPED'
                    kp.handle_right_type = 'AUTO_CLAMPED'
                fc.update()

    ramp_light(under, 320.0)
    ramp_light(backlight, 140.0)

    # ---- 6) camera SHAKE at the land (~6px), damping out (f36-44) --------
    shake = [
        (F_GROW_END, 0.0, 0.0),
        (37, 0.010, -0.008),
        (38, -0.008, 0.009),
        (39, 0.006, -0.005),
        (40, -0.004, 0.003),
        (42, 0.002, -0.0015),
        (44, 0.0, 0.0),
    ]
    for fr, rx, rz in shake:
        rig.rotation_euler = (rx, 0.0, rz)
        rig.keyframe_insert("rotation_euler", frame=fr)
    # keep the rig still before and after the shake window (hold)
    rig.rotation_euler = (0, 0, 0)
    rig.keyframe_insert("rotation_euler", frame=F_START)
    rig.keyframe_insert("rotation_euler", frame=F_END)
    bezierize(rig)

    return


def animate_caption(caption):
    """Caption locks / settles in at the land (f36-40): scale + lift ease."""
    caption.scale = (0.0001, 0.0001, 0.0001)
    caption.location.z = -2.02
    caption.keyframe_insert("scale", frame=F_GROW_END)
    caption.keyframe_insert("location", index=2, frame=F_GROW_END)
    caption.scale = (1.06, 1.06, 1.06)
    caption.keyframe_insert("scale", frame=F_LAND_PEAK)
    caption.scale = (1.0, 1.0, 1.0)
    caption.location.z = -1.9
    caption.keyframe_insert("scale", frame=F_LAND_END)
    caption.keyframe_insert("location", index=2, frame=F_LAND_END)
    caption.keyframe_insert("scale", frame=F_END)           # hold
    bezierize(caption)


# --------------------------------------------------------------------------- #
#  Compositor — Fog Glow bloom for emissive light-leak wash                   #
# --------------------------------------------------------------------------- #

def build_compositor():
    sc = bpy.context.scene
    sc.use_nodes = True
    nt = sc.node_tree
    nt.nodes.clear()
    rl = nt.nodes.new("CompositorNodeRLayers")
    glare = nt.nodes.new("CompositorNodeGlare")
    glare.glare_type = 'FOG_GLOW'
    glare.quality = 'HIGH'
    glare.size = 7
    try:
        glare.mix = -0.1
        glare.threshold = 0.6
    except Exception:
        pass
    comp = nt.nodes.new("CompositorNodeComposite")
    rl.location = (-300, 0)
    glare.location = (0, 0)
    comp.location = (300, 0)
    nt.links.new(rl.outputs["Image"], glare.inputs["Image"])
    nt.links.new(glare.outputs["Image"], comp.inputs["Image"])


# --------------------------------------------------------------------------- #
#  Main                                                                       #
# --------------------------------------------------------------------------- #

def main():
    wipe()
    configure_scene()

    # slide root empty — owns the whole hero for the impact push-through
    slide_root = bpy.data.objects.new("SlideRoot", None)
    slide_root.empty_display_size = 0.5
    bpy.context.collection.objects.link(slide_root)

    spike, mat_spike, specimen = build_slide_hero(slide_root)
    caption = build_caption()
    build_ground()
    key, rim, under, backlight = build_lights()
    cam, rig = build_camera()

    animate(slide_root, spike, mat_spike, cam, rig, under, backlight)
    animate_caption(caption)
    build_compositor()

    if SAVE_PATH:
        bpy.ops.wm.save_as_mainfile(filepath=SAVE_PATH)
        print(f"[build] saved .blend -> {SAVE_PATH}")

    if arg("--anim"):
        sc = bpy.context.scene
        sc.render.image_settings.file_format = 'PNG'
        sc.render.image_settings.color_mode = 'RGBA'
        sc.render.image_settings.compression = 15
        sc.render.filepath = ("/home/user/ab/videos/oxblood-slide/"
                              "renders/frames/f_")
        sc.render.use_overwrite = True
        print(f"[build] rendering animation frames "
              f"{sc.frame_start}..{sc.frame_end} ({ENGINE}, {SAMPLES} spp)")
        bpy.ops.render.render(animation=True)
        print("[build] animation render complete.")

    if TEST_FRAME is not None:
        fr = int(TEST_FRAME)
        sc = bpy.context.scene
        sc.frame_set(fr)
        sc.render.image_settings.file_format = 'PNG'
        sc.render.image_settings.color_mode = 'RGBA'
        sc.render.filepath = f"/home/user/ab/videos/oxblood-slide/renders/_test_f{fr}.png"
        bpy.ops.render.render(write_still=True)
        print(f"[build] test frame {fr} -> {sc.render.filepath}")

    print("[build] done.")


main()
