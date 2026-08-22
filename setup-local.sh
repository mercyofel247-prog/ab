#!/usr/bin/env bash
# setup-local.sh — one-command setup to render THIS repo on your own GPU.
#
# Run it in the repo root ON YOUR MACHINE (a local terminal), NOT in the Claude
# web session (that runs in a GPU-less cloud container and can't reach your GPU).
# It checks your toolchain + GPU, installs both projects' deps, and prints the
# exact GPU render commands. It changes nothing on your system (no sudo).

set -euo pipefail
cd "$(dirname "$0")"

say(){ printf '\n\033[1m%s\033[0m\n' "$1"; }
ok(){ printf '  \033[32m✔\033[0m %s\n' "$1"; }
warn(){ printf '  \033[33m!\033[0m %s\n' "$1"; }
bad(){ printf '  \033[31m✘\033[0m %s\n' "$1"; }

OS="$(uname -s 2>/dev/null || echo unknown)"

say "1) Toolchain"
if command -v node >/dev/null 2>&1; then ok "node $(node -v)"; else bad "Node.js not found — install Node 18+ (https://nodejs.org)"; exit 1; fi
if command -v npm  >/dev/null 2>&1; then ok "npm $(npm -v)";  else bad "npm not found"; exit 1; fi
if command -v ffmpeg >/dev/null 2>&1; then ok "ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')"; else warn "system ffmpeg not on PATH (HyperFrames bundles one; a system ffmpeg with VAAPI is needed for AMD encode)"; fi

say "2) GPU check ($OS)"
case "$OS" in
  Linux)
    if [ -e /dev/dri/renderD128 ]; then ok "/dev/dri/renderD128 present (kernel sees a GPU)"; else bad "/dev/dri missing — no GPU is exposed to apps; install AMD/Mesa drivers"; fi
    if command -v glxinfo >/dev/null 2>&1; then
      R="$(glxinfo -B 2>/dev/null | grep -i 'OpenGL renderer' || true)"
      [ -n "$R" ] && printf '     %s\n' "$R"
      if echo "$R" | grep -qi llvmpipe; then bad "renderer is llvmpipe = SOFTWARE (GPU not active) — install/enable Mesa drivers"
      elif echo "$R" | grep -qiE 'amd|radeon|radv|amdgpu'; then ok "hardware AMD renderer detected — GPU is active"
      else warn "couldn't confirm an AMD renderer from glxinfo output"; fi
    else
      warn "glxinfo not installed — can't verify the GPU is active (install it, see below)"
    fi
    if   command -v apt    >/dev/null 2>&1; then printf '     drivers/tools:  sudo apt install mesa-utils mesa-vulkan-drivers libgl1-mesa-dri\n'
    elif command -v dnf    >/dev/null 2>&1; then printf '     drivers/tools:  sudo dnf install glx-utils mesa-dri-drivers mesa-vulkan-drivers\n'
    elif command -v pacman >/dev/null 2>&1; then printf '     drivers/tools:  sudo pacman -S mesa-utils mesa vulkan-radeon\n'
    elif command -v zypper >/dev/null 2>&1; then printf '     drivers/tools:  sudo zypper install Mesa-demo-x Mesa-libGL1 libvulkan_radeon\n'; fi
    ;;
  Darwin) ok "macOS — the GPU is available to Chrome by default (Metal). Nothing to install." ;;
  MINGW*|MSYS*|CYGWIN*) ok "Windows — the GPU is available by default. Confirm in Task Manager → Performance → GPU while a render runs." ;;
  *) warn "unknown OS — proceed, but verify the GPU manually" ;;
esac

say "3) Install project dependencies"
( cd hf-scenes   && npm install --no-audit --no-fund >/dev/null 2>&1 ) && ok "hf-scenes deps installed"
( cd remotion-app && npm install --no-audit --no-fund >/dev/null 2>&1 ) && ok "remotion-app deps installed"

say "4) Ready — render on your GPU"
cat <<'EOF'
  HyperFrames (auto GPU rasterization + auto AMD encode):
    cd hf-scenes
    npx hyperframes render -c countdown_50k_3d.html -q high --browser-gpu --gpu -w auto -o renders/out.mp4

  Remotion (auto GPU rasterization via remotion.config.ts; AMD encode via wrapper):
    cd remotion-app
    ./remotion-amf.sh Ch1-06 out/out.mp4 --concurrency=100%

  Prove the GPU is engaged (compare the two times — GPU should be much faster):
    cd hf-scenes
    time npx hyperframes render -c countdown_50k_3d.html -q draft -w auto --browser-gpu   -o renders/gpu.mp4
    time npx hyperframes render -c countdown_50k_3d.html -q draft -w 1    --no-browser-gpu -o renders/cpu.mp4

  Full guide: RENDER-LOCAL.md
EOF
