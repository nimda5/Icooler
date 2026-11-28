import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Разработка: API — на localhost:3000 (services/api), запросы /api проксируются, cookie остаются на одном домене.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: process.env['API_URL'] ?? 'http://localhost:3000', changeOrigin: false } } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'], css: false },
});
