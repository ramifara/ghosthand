// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Deterministic exports of the supplied artwork. Requires ImageMagick 7, not a model or API key.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const brand = join(root, "assets/brand");
const source = join(brand, "source/ghosthand-original.png");
const web = join(brand, "web/brand");
const build = join(root, "apps/desktop/build");
const sizes = [16, 24, 32, 48, 64, 96, 128, 180, 192, 256, 512, 1024];
for (const dir of ["png", "black", "social", "web/brand"]) mkdirSync(join(brand, dir), { recursive: true });
mkdirSync(build, { recursive: true });

function convert(args: string[]): void {
  execFileSync("magick", args, { stdio: "inherit" });
}

// Ignore nearly invisible export noise when measuring the subject. Crop with extra room for its glow;
// preserve the original color and alpha inside that frame, including the gaps between the fingers.
const bounds = execFileSync(
  "magick",
  [source, "-alpha", "extract", "-threshold", "5%", "-trim", "-format", "%wx%h%X%Y", "info:"],
  { encoding: "utf8" },
).trim();
const match = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(bounds);
if (!match) throw new Error(`Cannot measure artwork: ${bounds}`);
const width = Number(match[1]);
const height = Number(match[2]);
const x = Number(match[3]);
const y = Number(match[4]);
const glowMargin = 24;
const crop = `${width + glowMargin * 2}x${height + glowMargin * 2}+${x - glowMargin}+${y - glowMargin}`;

function square(size: number, opaque: boolean): string[] {
  // Consistent 8% padding keeps the full silhouette visible in icons at every size.
  const content = Math.round(size * 0.84);
  return [
    source,
    "-crop",
    crop,
    "+repage",
    "-colorspace",
    "sRGB",
    "-filter",
    "Lanczos",
    "-resize",
    `${content}x${content}`,
    "-gravity",
    "center",
    "-background",
    "none",
    "-extent",
    `${size}x${size}`,
    ...(opaque ? ["-background", "black", "-alpha", "remove", "-alpha", "off"] : []),
    "-strip",
    "-depth",
    "8",
  ];
}

for (const size of sizes) {
  convert([...square(size, false), `PNG32:${join(brand, `png/ghosthand-${size}.png`)}`]);
  convert([...square(size, true), `PNG24:${join(brand, `black/ghosthand-${size}.png`)}`]);
}
convert([...square(1024, true), "-quality", "95", join(brand, "black/ghosthand.jpg")]);

// PNG remains the first choice for browsers and the native window icon.
for (const size of [32, 64, 128, 192, 512]) {
  copyFileSync(join(brand, `png/ghosthand-${size}.png`), join(web, `ghosthand-${size}.png`));
}
copyFileSync(join(brand, "png/ghosthand-16.png"), join(web, "favicon-16.png"));
copyFileSync(join(brand, "png/ghosthand-32.png"), join(web, "favicon-32.png"));
copyFileSync(join(brand, "black/ghosthand-180.png"), join(web, "apple-touch-icon.png"));
copyFileSync(join(brand, "png/ghosthand-1024.png"), join(build, "icon.png"));

// ICO is opaque black at every embedded resolution, including the browser fallback.
convert([
  ...square(256, true),
  "-define",
  "icon:auto-resize=256,128,64,48,32,24,16",
  join(build, "icon.ico"),
]);
convert([...square(48, true), "-define", "icon:auto-resize=48,32,16", join(web, "favicon.ico")]);

// Modern ICNS is a container of PNG representations. Include standard and Retina slots, all black.
const representations: [string, number][] = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
  ["ic11", 32],
  ["ic12", 64],
  ["ic13", 256],
  ["ic14", 512],
];
const chunks = representations.map(([type, size]) => {
  const png = readFileSync(join(brand, `black/ghosthand-${size}.png`));
  const header = Buffer.alloc(8);
  header.write(type, 0, "ascii");
  header.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([header, png]);
});
const icnsHeader = Buffer.alloc(8);
icnsHeader.write("icns", 0, "ascii");
icnsHeader.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
writeFileSync(join(build, "icon.icns"), Buffer.concat([icnsHeader, ...chunks]));

// Assisted Windows installer artwork uses 24-bit BMP, which has no alpha channel.
for (const [name, w, h] of [
  ["installer-header", 150, 57],
  ["installer-sidebar", 164, 314],
] as const) {
  const content = Math.round(Math.min(w, h) * 0.84);
  convert([
    source,
    "-crop",
    crop,
    "+repage",
    "-filter",
    "Lanczos",
    "-resize",
    `${content}x${content}`,
    "-background",
    "black",
    "-alpha",
    "remove",
    "-alpha",
    "off",
    "-gravity",
    "center",
    "-extent",
    `${w}x${h}`,
    "-strip",
    "-depth",
    "8",
    `BMP3:${join(build, `${name}.bmp`)}`,
  ]);
}

// Sharing systems that flatten artwork get explicit black, with no stretched or clipped fingers.
for (const ext of ["png", "jpg"]) {
  convert([
    source,
    "-crop",
    crop,
    "+repage",
    "-filter",
    "Lanczos",
    "-resize",
    "520x520",
    "-background",
    "black",
    "-alpha",
    "remove",
    "-alpha",
    "off",
    "-gravity",
    "center",
    "-extent",
    "1200x630",
    "-strip",
    "-depth",
    "8",
    "-quality",
    "95",
    join(brand, `social/ghosthand-1200x630.${ext}`),
  ]);
}
console.log("Prepared transparent PNGs, black exports, web icons and desktop packaging assets.");
