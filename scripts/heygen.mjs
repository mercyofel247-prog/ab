// HeyGen REST API helper.
//
// Reads the API key from the HEYGEN_API_KEY environment variable and exposes a
// few thin wrappers over the HeyGen v2 API. Run it directly as a CLI to verify
// your key or kick off a video generation:
//
//   node --env-file=.env scripts/heygen.mjs check
//   node --env-file=.env scripts/heygen.mjs avatars
//   node --env-file=.env scripts/heygen.mjs generate "Hello from HeyGen"
//
// Docs: https://docs.heygen.com/reference/

const API_BASE = "https://api.heygen.com";

function getApiKey() {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) {
    throw new Error(
      "HEYGEN_API_KEY is not set. Copy .env.example to .env, add your key, " +
        "and run with `node --env-file=.env scripts/heygen.mjs ...`",
    );
  }
  return key;
}

async function heygenFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "X-Api-Key": getApiKey(),
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    throw new Error(
      `HeyGen API ${res.status} ${res.statusText}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

/** List the avatars available to your account. */
export function listAvatars() {
  return heygenFetch("/v2/avatars", { method: "GET" });
}

/** List the voices available to your account. */
export function listVoices() {
  return heygenFetch("/v2/voices", { method: "GET" });
}

/**
 * Kick off an avatar video generation.
 * @param {object} opts
 * @param {string} opts.text        Spoken script.
 * @param {string} opts.avatarId    HeyGen avatar_id.
 * @param {string} opts.voiceId     HeyGen voice_id.
 */
export function generateVideo({ text, avatarId, voiceId }) {
  return heygenFetch("/v2/video/generate", {
    method: "POST",
    body: JSON.stringify({
      video_inputs: [
        {
          character: { type: "avatar", avatar_id: avatarId, avatar_style: "normal" },
          voice: { type: "text", input_text: text, voice_id: voiceId },
        },
      ],
      dimension: { width: 1280, height: 720 },
    }),
  });
}

/** Poll the status of a previously started video generation. */
export function getVideoStatus(videoId) {
  return heygenFetch(`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
    method: "GET",
  });
}

// ---- CLI ------------------------------------------------------------------

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  switch (cmd) {
    case "check": {
      // Cheapest way to confirm the key is accepted.
      await listAvatars();
      console.log("✓ HEYGEN_API_KEY is valid — the API accepted the request.");
      break;
    }
    case "avatars":
      console.log(JSON.stringify(await listAvatars(), null, 2));
      break;
    case "voices":
      console.log(JSON.stringify(await listVoices(), null, 2));
      break;
    case "generate": {
      const text = args[0] ?? "Hello from HeyGen";
      const avatarId = process.env.HEYGEN_AVATAR_ID;
      const voiceId = process.env.HEYGEN_VOICE_ID;
      if (!avatarId || !voiceId) {
        throw new Error(
          "Set HEYGEN_AVATAR_ID and HEYGEN_VOICE_ID (see `avatars` and `voices` " +
            "commands to find valid ids).",
        );
      }
      console.log(JSON.stringify(await generateVideo({ text, avatarId, voiceId }), null, 2));
      break;
    }
    case "status": {
      const videoId = args[0];
      if (!videoId) throw new Error("Usage: status <video_id>");
      console.log(JSON.stringify(await getVideoStatus(videoId), null, 2));
      break;
    }
    default:
      console.log(
        [
          "Usage: node --env-file=.env scripts/heygen.mjs <command>",
          "",
          "Commands:",
          "  check                 Verify HEYGEN_API_KEY is accepted",
          "  avatars               List available avatars",
          "  voices                List available voices",
          "  generate [text]       Start an avatar video (needs HEYGEN_AVATAR_ID + HEYGEN_VOICE_ID)",
          "  status <video_id>     Check a generation's status",
        ].join("\n"),
      );
      process.exitCode = cmd ? 1 : 0;
  }
}

// Only run the CLI when executed directly, not when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
