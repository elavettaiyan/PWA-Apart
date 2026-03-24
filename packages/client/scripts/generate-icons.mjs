import sharp from 'sharp';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const svgPath = join(rootDir, 'public', 'favicon.svg');
const svgBuffer = readFileSync(svgPath);

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
  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(join(webIconDir, name));
  console.log(`  ✓ public/icons/${name}`);
}

// Also put apple-touch-icon at root level
await sharp(svgBuffer)
  .resize(180, 180)
  .png()
  .toFile(join(rootDir, 'public', 'apple-touch-icon.png'));
console.log('  ✓ public/apple-touch-icon.png');

// Generate favicon.ico (32x32 PNG works as .ico substitute, but let's use 48px)
await sharp(svgBuffer)
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

  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(join(outDir, 'ic_launcher.png'));

  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(join(outDir, 'ic_launcher_round.png'));

  console.log(`  ✓ ${folder}/ic_launcher.png + ic_launcher_round.png (${size}px)`);
}

// --- Android adaptive icon foreground (108dp with 72dp safe zone, rendered at 432px) ---
// Create foreground-only version: just the buildings on transparent background
const fgSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">
  <defs>
    <linearGradient id="link" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#7EC8C8"/>
      <stop offset="100%" stop-color="#A8DEDE"/>
    </linearGradient>
  </defs>
  <!-- Adaptive icon uses 108dp canvas, safe zone is inner 72dp (18dp inset) -->
  <g transform="translate(18,18) scale(0.140625)">
    <!-- Left taller building -->
    <rect x="120" y="100" width="120" height="306" rx="10" fill="white"/>
    <rect x="140" y="128" width="30" height="28" rx="5" fill="#102B2C" opacity="0.35"/>
    <rect x="190" y="128" width="30" height="28" rx="5" fill="#102B2C" opacity="0.35"/>
    <rect x="140" y="176" width="30" height="28" rx="5" fill="#102B2C" opacity="0.35"/>
    <rect x="190" y="176" width="30" height="28" rx="5" fill="#102B2C" opacity="0.35"/>
    <rect x="140" y="224" width="30" height="28" rx="5" fill="#102B2C" opacity="0.35"/>
    <rect x="190" y="224" width="30" height="28" rx="5" fill="#102B2C" opacity="0.35"/>
    <rect x="140" y="272" width="30" height="28" rx="5" fill="#102B2C" opacity="0.35"/>
    <rect x="190" y="272" width="30" height="28" rx="5" fill="#102B2C" opacity="0.35"/>
    <rect x="160" y="348" width="40" height="58" rx="6" fill="#102B2C" opacity="0.35"/>
    <!-- Right shorter building -->
    <rect x="272" y="172" width="120" height="234" rx="10" fill="white"/>
    <rect x="292" y="200" width="30" height="28" rx="5" fill="#102B2C" opacity="0.35"/>
    <rect x="342" y="200" width="30" height="28" rx="5" fill="#102B2C" opacity="0.35"/>
    <rect x="292" y="248" width="30" height="28" rx="5" fill="#102B2C" opacity="0.35"/>
    <rect x="342" y="248" width="30" height="28" rx="5" fill="#102B2C" opacity="0.35"/>
    <rect x="292" y="296" width="30" height="28" rx="5" fill="#102B2C" opacity="0.35"/>
    <rect x="342" y="296" width="30" height="28" rx="5" fill="#102B2C" opacity="0.35"/>
    <rect x="312" y="348" width="40" height="58" rx="6" fill="#102B2C" opacity="0.35"/>
    <!-- Bridge -->
    <rect x="240" y="236" width="32" height="16" rx="5" fill="url(#link)"/>
    <!-- Link arc -->
    <path d="M180 406 Q256 446 332 406" stroke="url(#link)" stroke-width="8" fill="none" stroke-linecap="round"/>
    <!-- Roof accents -->
    <rect x="155" y="90" width="50" height="16" rx="4" fill="white" opacity="0.9"/>
    <rect x="307" y="162" width="50" height="16" rx="4" fill="white" opacity="0.9"/>
  </g>
</svg>`;

const fgBuffer = Buffer.from(fgSvg);
const fgAdaptiveSizes = [
  { size: 108, folder: 'mipmap-mdpi' },
  { size: 162, folder: 'mipmap-hdpi' },
  { size: 216, folder: 'mipmap-xhdpi' },
  { size: 324, folder: 'mipmap-xxhdpi' },
  { size: 432, folder: 'mipmap-xxxhdpi' },
];

for (const { size, folder } of fgAdaptiveSizes) {
  const outDir = join(androidResDir, folder);
  await sharp(fgBuffer)
    .resize(size, size)
    .png()
    .toFile(join(outDir, 'ic_launcher_foreground.png'));
  console.log(`  ✓ ${folder}/ic_launcher_foreground.png (${size}px)`);
}

console.log('\n✅ All icons generated successfully!');
