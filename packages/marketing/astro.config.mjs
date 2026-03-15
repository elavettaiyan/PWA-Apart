import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://resilynk.com',
  integrations: [
    tailwind(),
  ],
  build: {
    assets: 'assets',
  },
});
