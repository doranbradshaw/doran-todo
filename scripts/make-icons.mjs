// Generates every PNG icon the PWA needs from public/favicon.svg.
// Run: node scripts/make-icons.mjs   (re-run any time you change the SVG)
import sharp from "sharp";
import { mkdir, readFile } from "node:fs/promises";

const svg = await readFile(new URL("../public/favicon.svg", import.meta.url));
await mkdir(new URL("../public/icons", import.meta.url), { recursive: true });

const out = (name) => new URL(`../public/${name}`, import.meta.url).pathname;

// Plain icons: SVG scaled to fill the square.
await sharp(svg).resize(192, 192).png().toFile(out("icons/icon-192.png"));
await sharp(svg).resize(512, 512).png().toFile(out("icons/icon-512.png"));

// Apple touch icon: iOS rounds the corners itself, so use a solid square
// with the check mark inset a little.
const appleBg = { r: 0xff, g: 0x5a, b: 0x00, alpha: 1 };
const appleMark = await sharp(svg).resize(140, 140).png().toBuffer();
await sharp({ create: { width: 180, height: 180, channels: 4, background: appleBg } })
  .composite([{ input: appleMark, gravity: "centre" }])
  .png()
  .toFile(out("apple-touch-icon.png"));

// Maskable icon: Android crops to a circle/squircle, so keep the mark
// inside the central 80% "safe zone" on a full-bleed orange background.
const maskMark = await sharp(svg).resize(360, 360).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: appleBg } })
  .composite([{ input: maskMark, gravity: "centre" }])
  .png()
  .toFile(out("icons/icon-maskable-512.png"));

console.log("icons written to public/icons and public/apple-touch-icon.png");
