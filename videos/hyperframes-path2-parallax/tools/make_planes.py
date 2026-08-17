#!/usr/bin/env python3
"""
Generate the three depth-plane STAND-IN images for the Route C parallax push.

These are deliberately low-detail, tonally-correct placeholders that carry the
scene's DEPTH STRUCTURE (Z0 desk edge / Z1 subject / Z2 void+haze) so the
parallax rig can be authored, previewed and rendered with correct plane
separation. They are NOT the final photographic art — replace them with the
real A-anchor still, segmented into the same three planes at the same 3840x2160
frame, keeping the file names below.

Palette is locked to the Track-2 oxblood look:
  near-black ground   #0B0B0C .. #141416
  warm-bone highlight #EDE8DD
  oxblood accent      #7A160E  (emissive rim ONLY, never a flat fill)
  graphite secondary  #3A3A3E

No grain / vignette / LUT is baked in — the master grade is applied later in
DaVinci as a single LUT pass, so these planes stay clean and grade-ready
(crushed blacks, protected highlights).
"""

import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 3840, 2160
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "assets"))

# --- scene anchors (match the reference framing) ------------------------------
EYE_X, EYE_Y = 1270, 470          # focal anchor: the subject's eye
SUBJ_CX = 1250                    # subject horizontal centre (left of frame centre)
DESK_Y = 1730                     # top edge of the foreground desk

NEAR_BLACK = np.array([11, 11, 12], float)
GROUND_HI = np.array([20, 20, 22], float)
GRAPHITE = np.array([58, 58, 62], float)
OXBLOOD = np.array([122, 22, 14], float)
BONE = np.array([237, 232, 221], float)


def _yx():
    ys = np.linspace(0, H - 1, H)[:, None]
    xs = np.linspace(0, W - 1, W)[None, :]
    return ys, xs


def radial(cx, cy, r, inner, outer, power=0.5):
    """Soft elliptical radial: `inner` at centre → `outer` at radius r."""
    ys, xs = _yx()
    d = np.sqrt(((xs - cx) ** 2 + (ys - cy) ** 2)) / r
    t = np.clip(d, 0, 1) ** power
    t = t[..., None]
    return inner[None, None, :] * (1 - t) + outer[None, None, :] * t


def to_img(arr):
    return Image.fromarray(np.clip(arr, 0, 255).astype("uint8"), "RGB")


def soft_blob(cx, cy, rx, ry, blur):
    """Return a float [0,1] mask with a soft elliptical blob."""
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(blur))
    return np.asarray(m, float) / 255.0


# ------------------------------------------------------------------------------
# Z2 — void + haze (opaque background plane)
# ------------------------------------------------------------------------------
def make_void():
    # Cool desaturated base with a faint graphite bloom drifting camera-right.
    base = radial(W * 0.60, H * 0.46, W * 0.72,
                  GROUND_HI * 1.15 + (GRAPHITE - GROUND_HI) * 0.35,
                  NEAR_BLACK, power=0.6)

    # Warm oxblood key spill on the subject side (emissive, added as light).
    glow = soft_blob(SUBJ_CX - 180, EYE_Y + 270, 440, 630, 260)[..., None]
    base = base + glow * (OXBLOOD * 0.42)[None, None, :]

    # Haze: soft luminous fog sitting in front of the void, brightest low-centre
    # where it will later "part toward camera".
    haze = soft_blob(int(W * 0.57), int(H * 0.78), int(W * 0.37), int(H * 0.36), 200)[..., None]
    fog = (GROUND_HI + (GRAPHITE - GROUND_HI) * 0.5)[None, None, :]
    base = base * (1 - haze * 0.55) + fog * (haze * 0.55)

    to_img(base).save(os.path.join(OUT, "z2-void.png"))


