// Build-time only. Converts a system TTF into a minimal three.js "typeface"
// (facetype) JSON containing ONLY the glyphs the hero numeral needs, so the
// composition can parse it synchronously at render time with no network fetch.
//
//   node build-font.mjs
//
// Output: ../assets/hero-font.typeface.json
import opentype from "opentype.js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TTF = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf";
const CHARS = "$4.5B"; // the only glyphs the hero needs
const OUT = join(HERE, "..", "assets", "hero-font.typeface.json");

const font = opentype.loadSync(TTF);
const upm = font.unitsPerEm;
const round = (n) => Math.round(n);

// Convert one glyph's outline to a facetype "o" command string (y-up font units).
function outline(glyph) {
  const path = glyph.getPath(0, 0, upm); // scale 1; opentype emits y-down
  const parts = [];
  for (const c of path.commands) {
    // negate y to restore the y-up convention three.js FontLoader expects
    switch (c.type) {
      case "M":
        parts.push("m", round(c.x), round(-c.y));
        break;
      case "L":
        parts.push("l", round(c.x), round(-c.y));
        break;
      case "Q": // three wants: q endX endY ctrlX ctrlY
        parts.push("q", round(c.x), round(-c.y), round(c.x1), round(-c.y1));
        break;
      case "C": // three wants: b endX endY c1x c1y c2x c2y
        parts.push(
          "b",
          round(c.x),
          round(-c.y),
          round(c.x1),
          round(-c.y1),
          round(c.x2),
          round(-c.y2),
        );
        break;
      case "Z":
      default:
        break; // contours close implicitly at the next moveTo
    }
  }
  return parts.join(" ");
}

const glyphs = {};
for (const ch of CHARS) {
  const g = font.charToGlyph(ch);
  const bb = g.getBoundingBox();
  glyphs[ch] = {
    ha: round(g.advanceWidth),
    x_min: round(bb.x1),
    x_max: round(bb.x2),
    o: outline(g),
  };
}

const typeface = {
  glyphs,
  familyName: "LiberationSans-Bold (subset)",
  ascender: round(font.ascender),
  descender: round(font.descender),
  underlinePosition: -217,
  underlineThickness: 150,
  boundingBox: {
    yMin: round(font.descender),
    xMin: 0,
    yMax: round(font.ascender),
    xMax: upm,
  },
  resolution: upm,
  original_font_information: { format: 0, fontFamily: "subset for HyperFrames hero" },
  cssFontWeight: "bold",
  cssFontStyle: "normal",
};

writeFileSync(OUT, JSON.stringify(typeface));
console.log("wrote", OUT, "glyphs:", Object.keys(glyphs).join(""), "upm:", upm);
