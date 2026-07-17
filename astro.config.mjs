import { defineConfig, passthroughImageService } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true }, // exposes runtime env (.dev.vars) via locals.runtime.env in dev
  }),
  // We don't optimize images (icons are static in /public), so skip sharp entirely.
  image: { service: passthroughImageService() },
  vite: {
    plugins: [tailwindcss()],
  },
});
