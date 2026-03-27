import sharp from 'sharp';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const pngSourcePath = join(rootDir, 'android', 'app', 'src', 'main', 'res', 'drawable', 'final_icon_100.png');
const svgPath = join(rootDir, 'public', 'favicon.svg');
const sourceBuffer = existsSync(pngSourcePath) ? readFileSync(pngSourcePath) : readFileSync(svgPath);

// --- Web / PWA icons ---
const webIconDir = join(rootDir, 'public', 'icons');
if (!existsSync(webIconDir)) mkdirSync(webIconDir, { recursive: true });

const webSizes = [
  { size: 16, name: 'favicon-16x16.png' },
  { size: 32, name: 'favicon-32x32.png' },
  { size: 48, name: 'favicon-48x48.png' },
  { size: 180, name: 'apple-touch-icon.png' },
  { size: 192, name: 'icon-192x192.png' },
  { size: 512, name: 'icon-512x512.png' },
];

for (const { size, name } of webSizes) {
  await sharp(sourceBuffer)
    .resize(size, size)
    .png()
    .toFile(join(webIconDir, name));
  console.log(`  ✓ public/icons/${name}`);
}

// Also put apple-touch-icon at root level
await sharp(sourceBuffer)
  .resize(180, 180)
  .png()
  .toFile(join(rootDir, 'public', 'apple-touch-icon.png'));
console.log('  ✓ public/apple-touch-icon.png');

// Generate favicon.ico (32x32 PNG works as .ico substitute, but let's use 48px)
await sharp(sourceBuffer)
  .resize(48, 48)
  .png()
  .toFile(join(rootDir, 'public', 'favicon-48.png'));
console.log('  ✓ public/favicon-48.png');

// --- Android mipmap icons ---
const androidResDir = join(rootDir, 'android', 'app', 'src', 'main', 'res');
const mipmapSizes = [
  { size: 48, folder: 'mipmap-mdpi' },
  { size: 72, folder: 'mipmap-hdpi' },
  { size: 96, folder: 'mipmap-xhdpi' },
  { size: 144, folder: 'mipmap-xxhdpi' },
  { size: 192, folder: 'mipmap-xxxhdpi' },
];

// Standard icon (with background baked in)
for (const { size, folder } of mipmapSizes) {
  const outDir = join(androidResDir, folder);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  await sharp(sourceBuffer)
    .resize(size, size)
    .png()
    .toFile(join(outDir, 'ic_launcher.png'));

  await sharp(sourceBuffer)
    .resize(size, size)
    .png()
    .toFile(join(outDir, 'ic_launcher_round.png'));

  console.log(`  ✓ ${folder}/ic_launcher.png + ic_launcher_round.png (${size}px)`);
}

// --- Android adaptive icon resources ---
// Use the exact uploaded PNG as the adaptive foreground too, otherwise Android may show a different installed icon.
const adaptiveBgColor = '#171C3F';
const fgAdaptiveSizes = [
  { size: 108, folder: 'mipmap-mdpi' },
  { size: 162, folder: 'mipmap-hdpi' },
  { size: 216, folder: 'mipmap-xhdpi' },
  { size: 324, folder: 'mipmap-xxhdpi' },
  { size: 432, folder: 'mipmap-xxxhdpi' },
];

for (const { size, folder } of fgAdaptiveSizes) {
  const outDir = join(androidResDir, folder);
  const insetSize = Math.round(size * (72 / 108));
  const insetOffset = Math.round((size - insetSize) / 2);

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await sharp(sourceBuffer)
          .resize(insetSize, insetSize)
          .png()
          .toBuffer(),
        left: insetOffset,
        top: insetOffset,
      },
    ])
    .png()
    .toFile(join(outDir, 'ic_launcher_foreground.png'));
  console.log(`  ✓ ${folder}/ic_launcher_foreground.png (${size}px)`);
}

const backgroundColorXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${adaptiveBgColor}</color>
</resources>
`;

const backgroundDrawableXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="${adaptiveBgColor}"
        android:pathData="M0,0h108v108h-108z" />
</vector>
`;

writeFileSync(join(androidResDir, 'values', 'ic_launcher_background.xml'), backgroundColorXml);
writeFileSync(join(androidResDir, 'drawable', 'ic_launcher_background.xml'), backgroundDrawableXml);

console.log('\n✅ All icons generated successfully!');
