# Rendering locally on your GPU (AMD)

**Why this file exists:** Claude Code on the web runs in a cloud container with
**no GPU attached**, so the Three.js/WebGL compositions there are forced onto
software rendering (`--no-browser-gpu`) and are slow (~60s for 8s of video). On
your own machine, with your AMD GPU, the hardware WebGL path makes those renders
several times faster. These are the commands to run **on your machine**, not in
a web session.

> The big 3D speedup comes from **hardware WebGL rasterization**, which is
> GPU-vendor-agnostic (works on AMD via Mesa). GPU *video encoding* is a separate,
> NVENC-oriented thing and is intentionally left off here — encoding is cheap.

---

## Automatic vs. opt-in (important)

**The two tools do NOT behave the same.** Only HyperFrames uses the GPU on its own.

| Tool | Uses your AMD GPU automatically? | What you actually do |
|---|---|---|
| **HyperFrames** `render` | ✅ **Yes** — `--browser-gpu` defaults to *auto*: it probes for a GPU on launch and uses it, falling back to software only if none is found. | Nothing. Just run `npx hyperframes render …`. Pass `--browser-gpu` only to *force* it (turns a silent software fallback into a hard error, so you can be sure). |
| **Remotion** `render` (CLI) | ❌ **No** — the headless renderer defaults to a **software** GL backend (`swangle`) for deterministic output. It will NOT grab your discrete GPU by itself. | Pass **`--gl=angle-egl`** (Linux; or `--gl=vulkan`). On Windows/macOS you can usually omit it. |
| **Remotion** `studio` (preview) | ✅ Yes | Nothing — the desktop preview uses the GPU. Only the *render* needs the flag. |

Two shared prerequisites for "automatic" to mean anything:
1. **Working drivers** — the OS must expose the GPU to Chrome. On Linux that's
   Mesa/RADV + `/dev/dri` (verify with `glxinfo -B` showing **AMD**, not `llvmpipe`).
   Windows/macOS have this out of the box.
2. Without (1), **both** tools silently fall back to software no matter what flags
   you pass. (That's exactly why they ran software in the Claude cloud session —
   that container has no GPU at all.)

The GPU-encode flag (`--gpu` in HyperFrames) is **never** automatic and is
NVENC-oriented — leave it off on AMD.

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

The flag that matters is **`--browser-gpu`** (use the GPU for the WebGL capture):

```bash
# 3D scene (the one that benefits most)
npx hyperframes render -c countdown_50k_3d.html -q high \
  --browser-gpu -w auto -o renders/countdown_gpu.mp4

# other 3D scene
npx hyperframes render -c theranos_ch1_06_3d.html -q high \
  --browser-gpu -w auto -o renders/theranos_ch1_06_3d_gpu.mp4
```

- `--browser-gpu` → hardware WebGL on your Radeon (the speedup).
- `-w auto` → multiple parallel workers (safe on real hardware).
- **Do not** add `--gpu` on AMD — that selects NVENC-style GPU encoding and may
  error or silently fall back. Leave encoding on the CPU (it's fast).
- If `--browser-gpu` still falls back to software on Linux, your Mesa/`libEGL`
  install is incomplete (see step 1), or you're in a bare headless session with
  no DRM access — run inside a desktop (X/Wayland) session.

2D / motion-graphics compositions don't need the GPU and are already fast:
```bash
npx hyperframes render -c theranos_ch1_06.html -q high -w auto -o renders/2d.mp4
```

---

## 4. Remotion — render on the AMD GPU

```bash
cd ../remotion-app && npm install

# AMD Linux: use the GPU-backed GL backend
npx remotion render Ch1-06 out/ch1_06_gpu.mp4 --gl=angle-egl --concurrency=100%
# if angle-egl doesn't engage the GPU, try:
npx remotion render Ch1-06 out/ch1_06_gpu.mp4 --gl=vulkan   --concurrency=100%
```
- **Windows / macOS (AMD):** omit `--gl` entirely — Remotion uses the GPU by default.
- `--concurrency=100%` uses all CPU cores for the parts that stay on CPU.

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
