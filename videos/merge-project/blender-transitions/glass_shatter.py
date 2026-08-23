import bpy
import math
import os

PROJECT = "/home/user/ab/videos/merge-project/blender-transitions"
TEX_A = os.path.join(PROJECT, "textures/plane_a.png")   # front plane: shatters
TEX_B = os.path.join(PROJECT, "textures/plane_b.png")   # back plane: revealed
OUT_DIR = os.path.join(PROJECT, "frames_out")

FPS = 24
FRAME_START = 1
IMPACT_FRAME = 6          # glass stays intact/frozen until this frame
FRAME_END = 60            # ~2.5s total

# ---------- clean scene ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start = FRAME_START
scene.frame_end = FRAME_END
scene.render.fps = FPS
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = OUT_DIR + "/f_"
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 24
scene.cycles.use_denoising = False
scene.world = bpy.data.worlds.new("World")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)

# ---------- camera (orthographic, dead-on, matches 16:9 plane) ----------
cam_data = bpy.data.cameras.new("Cam")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 9.2
cam_obj = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam_obj)
cam_obj.location = (0, 0, 10)
cam_obj.rotation_euler = (0, 0, 0)
scene.camera = cam_obj

# ---------- helper: emission-textured plane ----------
def make_plane(name, image_path, z, size=(16.4, 9.2)):
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
    emit.inputs["Strength"].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(tex.outputs["Color"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    obj.data.materials.append(mat)
    return obj

plane_b = make_plane("PlaneB_Revealed", TEX_B, z=-1.0)
plane_a = make_plane("PlaneA_Glass", TEX_A, z=0.0)

# give the "glass" real thickness before fracturing: a flat quad has zero
# volume, which makes Bullet's convex-hull inertia degenerate and the
# shards never move under gravity/force even when marked dynamic.
solid = plane_a.modifiers.new("Thickness", 'SOLIDIFY')
solid.thickness = 0.05
solid.offset = -1.0
bpy.context.view_layer.objects.active = plane_a
bpy.ops.object.modifier_apply(modifier=solid.name)

# ---------- fracture plane A into shards ----------
bpy.ops.preferences.addon_enable(module="object_fracture_cell")
bpy.context.view_layer.objects.active = plane_a
plane_a.select_set(True)

# give the plane a particle system so fracture has enough seed points for real shards
psys_mod = plane_a.modifiers.new("FractureSeeds", 'PARTICLE_SYSTEM')
psys = plane_a.particle_systems[-1]
psys.settings.count = 140
psys.settings.emit_from = 'FACE'
psys.settings.distribution = 'RAND'
psys.settings.frame_start = 1
psys.settings.frame_end = 1
psys.settings.lifetime = 1000
psys.settings.physics_type = 'NO'
bpy.context.view_layer.update()
bpy.context.scene.frame_set(1)

bpy.ops.object.add_fracture_cell_objects(
    source={'PARTICLE_OWN'},
    source_limit=140,
    source_noise=0.15,
    margin=0.008,
    use_smooth_faces=False,
    use_sharp_edges=True,
    use_sharp_edges_apply=True,
    use_data_match=True,
    use_debug_points=False,
    use_debug_redraw=False,
    use_debug_bool=False,
    collection_name="",
    use_interior_vgroup=False,
    material_index=0,
    use_recenter=True,
    use_remove_original=True,
)

shards = [o for o in bpy.data.objects if o.name.startswith("PlaneA_Glass_cell")]
if not shards:
    shards = [o for o in bpy.data.objects if o.type == 'MESH' and o.name != "PlaneB_Revealed" and o.name != "PlaneA_Glass"]

print(f"Fractured into {len(shards)} shards")

# use_remove_original didn't actually delete the source plane in this
# Blender build -- it stays behind, static and fully opaque, permanently
# hiding the reveal. Remove it explicitly.
leftover = bpy.data.objects.get("PlaneA_Glass")
if leftover is not None:
    bpy.data.objects.remove(leftover, do_unlink=True)

# ---------- rigid body world ----------
if scene.rigidbody_world is None:
    bpy.ops.rigidbody.world_add()
rbw = scene.rigidbody_world
rbw.collection = bpy.data.collections.new("RB_Shards")
bpy.context.scene.collection.children.link(rbw.collection)

# camera looks down world -Z (depth), so screen-vertical is world Y:
# point gravity along -Y or it just pushes shards invisibly along the view axis.
scene.use_gravity = True
scene.gravity = (0, -28.0, 0)  # exaggerated for a snappy, camera-timed fall

for s in shards:
    rbw.collection.objects.link(s)
    bpy.context.view_layer.objects.active = s
    s.select_set(True)
    bpy.ops.rigidbody.object_add(type='ACTIVE')
    s.rigid_body.collision_shape = 'CONVEX_HULL'
    s.rigid_body.mass = 0.05
    s.rigid_body.friction = 0.3
    s.rigid_body.restitution = 0.15
    s.rigid_body.linear_damping = 0.02
    s.rigid_body.angular_damping = 0.05
    # frozen until impact, then released
    s.rigid_body.kinematic = True
    s.keyframe_insert(data_path="rigid_body.kinematic", frame=FRAME_START)
    s.keyframe_insert(data_path="rigid_body.kinematic", frame=IMPACT_FRAME - 1)
    s.rigid_body.kinematic = False
    s.keyframe_insert(data_path="rigid_body.kinematic", frame=IMPACT_FRAME)
    s.select_set(False)

for fc in scene.animation_data.action.fcurves if scene.animation_data else []:
    pass
# make keyframes hold (constant interpolation) so the flag actually toggles cleanly
for s in shards:
    if s.animation_data and s.animation_data.action:
        for fc in s.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = 'CONSTANT'

# ---------- explosion force field (radial impulse at impact) ----------
bpy.ops.object.effector_add(type='FORCE', location=(0, 0, 0.3))
force = bpy.context.active_object
force.name = "ShatterImpulse"
force.field.strength = 0.0
force.field.falloff_power = 0.0   # even push regardless of distance from center
force.field.use_min_distance = False
force.keyframe_insert(data_path="field.strength", frame=IMPACT_FRAME - 1)
force.field.strength = 55.0
force.keyframe_insert(data_path="field.strength", frame=IMPACT_FRAME + 2)
force.field.strength = 0.0
force.keyframe_insert(data_path="field.strength", frame=IMPACT_FRAME + 10)
if force.animation_data and force.animation_data.action:
    for fc in force.animation_data.action.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'

rbw.point_cache.frame_start = FRAME_START
rbw.point_cache.frame_end = FRAME_END

# ---------- bake and render ----------
bpy.context.view_layer.update()
os.makedirs(OUT_DIR, exist_ok=True)

with bpy.context.temp_override(scene=scene):
    bpy.ops.ptcache.bake_all(bake=True)

bpy.ops.render.render(animation=True)
print("DONE RENDERING")
