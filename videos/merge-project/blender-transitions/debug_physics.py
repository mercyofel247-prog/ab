import bpy, sys
sys.path.insert(0, "/home/user/ab/videos/merge-project/blender-transitions")

# run the same build, but stop before rendering, then inspect
exec(open("/home/user/ab/videos/merge-project/blender-transitions/glass_shatter.py")
     .read().split("# ---------- bake and render ----------")[0])

import bpy
scene = bpy.context.scene
print("=== RBW state ===")
print("rigidbody_world:", scene.rigidbody_world)
print("enabled:", scene.rigidbody_world.enabled if scene.rigidbody_world else None)
print("gravity:", scene.gravity, "use_gravity:", scene.use_gravity)
print("num objects in rbw collection:", len(rbw.collection.objects))

s0 = shards[0]
print("\n=== sample shard:", s0.name, "===")
print("has animation_data:", s0.animation_data is not None)
if s0.animation_data and s0.animation_data.action:
    for fc in s0.animation_data.action.fcurves:
        print("  fcurve:", fc.data_path, [ (kp.co.x, kp.co.y) for kp in fc.keyframe_points ])
print("mass:", s0.rigid_body.mass, "shape:", s0.rigid_body.collision_shape, "type:", s0.rigid_body.type)

print("\n=== bake ===")
with bpy.context.temp_override(scene=scene):
    bpy.ops.ptcache.bake_all(bake=True)

print("\n=== positions across frames ===")
for f in (1, 6, 10, 20, 40, 60):
    scene.frame_set(f)
    bpy.context.view_layer.update()
    loc = s0.matrix_world.translation
    print(f"frame {f}: kinematic={s0.rigid_body.kinematic} loc={loc.x:.3f},{loc.y:.3f},{loc.z:.3f}")

print("\n=== check a handful more shards at frame 60 ===")
scene.frame_set(60)
bpy.context.view_layer.update()
for s in shards[:8]:
    loc = s.matrix_world.translation
    print(f"{s.name}: kinematic={s.rigid_body.kinematic} loc={loc.x:.3f},{loc.y:.3f},{loc.z:.3f}")
