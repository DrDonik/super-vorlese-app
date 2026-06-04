import sharp from 'sharp';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Turns the heavy 1024×1024 source illustrations in doc/mood-icons/ into small
// web-ready WebP tiles shipped under public/mood-icons/. The originals (2–4 MB
// each, ~52 MB total) stay out of the bundle; only these lightweight versions
// (~15–30 KB each) are served and precached by the PWA. Run via the prebuild
// hook so the shipped assets are always reproducible from the source PNGs.

const here = dirname(fileURLToPath(import.meta.url));
const sourceDir = resolve(here, '..', 'doc', 'mood-icons');
const outDir = resolve(here, '..', 'public', 'mood-icons');
mkdirSync(outDir, { recursive: true });

const SIZE = 256; // ~96 px on-screen tile at up to ~2.5× retina

// The heavy source PNGs are intentionally not committed (~52 MB); the generated
// WebP tiles under public/mood-icons/ are. So a clean checkout without the
// originals still builds — there is simply nothing to regenerate.
if (!existsSync(sourceDir)) {
  console.log('mood-icons: no source PNGs found, using committed WebP tiles as-is');
  process.exit(0);
}

const sources = readdirSync(sourceDir).filter((f) => f.toLowerCase().endsWith('.png'));

for (const file of sources) {
  const slug = file.replace(/\.png$/i, '');
  await sharp(resolve(sourceDir, file))
    .resize(SIZE, SIZE, { fit: 'cover' })
    .webp({ quality: 82 })
    .toFile(resolve(outDir, `${slug}.webp`));
  console.log(`generated mood-icons/${slug}.webp`);
}
