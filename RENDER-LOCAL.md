# Rendering locally on your GPU (AMD)

**Why this file exists:** Claude Code on the web runs in a cloud container with
**no GPU attached**, so the Three.js/WebGL compositions there are forced onto
software rendering (`--no-browser-gpu`) and are slow (~60s for 8s of video). On
your own machine, with your AMD GPU, the hardware WebGL path makes those renders
several times faster. These are the commands to run **on your machine**, not in
a web session.

> Two independent GPU jobs: **rasterization** (drawing the WebGL frames) and
> **video encoding** (compressing them to H.264). HyperFrames accelerates BOTH on
> AMD automatically (`--browser-gpu` for raster, `--gpu` for encode — its `--gpu`
> auto-detects `h264_vaapi` on Linux / `h264_amf` on Windows, it is NOT NVENC-only).
> For these short clips the encode step is already sub-second, so `--gpu` is
> optional; the raster path is the real win.

---

## Automatic vs. opt-in (important)

**The two tools do NOT behave the same.** Only HyperFrames uses the GPU on its own.

| Tool | Uses your AMD GPU automatically? | What you actually do |
|---|---|---|
| **HyperFrames** `render` | ✅ **Yes** — `--browser-gpu` defaults to *auto*: it probes for a GPU on launch and uses it, falling back to software only if none is found. | Nothing. Just run `npx hyperframes render …`. Pass `--browser-gpu` only to *force* it (turns a silent software fallback into a hard error, so you can be sure). |
| **Remotion** `render` (CLI) | ✅ **Yes, now** — `remotion.config.ts` auto-selects a GPU GL backend when a GPU is detected (`/dev/dri` on Linux, or macOS/Windows), and stays on software otherwise. Remotion's *own* default is software, so this only works because of that config. | Nothing. Override if needed with `--gl=vulkan` / `--gl=swangle`. |
| **Remotion** `studio` (preview) | ✅ Yes | Nothing — the desktop preview uses the GPU. Only the *render* needs the flag. |

Two shared prerequisites for "automatic" to mean anything:
1. **Working drivers** — the OS must expose the GPU to Chrome. On Linux that's
   Mesa/RADV + `/dev/dri` (verify with `glxinfo -B` showing **AMD**, not `llvmpipe`).
   Windows/macOS have this out of the box.
2. Without (1), **both** tools silently fall back to software no matter what flags
   you pass. (That's exactly why they ran software in the Claude cloud session —
   that container has no GPU at all.)

**GPU video encoding on AMD:**
- **HyperFrames** `--gpu` **auto-detects the AMD encoder** — it runs `ffmpeg -encoders`,
  probes each candidate (`nvenc → videotoolbox → vaapi → qsv → amf`) with a real
  1-frame test, and uses the first that works: **`h264_vaapi` on Linux** (via
  `/dev/dri/renderD128`) or **`h264_amf` on Windows**, falling back to CPU `libx264`
  if none is usable. So just add `--gpu`; nothing manual needed. (This IS automatic —
  an earlier version of this note wrongly said otherwise.)
