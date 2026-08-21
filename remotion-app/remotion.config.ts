/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";
import { enableTailwind } from '@remotion/tailwind-v4';
import { existsSync } from "node:fs";
import { platform } from "node:os";

// Some sandboxes block Remotion's own headless-shell download but ship a
// Playwright Chromium instead. Point at it only when it's actually there,
// so this stays a no-op on machines with Remotion's normal browser install.
const sandboxHeadlessShell =
  "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
if (existsSync(sandboxHeadlessShell)) {
  Config.setBrowserExecutable(sandboxHeadlessShell);
}

// Use the hardware GPU automatically when one is actually present, so
// `remotion render` needs no --gl flag. Remotion's CLI otherwise defaults to a
// software GL backend. We only opt in when a GPU exists, so GPU-less machines
// (e.g. the Claude Code cloud container, which has no /dev/dri) stay on the
// working software path instead of failing to initialize a GL context.
//   - Linux: a GPU is exposed as a DRM render node under /dev/dri  -> angle-egl (Mesa/RADV, incl. AMD)
//   - macOS / Windows: the GPU is available to Chrome by default    -> angle
// Override any time with the CLI flag, e.g. --gl=vulkan or --gl=swangle.
const os = platform();
const hasLinuxGpu = os === "linux" && existsSync("/dev/dri");
if (hasLinuxGpu) {
  Config.setChromiumOpenGlRenderer("angle-egl");
} else if (os === "darwin" || os === "win32") {
  Config.setChromiumOpenGlRenderer("angle");
}
// else: no detectable GPU -> leave Remotion's software default (renders still work).

Config.setRspack(true);
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.overrideBundlerConfig(enableTailwind);
