#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '..', 'output');
const API_KEY = process.env.GEMINI_API_KEY;
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const IMAGE_MODELS = {
  'nano-banana': 'gemini-2.5-flash-image',
  'nano-banana-pro': 'gemini-3-pro-image',
  'nano-banana-2': 'gemini-3.1-flash-image',
};

const VEO_MODELS = {
  'veo-3.1': 'veo-3.1-generate-preview',
  'veo-3.1-fast': 'veo-3.1-fast-generate-preview',
  'veo-3.1-lite': 'veo-3.1-lite-generate-preview',
};

const OMNI_FLASH_MODEL = 'gemini-omni-flash-preview';

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function requireApiKey() {
  if (!API_KEY) {
    throw new McpError(ErrorCode.InternalError,
      'GEMINI_API_KEY is not set. Put it in gemini-mcp/.env (see .env.example) or export it before starting the server.');
  }
}

function timestampedPath(prefix, ext) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(OUTPUT_DIR, `${prefix}-${stamp}.${ext}`);
}

function extFromMime(mime) {
  if (!mime) return 'bin';
  const map = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
    'video/mp4': 'mp4', 'video/webm': 'webm',
  };
  return map[mime] || mime.split('/')[1] || 'bin';
}

/** Walk an arbitrary JSON value and collect every {mimeType,data} or {mime_type,data}-shaped
 * base64 blob found, regardless of exact response shape. Used for video responses whose exact
 * schema (Interactions API, Veo LRO response) isn't fully nailed down from public docs. */
function findInlineBlobs(value, path_ = '$', found = []) {
  if (value == null) return found;
  if (Array.isArray(value)) {
    value.forEach((v, i) => findInlineBlobs(v, `${path_}[${i}]`, found));
    return found;
  }
  if (typeof value === 'object') {
    const mime = value.mimeType || value.mime_type;
    const data = value.data || value.bytesBase64Encoded;
    if (mime && typeof data === 'string' && data.length > 100) {
      found.push({ mime, data, path: path_ });
    }
    for (const [k, v] of Object.entries(value)) {
      findInlineBlobs(v, `${path_}.${k}`, found);
    }
  }
  return found;
}

/** Same idea for a downloadable file URI (Files API / generatedFiles), in case the response
 * returns a reference instead of inline base64. */
function findFileUris(value, found = []) {
  if (value == null) return found;
  if (Array.isArray(value)) { value.forEach((v) => findFileUris(v, found)); return found; }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if ((k === 'uri' || k === 'fileUri' || k === 'url') && typeof v === 'string' && v.startsWith('http')) {
        found.push(v);
      }
      findFileUris(v, found);
    }
  }
  return found;
}

