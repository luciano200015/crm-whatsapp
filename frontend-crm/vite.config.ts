import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin API in development: cookies (refresh + CSRF) work without CORS.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    // MUI + React + Router + Query make a ~165 kB (gzip) core; pages are split per route.
    chunkSizeWarningLimit: 600,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
    // The first render of each file compiles lazy-loaded pages; with many
    // files in parallel that can take several seconds.
    testTimeout: 30_000,
    // Absolute API URL in tests: Node's fetch (and MSW) cannot resolve relative URLs.
    env: { VITE_API_BASE_URL: 'http://localhost:3000/api/v1' },
  },
})
