#!/usr/bin/env python3
"""
Builds manifest.json from the source transition list, merged with the
engine/technique/render-mode assignment for each of the 140 transitions.

Run: python3 build_manifest.py <source.txt> <output.json>
"""
import json
import re
import sys

GPU_NOTE = {
    "blender": "HIP + HIP-RT device (RDNA4 / RX 9060 XT)",
    "remotion": 'renderMedia({ chromiumOptions: { hardwareAcceleration: "if-possible" } })',
    "hyperframes": "hyperframes render --gpu --browser-gpu (page-side-compositing is on by default)",
    "ffmpeg": "av1_amf / h264_amf hardware encode, falls back to libx264 if AMF unavailable",
}

# id -> (engine, technique, render_mode, note)
# render_mode: "baked" (engine bridges both source clips itself, straight concat at
#              assembly) | "overlay" (transparent/blend-mode element composited over
#              a hard cut by ffmpeg) | "native" (ffmpeg builds the whole transition,
#              no external asset)
ASSIGN = {
    1: ("remotion", "3D camera / parallax", "baked", "R3F layered-plane dolly, no physics needed"),
    2: ("ffmpeg", "matte from source footage", "native", "luma/alpha matte from the moving subject in the source clip itself"),
    3: ("hyperframes", "2D texture reveal", "baked", "CSS/canvas paper-tear with drop shadow"),
    4: ("remotion", "3D camera / parallax", "baked", "R3F crash-zoom into a flat doc plane"),
    5: ("ffmpeg", "practical overlay", "overlay", "stock light-leak/film-burn element, screen/add blend"),
    6: ("remotion", "camera move + motion blur", "baked", "uses @remotion/motion-blur, already a project dependency"),
    7: ("hyperframes", "shader distortion", "baked", "WebGL RGB-split/glitch shader, page-side-compositing"),
    8: ("ffmpeg", "editorial cut", "native", "precise trim on aligned geometry, no synthetic asset"),
    9: ("hyperframes", "2D panel layout", "baked", "CSS split-screen panel assembly"),
    10: ("blender", "fluid sim", "baked", "Mantaflow fluid for physically believable ink dispersion"),
    11: ("blender", "volumetric sim", "baked", "Mantaflow smoke/fire domain"),
    12: ("remotion", "3D camera / parallax", "baked", "R3F flyover of a textured map plane + plunge"),
    13: ("hyperframes", "UI motion graphic", "baked", "pure HTML/CSS zoom into UI pixel grid"),
    14: ("hyperframes", "2D impact graphic", "baked", "CSS/canvas stamp slam + screen shake"),
    15: ("remotion", "3D camera / parallax", "baked", "R3F 90° plunge through a simple plane"),
    16: ("ffmpeg", "practical overlay", "overlay", "stock film-gate/sprocket element, blend mode"),
    17: ("ffmpeg", "lens blur", "native", "ramped gblur/boxblur filter over time, no engine needed"),
    18: ("ffmpeg", "color filter", "native", "negate/lutrgb filter, 3-frame flash"),
    19: ("blender", "cloth sim", "baked", "cloth or bendy-mesh sim for believable page curl + shadow"),
    20: ("remotion", "3D camera / parallax", "baked", "rigid 180° card flip, R3F, no physics"),
    21: ("hyperframes", "shader zoom", "baked", "WebGL halftone-dot shader, page-side-compositing"),
    22: ("blender", "particle sim", "baked", "physics-driven particle dispersal for believable dust"),
    23: ("hyperframes", "2D mask", "baked", "SVG/CSS clip-path iris mask"),
    24: ("blender", "rigid body fracture", "baked", "Cell-Fracture-style shatter + rigid body world"),
    25: ("hyperframes", "vector morph", "baked", "SVG path/vertex interpolation"),
    26: ("hyperframes", "UI motion graphic", "baked", "timeline bar sweep + title slate"),
    27: ("hyperframes", "text mask reveal", "baked", "CSS mask-composite / SVG text mask"),
    28: ("remotion", "3D camera / parallax", "baked", "R3F pan across a corkboard scene with string curve"),
    29: ("hyperframes", "chart/UI graphic", "baked", "vector chart animation with camera-follow"),
    30: ("blender", "rigged 3D scene", "baked", "miniature room with folding walls, real geometry + rig"),
    31: ("ffmpeg", "practical overlay", "overlay", "stock microfilm-reel element, horizontal whip blend"),
    32: ("blender", "rigid body + particles", "baked", "banknote fall with collision physics"),
    33: ("ffmpeg", "edit timing", "native", "rapid-fire still-frame sequencing, concat/frame-hold"),
    34: ("hyperframes", "2D lighting mask", "baked", "radial gradient vignette animation"),
    35: ("hyperframes", "shader effect", "baked", "WebGL scanline-collapse shader, page-side-compositing"),
    36: ("ffmpeg", "practical overlay", "overlay", "stock anamorphic flare element, screen blend"),
    37: ("ffmpeg", "lens distortion", "native", "ffmpeg lenscorrection/v360 filter"),
    38: ("remotion", "3D camera / parallax", "baked", "rigid card peel off a stack, R3F"),
    39: ("ffmpeg", "mask wipe", "native", "custom slat mask via geq/blend filter graph"),
    40: ("hyperframes", "shader ripple", "baked", "WebGL radial displacement shader, page-side-compositing"),
    41: ("blender", "character animation", "baked", "rigged 2.5D character, grease pencil or 3D rig"),
    42: ("blender", "rigid body", "baked", "spinning coin with physics drop"),
    43: ("ffmpeg", "dissolve", "native", "xfade dissolve timed to a source-footage tilt"),
    44: ("hyperframes", "UI motion graphic", "baked", "cursor click + radial expansion bloom"),
    45: ("remotion", "3D camera / parallax", "baked", "simple hand rotation, R3F, no physics needed"),
    46: ("hyperframes", "vector wipe", "baked", "staggered color-block bar wipe"),
    47: ("hyperframes", "shader scanline", "baked", "WebGL scanline sweep + blueprint color shader"),
    48: ("blender", "cloth / hinge sim", "baked", "multi-panel fold with correct hinge physics"),
    49: ("blender", "fluid sim", "baked", "Mantaflow liquid submersion / opacity dip"),
    50: ("hyperframes", "shader kaleidoscope", "baked", "WebGL fragment-shader facet split, page-side-compositing"),
    51: ("blender", "rigid fracture + cloth", "baked", "wax crack fracture + parchment unroll"),
    52: ("ffmpeg", "practical overlay", "overlay", "stock 35mm filmstrip element, scroll blend"),
    53: ("blender", "rigged 3D mechanism", "baked", "heavy steel doors, PBR metal material + weight"),
    54: ("remotion", "3D camera / parallax", "baked", "R3F twisted ribbon curve with mapped text"),
    55: ("hyperframes", "shader distortion", "baked", "WebGL heat-shimmer ripple shader"),
    56: ("hyperframes", "shader artifact", "baked", "WebGL macroblock/compression-artifact shader"),
    57: ("hyperframes", "UI/HUD motion graphic", "baked", "targeting reticle + isometric HUD grid"),
    58: ("blender", "rigged mechanism + cloth", "baked", "roller object + paper lay-down on brick wall"),
    59: ("hyperframes", "2D lens mask", "baked", "CSS/canvas radial magnify mask"),
    60: ("blender", "rigid body", "baked", "heavy gate drop with inertia/bounce"),
    61: ("ffmpeg", "practical overlay", "overlay", "stock film-burn element, screen/add blend"),
    62: ("hyperframes", "split-flap UI", "baked", "classic CSS/JS split-flap (Solari) board"),
    63: ("hyperframes", "2D light sweep", "baked", "volumetric-look light cone via canvas radial gradient"),
    64: ("remotion", "3D camera / parallax", "baked", "rotating triangular prism slats, R3F"),
    65: ("hyperframes", "text animation", "baked", "typewriter letter-by-letter CSS/JS reveal"),
    66: ("ffmpeg", "practical overlay", "overlay", "stock countdown-leader element, radial mask"),
    67: ("ffmpeg", "color LUT", "native", "pseudocolor/lut3d filter for false-color thermal swap"),
    68: ("ffmpeg", "strobe flash", "native", "rapid eq/curves overexposure strobe"),
    69: ("hyperframes", "shader reveal", "baked", "canvas progressive-reveal 'developing' shader"),
    70: ("blender", "rigged 3D mechanism", "baked", "industrial roller rig + newsprint material"),
    71: ("blender", "rigid body", "baked", "mechanical drawer kick with physics"),
    72: ("hyperframes", "2D texture wipe", "baked", "chalkboard eraser sweep, canvas dust trail"),
    73: ("blender", "rigid body + PBR", "baked", "stacking gold bars, physics + PBR gold material"),
    74: ("hyperframes", "shader scanline", "baked", "WebGL scanline reveal + skeletal color swap"),
    75: ("ffmpeg", "signal distortion", "native", "VHS tracking distortion via geq/noise filters"),
    76: ("remotion", "3D camera / parallax", "baked", "three.js textured sphere + cloud-layer plunge"),
    77: ("blender", "rigid body collision", "baked", "piece-on-piece collision physics"),
    78: ("hyperframes", "2D glow shader", "baked", "CSS/canvas neon flicker + glow filter"),
    79: ("blender", "particle sim", "baked", "burn-through + ash particle dispersal"),
    80: ("hyperframes", "code-rain shader", "baked", "canvas/WebGL matrix-style cascade"),
    81: ("hyperframes", "2D split wipe", "baked", "CSS clip-path diagonal split + reflective highlight sweep"),
    82: ("remotion", "3D wireframe build", "baked", "three.js procedural wireframe terrain"),
    83: ("blender", "rigged mechanism", "baked", "dial spin + heavy door swing physics"),
    84: ("blender", "fluid sim", "baked", "Mantaflow swirling ink plume in water"),
    85: ("hyperframes", "shader displacement", "baked", "WebGL pixel-smear displacement map"),
    86: ("remotion", "3D camera / parallax", "baked", "simple needle oscillation + lock, R3F"),
    87: ("hyperframes", "2D silhouette", "baked", "CSS/canvas shadow-stretch to black"),
    88: ("ffmpeg", "color LUT + flash", "native", "lut3d/eq flash, native filter"),
    89: ("remotion", "3D infinite corridor", "baked", "three.js recursive nested-frame corridor trick"),
    90: ("ffmpeg", "practical overlay", "overlay", "stock film-damage element, blend mode"),
    91: ("hyperframes", "2D perforation mask", "baked", "SVG/canvas die-cut tear animation"),
    92: ("blender", "rigid body + particles", "baked", "banknotes ejected at high RPM with physics"),
    93: ("ffmpeg", "practical overlay", "overlay", "stock filmstrip element, diagonal splice"),
    94: ("hyperframes", "vector data-viz", "baked", "SVG org-chart draw-on animation"),
    95: ("blender", "rigid body collision", "baked", "stack-drop with contact/collision physics"),
    96: ("hyperframes", "shader interlace", "baked", "canvas progressive-interlace reveal"),
    97: ("remotion", "3D curve geometry", "baked", "three.js procedural wire/tube curve whip, no physics"),
    98: ("hyperframes", "2D specular sweep", "baked", "CSS/canvas gold-foil emboss glint sweep"),
    99: ("hyperframes", "2D skew/scratch", "baked", "canvas skew + noise, precise control over needle-scratch timing"),
    100: ("remotion", "3D camera / parallax", "baked", "footage plane settling into 3D end-card, R3F"),
    101: ("hyperframes", "shader denoise", "baked", "WebGL procedural noise-to-image denoise simulation"),
    102: ("blender", "rigid body + particles", "baked", "cap physics + gas/mist particle burst"),
    103: ("remotion", "3D hinge rotation", "baked", "simple hinged-flap rotation, R3F, no full physics"),
    104: ("remotion", "3D camera / parallax", "baked", "prop rotation + crash zoom, R3F"),
    105: ("blender", "rigid body + particles", "baked", "envelope opening + coin shower physics"),
    106: ("blender", "rigged prop + PBR", "baked", "detailed mechanical prop, photoreal gold material"),
    107: ("blender", "fluid sim", "baked", "Mantaflow droplet splash"),
    108: ("blender", "rigid body + fluid", "baked", "barrel roll physics + fluid oil spray"),
    109: ("hyperframes", "UI mockup", "baked", "pure HTML/CSS notification banner + tap bloom"),
    110: ("blender", "rigged 3D + volumetric", "baked", "train charge + volumetric steam + impact"),
    111: ("remotion", "3D hinge rotation", "baked", "turnstile arm rotation, R3F, no full physics"),
    112: ("hyperframes", "2D UI overlay", "baked", "CSS window-shade pull-down + glare"),
    113: ("hyperframes", "audio-reactive shader", "baked", "WebGL particle orb, page-side-compositing"),
    114: ("blender", "rigid body", "baked", "latch pop + heavy lid swing physics"),
    115: ("hyperframes", "2D build wipe", "baked", "CSS/canvas staggered brick-stack wipe"),
    116: ("ffmpeg", "reverse playback", "native", "reverse filter + tracking-line overlay"),
    117: ("blender", "rigid body", "baked", "crate pry-open with nail-pop physics"),
    118: ("blender", "cloth sim", "baked", "cloth sim for correct rug unroll drape"),
    119: ("remotion", "3D camera / parallax", "baked", "prop slide + crash zoom, R3F, no physics"),
    120: ("blender", "volumetric sim", "baked", "Mantaflow gas/foam volumetric blast"),
    121: ("remotion", "3D transparency", "baked", "translucent 3D cube + node network, three.js"),
    122: ("blender", "rigid body + chain", "baked", "mechanical snap + chain-link physics"),
    123: ("blender", "rigid body constraint", "baked", "wheel spin + ball physics, realistic deceleration"),
    124: ("hyperframes", "2D shatter shader", "baked", "canvas/WebGL stylized UI shard burst"),
    125: ("blender", "fluid sim", "baked", "droplet spreading on glass, Mantaflow"),
    126: ("blender", "fire/smoke sim", "baked", "believable ignition flare timing"),
    127: ("blender", "character animation", "baked", "rigged 3D creature, animated trunk swing"),
    128: ("hyperframes", "2D vector spin", "baked", "CSS/canvas vortex logo spin"),
    129: ("blender", "rigid body + volumetric", "baked", "cork pop + vapor + glass refraction plunge"),
    130: ("blender", "rigid body + fluid", "baked", "plunger physics + fluid spray wash"),
    131: ("blender", "cloth / soft body", "baked", "glass press + leaf crush/dry simulation"),
    132: ("hyperframes", "particle shader", "baked", "canvas/WebGL falling-snow particle vignette"),
    133: ("blender", "fluid / ocean sim", "baked", "ocean modifier / Mantaflow wave swell"),
    134: ("hyperframes", "shader growth", "baked", "WebGL frost-crystal procedural growth shader"),
    135: ("blender", "volumetric sim", "baked", "Mantaflow dust-wall domain"),
    136: ("blender", "fluid / ocean sim", "baked", "ocean sim bottle bob + fluid interaction"),
    137: ("hyperframes", "2D sprite animation", "baked", "flat mascot sprite + scarf sweep, canvas"),
    138: ("blender", "volumetric + practical alt", "baked", "muzzle flash + volumetric gunsmoke (ffmpeg stock-overlay is the budget alt)"),
    139: ("hyperframes", "SVG path animation", "baked", "glowing pulse-line path animation with glow filter"),
    140: ("blender", "rigid body", "baked", "mechanical hinge fold + snap physics"),
}