- **Remotion** *does* have a built-in `--hardware-acceleration` encode option, but
  for H.264 it only supports **NVENC** (Linux/Windows) and **VideoToolbox** (macOS)
  — **no AMD VAAPI/AMF**. So on an AMD GPU it can't hardware-encode natively (it
  falls back to CPU `libx264`). The route for AMD is a post-render
  `h264_vaapi`/`h264_amf` transcode — see `remotion-app/remotion-amf.sh`, which does
  it automatically. (For short clips it isn't worth it; matters for long/4K output.)

---

## 1. Confirm the GPU is usable

**Linux**
```bash
ls /dev/dri                               # expect: card0  renderD128
glxinfo -B | grep -Ei "renderer|device"   # must say AMD Radeon / RADV — NOT llvmpipe/softpipe
vulkaninfo --summary | grep -i device     # should list your Radeon
radeontop                                 # live GPU usage while a render runs (optional)
```
The tell: the OpenGL/Vulkan renderer is **AMD/RADV**, not `llvmpipe` (that would
mean software rendering).

If it says `llvmpipe`, install the Mesa userspace drivers and retry:
```bash
sudo apt install mesa-vulkan-drivers libgl1-mesa-dri libegl1   # Debian/Ubuntu
```

**Windows / macOS:** it just works. Watch Task Manager → Performance → GPU (or
Activity Monitor) while rendering to confirm the card is busy.

---

## 2. Get the repo

```bash
git clone <your-repo-url> ab
cd ab/hf-scenes && git checkout claude/hyperframes-video-setup-ka5ssp
npm install
```

---

## 3. HyperFrames — render on the AMD GPU

Two GPU flags — `--browser-gpu` (WebGL raster) and `--gpu` (video encode). Both
auto-detect AMD, so this uses your Radeon end to end:

```bash
# 3D scene (the one that benefits most)
npx hyperframes render -c countdown_50k_3d.html -q high \
  --browser-gpu --gpu -w auto -o renders/countdown_gpu.mp4

# other 3D scene
npx hyperframes render -c theranos_ch1_06_3d.html -q high \
  --browser-gpu --gpu -w auto -o renders/theranos_ch1_06_3d_gpu.mp4
```

- `--browser-gpu` → hardware WebGL on your Radeon (the big speedup).
- `--gpu` → GPU video encode; on AMD it auto-selects **`h264_vaapi`** (Linux) or
  **`h264_amf`** (Windows) after probing, and safely falls back to CPU `libx264` if
  neither works — so it's safe to leave on. (Optional: encoding these short clips is
  already sub-second on CPU.)
- `-w auto` → multiple parallel workers (safe on real hardware).
- If `--browser-gpu` still falls back to software on Linux, your Mesa/`libEGL`
  install is incomplete (see step 1), or you're in a bare headless session with
  no DRM access — run inside a desktop (X/Wayland) session.

2D / motion-graphics compositions don't need the GPU and are already fast:
```bash
npx hyperframes render -c theranos_ch1_06.html -q high -w auto -o renders/2d.mp4
```

---

## 4. Remotion — render on the AMD GPU

`remotion.config.ts` now auto-selects a GPU GL backend when a GPU is present, so
no flag is needed:
```bash
cd ../remotion-app && npm install
npx remotion render Ch1-06 out/ch1_06_gpu.mp4 --concurrency=100%
```
- On AMD Linux the config picks `angle-egl`; on macOS/Windows it picks `angle`.
- If `angle-egl` doesn't engage your card, override once: `--gl=vulkan`.
- The config only opts in when a GPU is detected (`/dev/dri` on Linux), so the same
  repo still renders on GPU-less machines (it falls back to software).
- `--concurrency=100%` uses all CPU cores for the CPU-side work.

**GPU *encode* for Remotion (optional):** Remotion always encodes on the CPU. To
also put the final H.264 encode on your AMD GPU, use the wrapper — it renders, then
hardware-encodes with `h264_vaapi` (Linux) / `h264_amf` (Windows) / `h264_videotoolbox`
(macOS), falling back to CPU if no GPU encoder is usable:
```bash
./remotion-amf.sh Ch1-06 out/ch1_06.mp4 --concurrency=100%
```
(For these short clips the CPU encode is already sub-second, so this mostly matters
for long/4K output.)

---

## 5. Prove it's actually using the GPU

Render the same 3D scene both ways and compare wall-clock time:

```bash
# GPU path
time npx hyperframes render -c countdown_50k_3d.html -q draft -w auto \
  --browser-gpu -o renders/g.mp4

# software path (what the cloud is forced to use)
time npx hyperframes render -c countdown_50k_3d.html -q draft -w 1 \
  --no-browser-gpu -o renders/cpu.mp4
```

The `--browser-gpu` run should be several times faster, and `radeontop` (or Task
Manager) should spike during it. If the two times are identical, the GPU path is
silently falling back to software — recheck step 1.

---

## Reference: what runs where

| Composition type | Needs GPU? | Cloud web session | Your AMD machine |
|---|---|---|---|
| 2D / CSS / motion-graphics (HyperFrames) | No | fast | fast |
| Remotion (`MyComp`, `Ch1-06`) | Helps for WebGL/Three | fast (software ok) | faster |
| Three.js / WebGL (`*_3d.html`, `countdown_50k_3d.html`) | **Yes** | slow (software only) | **fast with `--browser-gpu`** |
