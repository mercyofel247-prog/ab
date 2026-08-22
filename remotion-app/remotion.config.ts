/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";
import { enableTailwind } from '@remotion/tailwind-v4';
import { existsSync } from "node:fs";
import os from "node:os";

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

// Speed: render across every available core. Remotion's default concurrency
// is only a fraction of the CPUs; pinning it to the full core count is a
// quality-neutral throughput win (each worker still renders full-quality
// frames — only parallelism changes). Falls back safely to 1 on odd hosts.
Config.setConcurrency(Math.max(1, os.cpus().length));
