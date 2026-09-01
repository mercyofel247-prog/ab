// Build a three.js typeface JSON from Anton-Regular.ttf, containing only the
// glyphs the hero needs ($ 0 1 B). Output format matches what THREE.FontLoader
// expects (glyph outlines as "m/l/q/b" command strings at font em resolution).
//
// Run: node build-typeface.mjs  → writes assets/fonts/anton.typeface.json
import fs from "node:fs";
import opentype from "opentype.js";

const font = opentype.loadSync("assets/fonts/Anton-Regular.ttf");
const RES = font.unitsPerEm; // 1000 for Anton
const CHARS = "$0 1B".replace(/\s/g, "").split(""); // $ 0 1 B

const round = (n) => Math.round(n);

function glyphToOutline(glyph) {
  // opentype path is in font units, y-up. three expects y-up font units too.
  const path = glyph.getPath(0, 0, RES); // scale so em == RES, baseline at 0
  // getPath with fontSize=RES maps em to RES units but flips y (screen coords).
  // We instead use the raw glyph path in font units to preserve three's y-up.
  const cmds = glyph.path.commands;
  let o = "";
  for (const c of cmds) {
    if (c.type === "M") o += `m ${round(c.x)} ${round(c.y)} `;
    else if (c.type === "L") o += `l ${round(c.x)} ${round(c.y)} `;
    else if (c.type === "Q") o += `q ${round(c.x)} ${round(c.y)} ${round(c.x1)} ${round(c.y1)} `;
    else if (c.type === "C") o += `b ${round(c.x)} ${round(c.y)} ${round(c.x1)} ${round(c.y1)} ${round(c.x2)} ${round(c.y2)} `;
    else if (c.type === "Z") o += ""; // three closes each contour implicitly
  }
  return o.trim();
}

const glyphs = {};
for (const ch of CHARS) {
  const g = font.charToGlyph(ch);
  glyphs[ch] = {
    ha: round(g.advanceWidth),
    x_min: round(g.getMetrics().xMin || 0),
    x_max: round(g.getMetrics().xMax || 0),
    o: glyphToOutline(g),
  };
}

const os2 = font.tables.os2 || {};
const head = font.tables.head || {};
const hhea = font.tables.hhea || {};

const typeface = {
  glyphs,
  familyName: "Anton",
  ascender: round(hhea.ascender ?? RES * 0.8),
  descender: round(hhea.descender ?? -RES * 0.2),
  underlinePosition: round(font.tables.post?.underlinePosition ?? -100),
  underlineThickness: round(font.tables.post?.underlineThickness ?? 50),
  boundingBox: {
    yMin: round(head.yMin ?? -RES * 0.2),
    xMin: round(head.xMin ?? 0),
    yMax: round(head.yMax ?? RES),
    xMax: round(head.xMax ?? RES),
  },
  resolution: RES,
  original_font_information: { font_family_name: "Anton", font_subfamily_name: "Regular" },
  cssFontWeight: "normal",
  cssFontStyle: "normal",
};

fs.writeFileSync("assets/fonts/anton.typeface.json", JSON.stringify(typeface));
console.log(
  `wrote anton.typeface.json — ${CHARS.length} glyphs (${CHARS.join("")}), resolution ${RES}`,
);
for (const ch of CHARS) {
  console.log(`  '${ch}': ha=${glyphs[ch].ha}, outline ${glyphs[ch].o.length} chars`);
}
