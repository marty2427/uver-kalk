import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' → relativní cesty k assetům, takže build funguje na root domény
// i na podadresáři. To je nejčastější příčina "bílé stránky" na Cloudflare.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
  },
});
