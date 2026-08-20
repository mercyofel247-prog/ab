/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";
import { enableTailwind } from '@remotion/tailwind-v4';
import { existsSync } from "node:fs";

// Some sandboxes block Remotion's own headless-shell download but ship a
// Playwright Chromium instead. Point at it only when it's actually there,
// so this stays a no-op on machines with Remotion's normal browser install.
const sandboxHeadlessShell =
  "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
if (existsSync(sandboxHeadlessShell)) {
  Config.setBrowserExecutable(sandboxHeadlessShell);
}

Config.setRspack(true);
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.overrideBundlerConfig(enableTailwind);

// --- Peak render tuning: hyper-fast, high-quality output ------------------
// Concurrency defaults to all available CPU cores, so it is left unset here
// (hardcoding a value would cap faster machines) — pass --concurrency to
// override per render.
//
// Higher intermediate-frame quality than the default 80. Frames are the
// source the H.264 encoder sees, so this lifts final output quality at a
// negligible speed cost.
Config.setJpegQuality(90);
// bt709 is the standard HD color space; more accurate color than the default.
Config.setColorSpace("bt709");
// Software ANGLE (swangle) renders WebGL / Three.js (<ThreeCanvas />)
// deterministically in headless Chrome with no GPU — the reliable choice for
// sandbox / cloud rendering. Use "angle" instead on a machine with a real GPU.
Config.setChromiumOpenGlRenderer("swangle");
