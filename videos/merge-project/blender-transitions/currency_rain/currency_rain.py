import bpy
import math
import os

PROJECT = "/home/user/ab/videos/merge-project/blender-transitions/currency_rain"
TEX_A = os.path.join(PROJECT, "textures/plane_a_boardroom.png")
TEX_B = os.path.join(PROJECT, "textures/plane_b_device.png")
TEX_BILL = os.path.join(PROJECT, "textures/banknote.png")
OUT_DIR = os.path.join(PROJECT, "frames_out")

FPS = 24
FRAME_START = 1
FRAME_END = 80          # ~3.3s
EMIT_END = 40           # stop spawning new bills after this frame
LIFETIME = 34           # frames each bill lives
SWAP_FRAME = 30         # hard-cut background swap, hidden behind peak density
BILL_COUNT = 1400

RENDER_SAMPLES = 24
RES_X = 1920
RES_Y = 1080

# ---------- clean scene ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start = FRAME_START
scene.frame_end = FRAME_END
scene.render.fps = FPS
scene.render.resolution_x = RES_X
scene.render.resolution_y = RES_Y
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = OUT_DIR + "/f_"
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = RENDER_SAMPLES
scene.cycles.use_denoising = False
scene.world = bpy.data.worlds.new("World")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)
scene.use_gravity = True
scene.gravity = (0, -9.0, 0)   # screen-vertical axis in this camera setup

# ---------- camera ----------
cam_data = bpy.data.cameras.new("Cam")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 9.2
cam_obj = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam_obj)
cam_obj.location = (0, 0, 10)
cam_obj.rotation_euler = (0, 0, 0)
scene.camera = cam_obj

# ---------- helper: emission-textured plane with swap keyframes ----------
def make_plane(name, image_path, z, start_strength, size=(16.4, 9.2)):
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, z))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0] / 2, size[1] / 2, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    mat = bpy.data.materials.new(name + "_mat")
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(image_path)
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Strength"].default_value = start_strength
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(tex.outputs["Color"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    obj.data.materials.append(mat)
    return obj, emit

plane_a, emit_a = make_plane("PlaneA_Before", TEX_A, z=0.0, start_strength=1.0)
plane_b, emit_b = make_plane("PlaneB_After", TEX_B, z=-1.0, start_strength=1.0)

# instant hard-cut swap at SWAP_FRAME, hidden behind peak bill density.
# NOTE: zeroing Emission strength does NOT make a surface transparent --
# it's still an opaque black card that blocks whatever is behind it.
# Use hide_render instead so the occluded plane truly disappears.
for obj, before, after in ((plane_a, False, True), (plane_b, True, False)):
    obj.hide_render = before
    obj.keyframe_insert(data_path="hide_render", frame=SWAP_FRAME - 1)
    obj.hide_render = after
    obj.keyframe_insert(data_path="hide_render", frame=SWAP_FRAME)
    if obj.animation_data and obj.animation_data.action:
        for fc in obj.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = 'CONSTANT'

# ---------- banknote instance mesh ----------
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 20, 0))  # parked off to the side
bill = bpy.context.active_object
bill.name = "Bill"
bill.scale = (0.85, 0.38, 1)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

bill_mat = bpy.data.materials.new("Bill_mat")
bill_mat.use_nodes = True
nt = bill_mat.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
tex = nt.nodes.new("ShaderNodeTexImage")
tex.image = bpy.data.images.load(TEX_BILL)
emit = nt.nodes.new("ShaderNodeEmission")
emit.inputs["Strength"].default_value = 1.3
out = nt.nodes.new("ShaderNodeOutputMaterial")
nt.links.new(tex.outputs["Color"], emit.inputs["Color"])
nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
bill.data.materials.append(bill_mat)
bill.hide_render = True

# ---------- emitter plane above frame ----------
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 6.4, 1.5))
emitter = bpy.context.active_object
emitter.name = "RainEmitter"
emitter.scale = (9.5, 1.0, 1)
emitter.rotation_euler = (math.radians(90), 0, 0)  # face normal points -Y (down)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
# NOTE: Cycles needs the emitter object itself render-visible for its
# particle instances to draw at all -- hide_render on the emitter hides
# the instances too, not just its own mesh. Leaving it visible is fine
# here since the rotation puts it edge-on to the camera (negligible area).

psys_mod = emitter.modifiers.new("Rain", 'PARTICLE_SYSTEM')
psys = emitter.particle_systems[-1]
ps = psys.settings
ps.type = 'EMITTER'
ps.count = BILL_COUNT
ps.frame_start = FRAME_START
ps.frame_end = EMIT_END
ps.lifetime = LIFETIME
ps.lifetime_random = 0.15
ps.emit_from = 'FACE'
ps.distribution = 'RAND'
ps.normal_factor = 5.0
ps.factor_random = 1.2
ps.render_type = 'OBJECT'
ps.instance_object = bill
ps.particle_size = 1.0
ps.size_random = 0.35
ps.use_rotations = True
ps.rotation_mode = 'NOR'
ps.use_dynamic_rotation = True
ps.angular_velocity_mode = 'RAND'
ps.angular_velocity_factor = 1.4
ps.effector_weights.gravity = 1.0
ps.mass = 0.3

os.makedirs(OUT_DIR, exist_ok=True)
bpy.context.view_layer.update()
bpy.ops.render.render(animation=True)
print("DONE RENDERING")
