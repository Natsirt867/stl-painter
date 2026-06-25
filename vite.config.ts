import { defineConfig } from 'vite'

// base: './' keeps asset URLs relative so the same build works locally and on a
// GitHub Pages project site (https://<user>.github.io/<repo>/).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
})
