import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  site: 'https://dwellhub.in',
  integrations: [
    tailwind({ configFile: path.join(__dirname, 'tailwind.config.mjs') }),
    sitemap({
      changefreq: 'weekly',
      priority: 0.7,
    }),
  ],
  build: {
    assets: 'assets',
  },
});
