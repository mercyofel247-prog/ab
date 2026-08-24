// GPU-accelerated render driver for the remotion-bucket transitions in
// ../videos/transition-pipeline/manifest/manifest.json (22 of the 140).
//
// Uses the Node.js renderMedia() API directly (not the `remotion render`
// CLI) specifically to reach chromiumOptions.hardwareAcceleration, which
// isn't exposed as a CLI flag on this pinned Remotion version (4.0.509) —
// confirmed by grepping the installed @remotion/cli package. "if-possible"
// GPU-accelerates Chromium's frame compositing (matters most for the R3F/
// Three.js and CSS-3D-transform transitions in this bucket); it silently
// falls back to software if no GPU is present, which is why this runs fine
// on the CPU-only sandbox that authored it and gets real acceleration on
// the AMD RX 9060 XT this is meant to run against locally.
//
// Usage:
//   node render-transition.mjs --composition-id TarotCardFlip \
//     --clip-a /path/to/sceneA.mp4 --clip-b /path/to/sceneB.mp4 \
//     --out /path/to/renders/020_tarot_card_flip.mp4
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same sandbox-only fallback as remotion.config.ts: some sandboxes block
// Remotion's own headless-shell download but ship a Playwright Chromium
// instead. remotion.config.ts's Config.setBrowserExecutable() only applies
// to the `remotion render` CLI, not the renderMedia()/selectComposition()
// Node API this script uses, so it's set again here explicitly. No-op on a
// normal local machine where this path doesn't exist.
const sandboxHeadlessShell =
  "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
const browserExecutable = existsSync(sandboxHeadlessShell) ? sandboxHeadlessShell : undefined;

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    out[args[i].replace(/^--/, "")] = args[i + 1];
  }
  if (!out["composition-id"] || !out["out"]) {
    console.error(
      "Usage: node render-transition.mjs --composition-id <id> --clip-a <path> --clip-b <path> --out <path> [--concurrency N]",
    );
    process.exit(1);
  }
  return out;
}

// OffthreadVideo resolves its src against the bundle's static server root,
// not the local filesystem, so arbitrary source-clip paths need staging
// into public/ first (Remotion's standard staticFile() pattern) — this is
// exactly the same staging real uploaded clips will need, not a sandbox
// workaround.
function stageAsset(localPath) {
  const stageDir = path.join(__dirname, "public", "_transition_assets");
  mkdirSync(stageDir, { recursive: true });
  const dest = path.join(stageDir, path.basename(localPath));
  copyFileSync(localPath, dest);
  return `/public/_transition_assets/${path.basename(localPath)}`;
}

async function main() {
  const args = parseArgs();

  // Must stage assets into public/ before bundle() runs — bundle() copies
  // public/'s contents into its temp output dir once, at bundle time.
  const inputProps = {
    clipASrc: args["clip-a"] ? stageAsset(args["clip-a"]) : "",
    clipBSrc: args["clip-b"] ? stageAsset(args["clip-b"]) : "",
  };

  const bundleLocation = await bundle({
    entryPoint: path.join(__dirname, "src", "index.ts"),
  });

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: args["composition-id"],
    inputProps,
    browserExecutable,
  });

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: args["out"],
    inputProps,
    concurrency: args["concurrency"] ? Number(args["concurrency"]) : undefined,
    browserExecutable,
    chromiumOptions: {
      // "required" would hard-fail on a machine with no GPU at all — use
      // "if-possible" so this script stays portable, and rely on actually
      // running it on the GPU box for the speedup to matter.
      hardwareAcceleration: "if-possible",
    },
  });

  console.log(`Rendered ${args["composition-id"]} -> ${args["out"]}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
