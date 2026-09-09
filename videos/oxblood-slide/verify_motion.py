"""Quick low-res motion contact sheet — renders key timeline frames small/fast
so the animation states can be eyeballed before the full render."""
import bpy, sys, os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
blend = argv[0]
outdir = argv[1]
frames = [int(x) for x in argv[2].split(",")]

bpy.ops.wm.open_mainfile(filepath=blend)
sc = bpy.context.scene
sc.render.resolution_percentage = 40           # 768x432
sc.cycles.samples = 20
sc.cycles.use_adaptive_sampling = True
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
for f in frames:
    sc.frame_set(f)
    sc.render.filepath = os.path.join(outdir, f"v_f{f:02d}.png")
    bpy.ops.render.render(write_still=True)
    print(f"[verify] wrote frame {f}")
