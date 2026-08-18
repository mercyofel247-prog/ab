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
// Capturing each frame as a JPEG at 80 quality is visually indistinguishable
// from the default here but noticeably cheaper to encode per frame.
Config.setJpegQuality(80);
Config.setOverwriteOutput(true);
Config.overrideBundlerConfig(enableTailwind);
