/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const api = process.env.FIBERSCOPE_API_URL ?? 'http://127.0.0.1:8077'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: Number(process.env.PORT ?? 5188), strictPort: true, proxy: { '/api': { target: api, changeOrigin: false } } },
  preview: { port: 5188, strictPort: true, proxy: { '/api': { target: api } } },
  build: { chunkSizeWarningLimit: 800 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