async function apiPost(pathSuffix, body) {
  const res = await fetch(`${BASE_URL}/${pathSuffix}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new McpError(ErrorCode.InternalError,
      `Gemini API ${pathSuffix} failed (HTTP ${res.status}): ${JSON.stringify(json).slice(0, 1500)}`);
  }
  return json;
}

async function apiGet(url) {
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(`${url}${sep}key=${API_KEY}`);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new McpError(ErrorCode.InternalError, `Gemini API GET failed (HTTP ${res.status}): ${JSON.stringify(json).slice(0, 1500)}`);
  }
  return json;
}

function saveDebugSnapshot(name, obj) {
  const p = path.join(OUTPUT_DIR, `_debug-${name}.json`);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

async function generateImage({ prompt, model = 'nano-banana-pro', aspectRatio, imageSize, referenceImages = [] }) {
  requireApiKey();
  const modelId = IMAGE_MODELS[model];
  if (!modelId) throw new McpError(ErrorCode.InvalidParams, `Unknown image model "${model}". Use one of: ${Object.keys(IMAGE_MODELS).join(', ')}`);

  const parts = [{ text: prompt }];
  for (const filePath of referenceImages) {
    const data = fs.readFileSync(filePath).toString('base64');
    const mimeType = filePath.endsWith('.png') ? 'image/png' : filePath.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    parts.push({ inlineData: { mimeType, data } });
  }

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        ...(aspectRatio ? { aspectRatio } : {}),
        ...(imageSize ? { imageSize } : {}),
      },
    },
  };

  const json = await apiPost(`models/${modelId}:generateContent`, body);
  const candidateParts = json.candidates?.[0]?.content?.parts || [];
  const images = candidateParts.filter((p) => p.inlineData?.data);

  if (images.length === 0) {
    const debugPath = saveDebugSnapshot('image-response', json);
    throw new McpError(ErrorCode.InternalError,
      `No image returned. Full response saved to ${debugPath}. Candidate text (if any): ${candidateParts.map((p) => p.text).filter(Boolean).join(' ') || '(none)'}`);
  }

  const savedPaths = images.map((img, i) => {
    const ext = extFromMime(img.inlineData.mimeType);
    const outPath = timestampedPath(`${model}-${i}`, ext);
    fs.writeFileSync(outPath, Buffer.from(img.inlineData.data, 'base64'));
    return outPath;
  });

  return { model: modelId, files: savedPaths };
}

async function generateVideoOmniFlash({ prompt, aspectRatio, image }) {
  const inputParts = image
    ? [{ text: prompt }, { inlineData: { mimeType: 'image/png', data: fs.readFileSync(image).toString('base64') } }]
    : prompt;

  const body = {
    model: OMNI_FLASH_MODEL,
    input: inputParts,
    response_format: { type: 'video', ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}) },
  };

  const json = await apiPost('interactions', body);
  const blobs = findInlineBlobs(json).filter((b) => b.mime.startsWith('video/'));
  const uris = findFileUris(json);

  if (blobs.length === 0 && uris.length === 0) {
    const debugPath = saveDebugSnapshot('omni-flash-response', json);
    throw new McpError(ErrorCode.InternalError,
      `Omni Flash returned no video blob or file URI I recognize. This model's response shape isn't fully ` +
      `pinned down from public docs yet — full raw response saved to ${debugPath}. Top-level keys: ${Object.keys(json).join(', ')}. ` +
      `Inspect that file and tell me the actual field names so I can fix the parser.`);
  }
  return { rawResponseKeys: Object.keys(json), blobs, uris, raw: json };
}

async function generateVideoVeo({ prompt, model, aspectRatio, durationSeconds, resolution, image }) {
  const modelId = VEO_MODELS[model];
  const instance = { prompt, ...(image ? { image: { imageBytes: fs.readFileSync(image).toString('base64'), mimeType: 'image/png' } } : {}) };
  const parameters = {
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(durationSeconds ? { durationSeconds } : {}),
    ...(resolution ? { resolution } : {}),
  };

  let op = await apiPost(`models/${modelId}:predictLongRunning`, { instances: [instance], parameters });

  const maxAttempts = 60; // ~10 min at 10s intervals
  for (let i = 0; i < maxAttempts && !op.done; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    op = await apiGet(`${BASE_URL}/${op.name}`);
  }

  if (!op.done) {
    throw new McpError(ErrorCode.InternalError, `Veo operation ${op.name} did not finish within the poll window. Check it manually: GET ${BASE_URL}/${op.name}?key=$GEMINI_API_KEY`);
  }
  if (op.error) {
    throw new McpError(ErrorCode.InternalError, `Veo operation failed: ${JSON.stringify(op.error)}`);
  }

  const blobs = findInlineBlobs(op.response).filter((b) => b.mime.startsWith('video/'));
  const uris = findFileUris(op.response);
  if (blobs.length === 0 && uris.length === 0) {
    const debugPath = saveDebugSnapshot('veo-response', op);
    throw new McpError(ErrorCode.InternalError,
      `Veo operation completed but I found no video blob or file URI I recognize. Full raw response saved to ${debugPath}. Top-level response keys: ${Object.keys(op.response || {}).join(', ')}.`);
  }
  return { modelId, blobs, uris, raw: op.response };
}

async function saveVideoResult(prefix, result) {
  const savedPaths = [];
  for (const [i, blob] of result.blobs.entries()) {
    const ext = extFromMime(blob.mime);
    const outPath = timestampedPath(`${prefix}-${i}`, ext);
    fs.writeFileSync(outPath, Buffer.from(blob.data, 'base64'));
    savedPaths.push(outPath);
  }
  for (const [i, uri] of result.uris.entries()) {
    const res = await fetch(`${uri}${uri.includes('?') ? '&' : '?'}key=${API_KEY}`);
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    const outPath = timestampedPath(`${prefix}-uri${i}`, 'mp4');
    fs.writeFileSync(outPath, buf);
    savedPaths.push(outPath);
  }
  return savedPaths;
}

async function generateVideo({ prompt, model = 'omni-flash', aspectRatio, durationSeconds, resolution, image }) {
  requireApiKey();
  let result;
  if (model === 'omni-flash') {
    result = await generateVideoOmniFlash({ prompt, aspectRatio, image });
  } else if (VEO_MODELS[model]) {
    result = await generateVideoVeo({ prompt, model, aspectRatio, durationSeconds, resolution, image });
  } else {
    throw new McpError(ErrorCode.InvalidParams, `Unknown video model "${model}". Use one of: omni-flash, ${Object.keys(VEO_MODELS).join(', ')}`);
  }
  const files = await saveVideoResult(model, result);
  if (files.length === 0) {
    throw new McpError(ErrorCode.InternalError, `Video data was found in the response but could not be saved to disk. Raw keys: ${result.rawResponseKeys || Object.keys(result.raw || {})}`);
  }
  return { model, files };
}

const TOOL_DEFINITIONS = [
  {
    name: 'gemini_generate_image',
    description: 'Generate an image with Nano Banana, Nano Banana Pro, or Nano Banana 2 (Gemini image models) and save it to gemini-mcp/output/.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Image generation prompt.' },
        model: { type: 'string', enum: Object.keys(IMAGE_MODELS), default: 'nano-banana-pro' },
        aspectRatio: { type: 'string', description: 'e.g. 16:9, 9:16, 1:1, 4:3, 3:4' },
        imageSize: { type: 'string', enum: ['1K', '2K', '4K'] },
        referenceImages: { type: 'array', items: { type: 'string' }, description: 'Local file paths of reference images to blend/edit.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'gemini_generate_video',
    description: 'Generate a video clip with Omni Flash or Veo 3.1 (Gemini video models) and save it to gemini-mcp/output/. Costs real money per call — Omni Flash is $0.10/sec of output.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Video generation prompt.' },
        model: { type: 'string', enum: ['omni-flash', ...Object.keys(VEO_MODELS)], default: 'omni-flash' },
        aspectRatio: { type: 'string', description: 'e.g. 16:9, 9:16' },
        durationSeconds: { type: 'number', description: 'Veo models only.' },
        resolution: { type: 'string', description: 'Veo models only, e.g. 720p, 1080p.' },
        image: { type: 'string', description: 'Local file path for image-to-video.' },
      },
      required: ['prompt'],
    },
  },
];

const server = new Server({ name: 'gemini-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result;
    if (name === 'gemini_generate_image') {
      result = await generateImage(args);
    } else if (name === 'gemini_generate_video') {
      result = await generateVideo(args);
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, err.message);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
