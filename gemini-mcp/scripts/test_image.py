#!/usr/bin/env python3
"""Quick live test: generate one image via the Gemini API and save it.

Usage:
  python3 scripts/test_image.py [model]

  model defaults to nano-banana-pro. Choices: nano-banana, nano-banana-pro, nano-banana-2
"""
import os
import sys
from pathlib import Path

from google import genai
from google.genai import types

MODELS = {
    "nano-banana": "gemini-2.5-flash-image",
    "nano-banana-pro": "gemini-3-pro-image",
    "nano-banana-2": "gemini-3.1-flash-image",
}

HERE = Path(__file__).resolve().parent.parent
OUTPUT_DIR = HERE / "output"


def load_api_key():
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key
    env_path = HERE / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("GEMINI_API_KEY="):
                return line.split("=", 1)[1].strip()
    sys.exit("GEMINI_API_KEY not set and not found in gemini-mcp/.env")


def main():
    model_key = sys.argv[1] if len(sys.argv) > 1 else "nano-banana-pro"
    model_id = MODELS.get(model_key)
    if not model_id:
        sys.exit(f"Unknown model '{model_key}'. Choices: {', '.join(MODELS)}")

    client = genai.Client(api_key=load_api_key())

    print(f"Requesting image from {model_id} ({model_key})...")
    response = client.models.generate_content(
        model=model_id,
        contents="A single red apple on a plain white background, studio lighting, minimal",
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            image_config=types.ImageConfig(aspect_ratio="1:1"),
        ),
    )

    OUTPUT_DIR.mkdir(exist_ok=True)
    saved = []
    for part in response.candidates[0].content.parts:
        if part.inline_data and part.inline_data.data:
            ext = "png" if "png" in (part.inline_data.mime_type or "") else "jpg"
            out_path = OUTPUT_DIR / f"test-{model_key}.{ext}"
            out_path.write_bytes(part.inline_data.data)
            saved.append(out_path)
        elif part.text:
            print("Model text:", part.text)

    if not saved:
        sys.exit("No image data in response — check the printed text above for why.")

    for p in saved:
        print(f"Saved: {p}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # surface the real API error instead of a bare traceback
        sys.exit(f"Request failed: {e}")