def parse_source(path):
    items = []
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read()
    for line in raw.splitlines():
        content = line.strip()
        if not content:
            continue
        if "–" in content:
            name, desc = content.split("–", 1)
        elif " - " in content:
            name, desc = content.split(" - ", 1)
        else:
            name, desc = content, ""
        items.append((name.strip(), desc.strip()))
    return items


def main():
    src, out = sys.argv[1], sys.argv[2]
    items = parse_source(src)
    if len(items) != 140:
        print(f"WARNING: parsed {len(items)} items, expected 140", file=sys.stderr)

    manifest = []
    counts = {}
    for i, (name, desc) in enumerate(items, start=1):
        if i not in ASSIGN:
            print(f"WARNING: no assignment for id {i} ({name})", file=sys.stderr)
            continue
        engine, technique, render_mode, note = ASSIGN[i]
        counts[engine] = counts.get(engine, 0) + 1
        manifest.append({
            "id": i,
            "name": name,
            "description": desc,
            "engine": engine,
            "technique": technique,
            "render_mode": render_mode,
            "note": note,
            "gpu": GPU_NOTE[engine],
        })

    with open(out, "w", encoding="utf-8") as f:
        json.dump({"transitions": manifest, "engine_counts": counts}, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(manifest)} transitions to {out}")
    print("Engine split:", counts)


if __name__ == "__main__":
    main()
