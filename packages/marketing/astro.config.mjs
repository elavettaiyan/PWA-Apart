import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://dwellhub.in',
  integrations: [
    tailwind(),
  ],
  build: {
    assets: 'assets',
  },
});