# ------------------------------------------------------------------------------
# Z1 — subject (RGBA, transparent around the figure)
# ------------------------------------------------------------------------------
def make_subject():
    rgb = Image.new("RGB", (W, H), (0, 0, 0))
    alpha = Image.new("L", (W, H), 0)
    ad = ImageDraw.Draw(alpha)
    rd = ImageDraw.Draw(rgb)

    body_fill = tuple(int(v) for v in (NEAR_BLACK + (GROUND_HI - NEAR_BLACK) * 0.6))

    head = [SUBJ_CX - 150, EYE_Y - 240, SUBJ_CX + 150, EYE_Y + 260]
    ad.ellipse(head, fill=255)
    rd.ellipse(head, fill=body_fill)
    ad.rectangle([SUBJ_CX - 95, EYE_Y + 180, SUBJ_CX + 95, EYE_Y + 470], fill=255)
    rd.rectangle([SUBJ_CX - 95, EYE_Y + 180, SUBJ_CX + 95, EYE_Y + 470], fill=body_fill)
    torso = [
        (SUBJ_CX - 250, EYE_Y + 380),
        (SUBJ_CX + 250, EYE_Y + 380),
        (SUBJ_CX + 560, H),
        (SUBJ_CX - 560, H),
    ]
    ad.polygon(torso, fill=255)
    rd.polygon(torso, fill=body_fill)

    alpha = alpha.filter(ImageFilter.GaussianBlur(6))
    rgb = rgb.filter(ImageFilter.GaussianBlur(8))
    body_mask = np.asarray(alpha, float) / 255.0

    rgb_arr = np.asarray(rgb, float)

    # Warm oxblood rim on the subject's left contour (emissive edge glow only).
    rim = np.zeros((H, W), float)
    rm = Image.new("L", (W, H), 0)
    rmd = ImageDraw.Draw(rm)
    rmd.ellipse([head[0] - 26, head[1] - 26, head[2] - 200, head[3] + 40], fill=255)
    rmd.polygon([
        (SUBJ_CX - 250, EYE_Y + 380),
        (SUBJ_CX - 120, EYE_Y + 380),
        (SUBJ_CX - 430, H),
        (SUBJ_CX - 560, H),
    ], fill=255)
    rm = rm.filter(ImageFilter.GaussianBlur(34))
    rim = (np.asarray(rm, float) / 255.0) * body_mask
    rgb_arr = rgb_arr * (1 - rim[..., None] * 0.9) + OXBLOOD[None, None, :] * (rim[..., None] * 0.9)

    # Faint bone highlight catching the cheek / brow.
    hi = soft_blob(EYE_X + 30, EYE_Y + 40, 100, 160, 60) * body_mask
    hi_col = (NEAR_BLACK + (BONE - NEAR_BLACK) * 0.5)
    rgb_arr = rgb_arr * (1 - hi[..., None] * 0.55) + hi_col[None, None, :] * (hi[..., None] * 0.55)

    out = to_img(rgb_arr).convert("RGBA")
    out.putalpha(alpha)
    out.save(os.path.join(OUT, "z1-subject.png"))


# ------------------------------------------------------------------------------
# Z0 — foreground desk edge (RGBA)
# ------------------------------------------------------------------------------
def make_desk():
    rgb = Image.new("RGB", (W, H), (0, 0, 0))
    alpha = Image.new("L", (W, H), 0)
    ad = ImageDraw.Draw(alpha)
    rd = ImageDraw.Draw(rgb)

    desk_fill = tuple(int(v) for v in (NEAR_BLACK + (GROUND_HI - NEAR_BLACK) * 0.35))
    slab = [(0, DESK_Y + 40), (W, DESK_Y - 10), (W, H), (0, H)]
    ad.polygon(slab, fill=255)
    rd.polygon(slab, fill=desk_fill)

    # Pen-cup silhouette on the right of the desk.
    cup = [2660, DESK_Y - 120, 2760, DESK_Y + 30]
    cup_fill = tuple(int(v) for v in (NEAR_BLACK + (GROUND_HI - NEAR_BLACK) * 0.2))
    ad.rectangle(cup, fill=255)
    rd.rectangle(cup, fill=cup_fill)
    pen_fill = tuple(int(v) for v in (NEAR_BLACK + (GROUND_HI - NEAR_BLACK) * 0.3))
    for dx in (-18, 6, 30):
        ad.line([(2710 + dx, DESK_Y - 120), (2710 + dx * 2, DESK_Y - 250)], fill=255, width=10)
        rd.line([(2710 + dx, DESK_Y - 120), (2710 + dx * 2, DESK_Y - 250)], fill=pen_fill, width=10)

    alpha = alpha.filter(ImageFilter.GaussianBlur(3))
    rgb = rgb.filter(ImageFilter.GaussianBlur(3))
    rgb_arr = np.asarray(rgb, float)

    # Soft graphite sheen along the desk's top edge.
    edge = Image.new("L", (W, H), 0)
    ImageDraw.Draw(edge).line([(0, DESK_Y + 40), (W, DESK_Y - 10)], fill=255, width=6)
    edge = np.asarray(edge.filter(ImageFilter.GaussianBlur(9)), float) / 255.0
    rgb_arr = rgb_arr * (1 - edge[..., None] * 0.5) + GRAPHITE[None, None, :] * (edge[..., None] * 0.5)

    out = to_img(rgb_arr).convert("RGBA")
    out.putalpha(alpha)
    out.save(os.path.join(OUT, "z0-desk.png"))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print("Generating depth planes into", OUT)
    make_void()
    print("  z2-void.png")
    make_subject()
    print("  z1-subject.png")
    make_desk()
    print("  z0-desk.png")
    print("done")
