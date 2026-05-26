import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.log('sharp not installed, skipping icon generation');
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '..', 'public');
mkdirSync(publicDir, { recursive: true });

const svgPath = resolve(publicDir, 'favicon.svg');
if (!existsSync(svgPath)) {
  console.log('favicon.svg not found, skipping icon generation');
  process.exit(0);
}
const svg = readFileSync(svgPath);

const sizes = [
  { size: 192, name: 'icon-192.png' },
  { size: 512, name: 'icon-512.png' },
  { size: 180, name: 'apple-touch-icon.png' },
];

for (const { size, name } of sizes) {
  await sharp(svg, { density: 384 })
    .resize(size, size)
    .png()
    .toFile(resolve(publicDir, name));
  console.log(`generated ${name}`);
}
